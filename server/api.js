import { Router } from 'express'
import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'
import { isAuthenticated, isAdmin } from './auth.js'
import { getPublicKey } from './push.js'
import { validateWebhookUrl } from './webhooks.js'
import { dispatchToSubscription } from './alertEngine.js'
import { limitsFor } from './plans.js'
import { PROVIDERS, isValidProvider, storeUserLlmKey, deleteUserLlmKey, getUserLlmConfig } from './llm.js'
import { createCheckoutSession, createPortalSession } from './stripe.js'
const router = Router()

const ALLOWED_LEVELS = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'BLACK'])
const ALLOWED_CHANNELS = new Set(['push', 'email', 'sms', 'webhook'])
const VALID_GAUGE_IDS = new Set(GAUGES.map(g => g.id))

function userId(req) {
  return req.session?.userId
}

const ALLOWED_PLANS = new Set(['free', 'admin'])



// --- Read APIs ---------------------------------------------------------

router.get('/gauges', (_req, res) => {
  res.json(GAUGES)
})

router.get('/gauges/current', async (_req, res) => {
  const r = await query(`SELECT gauge_id, payload FROM gauge_status`)
  const out = {}
  for (const row of r.rows) out[row.gauge_id] = row.payload
  res.json(out)
})

router.get('/gauges/:id/history', async (req, res) => {
  const { id } = req.params
  if (!VALID_GAUGE_IDS.has(id)) return res.status(404).json({ error: 'Unknown gauge' })
  const period = req.query.period || '14d'
  const intervals = { '1d': '1 day', '7d': '7 days', '14d': '14 days', '30d': '30 days', '90d': '90 days', '1y': '1 year', '5y': '5 years' }
  if (!intervals[period]) return res.status(400).json({ error: 'Invalid period' })
  const r = await query(
    `SELECT observed_at, height_ft, flow_cfs FROM gauge_readings
      WHERE gauge_id = $1 AND observed_at >= now() - interval '${intervals[period]}'
      ORDER BY observed_at ASC`,
    [id]
  )
  res.json(r.rows.map(row => ({
    time: row.observed_at,
    height: row.height_ft,
    flow: row.flow_cfs
  })))
})

router.get('/incidents', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000)
  const r = await query(
    `SELECT id, gauge_id, gauge_name, from_level, to_level, height_ft, flow_cfs, occurred_at
       FROM incidents ORDER BY occurred_at DESC LIMIT $1`,
    [limit]
  )
  res.json(r.rows)
})

router.get('/source/:key', async (req, res) => {
  const r = await query('SELECT payload, fetched_at FROM source_cache WHERE key = $1', [req.params.key])
  if (!r.rowCount) return res.status(404).json({ error: 'Not cached yet' })
  const p = r.rows[0].payload
  // Preserve the original payload shape (string/array/object) and only attach
  // _fetchedAt when it's an object so client decoders aren't surprised.
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    res.json({ ...p, _fetchedAt: r.rows[0].fetched_at })
  } else {
    res.json({ data: p, _fetchedAt: r.rows[0].fetched_at })
  }
})

// History API: time-bounded query against source_history. Used by both
// the dashboard (for timelines) and the export endpoints.
const ALLOWED_SOURCES = new Set(['nws_alerts', 'ahps', 'nwm', 'weather', 'canyon_lake'])
// JSON browse cap (kept small to protect the dashboard). Export endpoints
// stream without this cap so 5y archives are never silently truncated.
const MAX_HISTORY_ROWS = 50_000

function parseRange(req) {
  // Accept ISO `from`/`to` OR a `period` shortcut. Default = 30d.
  const periods = { '1d': 1, '7d': 7, '14d': 14, '30d': 30, '90d': 90, '1y': 365, '5y': 365 * 5 }
  const period = req.query.period
  if (period && periods[period]) {
    const to = new Date()
    const from = new Date(to.getTime() - periods[period] * 24 * 60 * 60 * 1000)
    return { from, to }
  }
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const to = req.query.to ? new Date(req.query.to) : new Date()
  if (isNaN(from) || isNaN(to)) throw new Error('Invalid from/to date')
  if (to.getTime() - from.getTime() > 5 * 365 * 24 * 60 * 60 * 1000) throw new Error('Range exceeds 5 years')
  return { from, to }
}

router.get('/source/:source/history', async (req, res) => {
  const { source } = req.params
  if (!ALLOWED_SOURCES.has(source)) return res.status(400).json({ error: 'Unknown source' })
  let from, to
  try { ({ from, to } = parseRange(req)) }
  catch (err) { return res.status(400).json({ error: err.message }) }
  const params = [source, from.toISOString(), to.toISOString()]
  let where = `source = $1 AND observed_at BETWEEN $2 AND $3`
  if (req.query.key) { params.push(req.query.key); where += ` AND key = $${params.length}` }
  const r = await query(
    `SELECT key, observed_at, payload FROM source_history
      WHERE ${where} ORDER BY observed_at ASC LIMIT ${MAX_HISTORY_ROWS}`,
    params
  )
  res.json(r.rows.map(row => ({ key: row.key, time: row.observed_at, payload: row.payload })))
})

// --- Exports -----------------------------------------------------------

function toCsv(rows, columns) {
  const esc = v => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.join(',')
  const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n')
  return `${head}\n${body}\n`
}

router.get('/export/readings.:fmt', async (req, res) => {
  const { fmt } = req.params
  if (!['csv', 'json'].includes(fmt)) return res.status(400).json({ error: 'Format must be csv or json' })
  const gaugeId = req.query.gauge_id
  if (gaugeId && !VALID_GAUGE_IDS.has(gaugeId)) return res.status(400).json({ error: 'Invalid gauge_id' })
  const period = req.query.period || '30d'
  const intervals = { '1d': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year', '5y': '5 years' }
  if (!intervals[period]) return res.status(400).json({ error: 'Invalid period' })

  const params = []
  let where = `WHERE observed_at >= now() - interval '${intervals[period]}'`
  if (gaugeId) { params.push(gaugeId); where += ` AND gauge_id = $${params.length}` }
  const r = await query(
    `SELECT gauge_id, observed_at, height_ft, flow_cfs, source FROM gauge_readings ${where} ORDER BY gauge_id, observed_at`,
    params
  )
  if (fmt === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="readings_${period}.json"`)
    return res.json(r.rows)
  }
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="readings_${period}.csv"`)
  res.send(toCsv(r.rows, ['gauge_id', 'observed_at', 'height_ft', 'flow_cfs', 'source']))
})

router.get('/export/source/:source.:fmt', async (req, res) => {
  const { source, fmt } = req.params
  if (!['csv', 'json'].includes(fmt)) return res.status(400).json({ error: 'Format must be csv or json' })
  if (!ALLOWED_SOURCES.has(source)) return res.status(400).json({ error: 'Unknown source' })
  let from, to
  try { ({ from, to } = parseRange(req)) }
  catch (err) { return res.status(400).json({ error: err.message }) }
  // Stream straight from a server-side cursor so 5y exports never
  // hit any in-memory row cap. We use pg's plain client with a named
  // portal-less query and chunk via OFFSET-style pagination by id.
  const stamp = `${source}_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`
  const PAGE = 5000
  let where = `source = $1 AND observed_at BETWEEN $2 AND $3`
  const baseParams = [source, from.toISOString(), to.toISOString()]
  if (req.query.key) { baseParams.push(req.query.key); where += ` AND key = $${baseParams.length}` }

  // Stream paginated by (observed_at, key) keyset cursor — matches the
  // table's natural ordering and primary key shape so we never truncate.
  async function fetchPage(lastTs, lastKey) {
    const cursor = lastTs
      ? ` AND (observed_at, key) > ($${baseParams.length + 1}::timestamptz, $${baseParams.length + 2})`
      : ''
    const params = lastTs ? [...baseParams, lastTs, lastKey] : baseParams
    return query(
      `SELECT key, observed_at, payload FROM source_history
        WHERE ${where}${cursor}
        ORDER BY observed_at ASC, key ASC LIMIT ${PAGE}`,
      params
    )
  }

  let lastTs = null, lastKey = null
  if (fmt === 'json') {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${stamp}.json"`)
    res.write('[')
    let first = true
    /* eslint-disable no-constant-condition */
    while (true) {
      const r = await fetchPage(lastTs, lastKey)
      if (!r.rowCount) break
      for (const row of r.rows) {
        res.write((first ? '' : ',') +
          JSON.stringify({ key: row.key, observed_at: row.observed_at, payload: row.payload }))
        first = false
        lastTs = row.observed_at; lastKey = row.key
      }
      if (r.rowCount < PAGE) break
    }
    res.end(']')
    return
  }
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="${stamp}.csv"`)
  res.write('key,observed_at,payload_json\n')
  while (true) {
    const r = await fetchPage(lastTs, lastKey)
    if (!r.rowCount) break
    for (const row of r.rows) {
      res.write(toCsv([{
        key: row.key,
        observed_at: row.observed_at,
        payload_json: JSON.stringify(row.payload)
      }], ['key', 'observed_at', 'payload_json']).split('\n').slice(1).join('\n') + '\n')
      lastTs = row.observed_at; lastKey = row.key
    }
    if (r.rowCount < PAGE) break
  }
  res.end()
})

router.get('/export/incidents.:fmt', async (req, res) => {
  const { fmt } = req.params
  if (!['csv', 'json'].includes(fmt)) return res.status(400).json({ error: 'Format must be csv or json' })
  const r = await query(
    `SELECT id, gauge_id, gauge_name, from_level, to_level, height_ft, flow_cfs, occurred_at
       FROM incidents ORDER BY occurred_at DESC`
  )
  if (fmt === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="incidents.json"')
    return res.json(r.rows)
  }
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="incidents.csv"')
  res.send(toCsv(r.rows, ['id', 'gauge_id', 'gauge_name', 'from_level', 'to_level', 'height_ft', 'flow_cfs', 'occurred_at']))
})

// --- Push -------------------------------------------------------------

router.get('/push/vapid-public-key', async (_req, res) => {
  try {
    const key = await getPublicKey()
    res.json({ publicKey: key })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Subscriptions (auth required) ------------------------------------

router.get('/me/subscriptions', isAuthenticated, async (req, res) => {
  const r = await query(
    `SELECT id, gauge_id, ugc_codes, nws_event_filter, min_level, channels, email, phone,
            webhook_url, push_endpoint IS NOT NULL AS has_push, enabled, created_at
       FROM alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId(req)]
  )
  res.json(r.rows)
})

const UGC_RE = /^[A-Z]{2}[CZ]\d{3}$/  // e.g. TXC265 (county) or TXZ187 (zone)

router.post('/me/subscriptions', isAuthenticated, async (req, res) => {
  const b = req.body || {}
  const gaugeId = b.gauge_id || null
  if (gaugeId && !VALID_GAUGE_IDS.has(gaugeId)) return res.status(400).json({ error: 'Invalid gauge_id' })
  const minLevel = b.min_level || 'ORANGE'
  if (!ALLOWED_LEVELS.has(minLevel)) return res.status(400).json({ error: 'Invalid min_level' })
  const channels = Array.isArray(b.channels) ? b.channels.filter(c => ALLOWED_CHANNELS.has(c)) : []
  if (!channels.length) return res.status(400).json({ error: 'At least one channel required' })
  if (channels.includes('webhook')) {
    if (!b.webhook_url) return res.status(400).json({ error: 'webhook_url required for webhook channel' })
    try { await validateWebhookUrl(b.webhook_url) }
    catch (err) { return res.status(400).json({ error: err.message }) }
  }
  const ugcCodes = Array.isArray(b.ugc_codes)
    ? b.ugc_codes.map(s => String(s).toUpperCase().trim()).filter(s => UGC_RE.test(s))
    : []
  if (Array.isArray(b.ugc_codes) && ugcCodes.length !== b.ugc_codes.length) {
    return res.status(400).json({ error: 'Invalid UGC code; must look like TXC265 or TXZ187' })
  }
  const eventFilter = Array.isArray(b.nws_event_filter)
    ? b.nws_event_filter.map(s => String(s).slice(0, 80))
    : []

  const uid = userId(req)
  const { rows: [userRow] } = await query('SELECT plan FROM users WHERE id = $1', [uid])
  const limits = limitsFor(userRow?.plan)
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*) FROM alert_subscriptions WHERE user_id = $1', [uid])
  if (Number(count) >= limits.maxSubscriptions)
    return res.status(403).json({ message: `Subscription limit reached (${limits.maxSubscriptions}) for your plan.` })
  const badChannels = channels.filter(c => !limits.allowedChannels.includes(c))
  if (badChannels.length)
    return res.status(403).json({ message: `Channel(s) not available on your plan: ${badChannels.join(', ')}` })

  const r = await query(
    `INSERT INTO alert_subscriptions
       (user_id, gauge_id, ugc_codes, nws_event_filter, min_level, channels,
        email, phone, webhook_url, webhook_secret,
        push_endpoint, push_p256dh, push_auth, enabled)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,true)
     RETURNING id`,
    [
      uid, gaugeId, JSON.stringify(ugcCodes), JSON.stringify(eventFilter),
      minLevel, JSON.stringify(channels),
      b.email || null, b.phone || null, b.webhook_url || null, b.webhook_secret || null,
      b.push?.endpoint || null, b.push?.keys?.p256dh || null, b.push?.keys?.auth || null
    ]
  )
  res.json({ id: r.rows[0].id })
})

// Per-user delivery history: which alerts were dispatched on which channel,
// for the user's own subscriptions only.
router.get('/me/notifications', isAuthenticated, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
  const r = await query(
    `SELECT n.id, n.subscription_id, n.incident_id, n.channel, n.status, n.error, n.sent_at,
            i.gauge_id, i.gauge_name, i.from_level, i.to_level
       FROM notifications_sent n
       JOIN alert_subscriptions s ON s.id = n.subscription_id
       -- incident_id is text now to allow non-UUID external IDs (e.g. NWS).
       -- Cast both sides to text and only join when shape matches a UUID.
       LEFT JOIN incidents i
         ON n.incident_id ~ '^[0-9a-fA-F-]{36}$' AND i.id::text = n.incident_id
      WHERE s.user_id = $1
      ORDER BY n.sent_at DESC
      LIMIT $2`,
    [userId(req), limit]
  )
  res.json(r.rows)
})

router.delete('/me/subscriptions/:id', isAuthenticated, async (req, res) => {
  const r = await query(
    `DELETE FROM alert_subscriptions WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId(req)]
  )
  res.json({ deleted: r.rowCount })
})

// --- Account settings -------------------------------------------------

router.get('/me/usage', isAuthenticated, async (req, res) => {
  const uid = userId(req)
  const { rows: [userRow] } = await query('SELECT plan FROM users WHERE id = $1', [uid])
  const limits = limitsFor(userRow?.plan)
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*) FROM alert_subscriptions WHERE user_id = $1', [uid])
  const { rows: aiRows } = await query(
    'SELECT request_count FROM ai_usage WHERE user_id = $1 AND date = CURRENT_DATE', [uid])
  const subLimit = limits.maxSubscriptions === Infinity ? null : limits.maxSubscriptions
  const aiLimit  = limits.aiCallsPerDay === Infinity ? null : limits.aiCallsPerDay
  res.json({
    plan: userRow?.plan ?? 'free',
    subscriptions: { used: Number(count), limit: subLimit },
    aiCalls:       { used: aiRows[0]?.request_count ?? 0, limit: aiLimit }
  })
})

router.patch('/me/profile', isAuthenticated, async (req, res) => {
  const { first_name, last_name } = req.body || {}
  if (first_name != null && typeof first_name !== 'string') return res.status(400).json({ error: 'first_name must be a string' })
  if (last_name != null && typeof last_name !== 'string') return res.status(400).json({ error: 'last_name must be a string' })
  const fn = first_name?.trim().slice(0, 80) || null
  const ln = last_name?.trim().slice(0, 80) || null
  await query(
    `UPDATE users SET first_name = COALESCE($2, first_name),
                      last_name  = COALESCE($3, last_name),
                      updated_at = now()
       WHERE id = $1`,
    [userId(req), fn, ln]
  )
  res.json({ ok: true })
})

router.patch('/me/preferences', isAuthenticated, async (req, res) => {
  const { default_email, default_min_level, default_channels } = req.body || {}
  if (default_email != null && (typeof default_email !== 'string' || default_email.length > 254))
    return res.status(400).json({ error: 'default_email invalid' })
  if (default_min_level != null && !ALLOWED_LEVELS.has(default_min_level))
    return res.status(400).json({ error: 'default_min_level invalid' })
  let channels = null
  if (default_channels != null) {
    if (!Array.isArray(default_channels)) return res.status(400).json({ error: 'default_channels must be an array' })
    channels = default_channels.filter(c => ALLOWED_CHANNELS.has(c))
  }
  await query(
    `UPDATE users SET
       default_email     = COALESCE($2, default_email),
       default_min_level = COALESCE($3, default_min_level),
       default_channels  = COALESCE($4::jsonb, default_channels),
       updated_at        = now()
     WHERE id = $1`,
    [userId(req), default_email?.trim() || null, default_min_level || null,
     channels ? JSON.stringify(channels) : null]
  )
  res.json({ ok: true })
})

router.post('/me/sign-out-everywhere', isAuthenticated, async (req, res) => {
  const uid = userId(req)
  await query(
    `DELETE FROM sessions WHERE sess->>'userId' = $1`,
    [uid]
  )
  req.session.destroy(() => res.json({ ok: true }))
})

router.delete('/me', isAuthenticated, async (req, res) => {
  const uid = userId(req)
  // Cascades to alert_subscriptions, ai_usage, notifications_sent.
  await query('DELETE FROM users WHERE id = $1', [uid])
  await query(
    `DELETE FROM sessions WHERE sess->>'userId' = $1`,
    [uid]
  )
  req.session.destroy(() => res.json({ ok: true }))
})

router.post('/me/test-alert', isAuthenticated, async (req, res) => {
  const subId = req.body?.subscription_id
  if (!subId) return res.status(400).json({ error: 'subscription_id required' })
  const sub = await query(
    `SELECT * FROM alert_subscriptions WHERE id = $1 AND user_id = $2`,
    [subId, userId(req)]
  )
  if (!sub.rowCount) return res.status(404).json({ error: 'Not found' })
  // Use a per-call random incident id so test sends never collide with
  // (or are deduped by) a real incident, and dispatch ONLY to the caller's
  // subscription — never fan out to other users' matching subscriptions.
  const { randomUUID } = await import('node:crypto')
  const incident = {
    id: randomUUID(),
    gauge_id: sub.rows[0].gauge_id || 'TEST',
    gauge_name: 'Test alert',
    from_level: 'GREEN',
    to_level: 'ORANGE',
    height_ft: null,
    flow_cfs: null,
    occurred_at: new Date().toISOString()
  }
  try {
    await dispatchToSubscription(sub.rows[0], incident)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- BYOK: user-provided LLM keys -------------------------------------

router.get('/me/llm-key', isAuthenticated, async (req, res) => {
  const cfg = await getUserLlmConfig(userId(req))
  if (!cfg) return res.json({ configured: false, providers: listProviders() })
  res.json({
    configured: true,
    provider: cfg.provider,
    model: cfg.model,
    last_four: cfg.last_four,
    updated_at: cfg.updated_at,
    providers: listProviders(),
  })
})

router.put('/me/llm-key', isAuthenticated, async (req, res) => {
  const { provider, model, key } = req.body || {}
  if (!isValidProvider(provider)) return res.status(400).json({ error: 'Unsupported provider' })
  try {
    await storeUserLlmKey(userId(req), { provider, model, key })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.delete('/me/llm-key', isAuthenticated, async (req, res) => {
  await deleteUserLlmKey(userId(req))
  res.json({ ok: true })
})

function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, label: p.label, defaultModel: p.defaultModel,
  }))
}

// --- Community sensors (opt-in) ---------------------------------------

const SENSOR_KINDS = new Set(['water_level', 'rain', 'other'])

router.get('/me/sensors', isAuthenticated, async (req, res) => {
  const r = await query(
    `SELECT id, label, kind, lat, lng, is_public, consent_at, created_at
       FROM community_sensors WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId(req)]
  )
  res.json(r.rows)
})

router.post('/me/sensors', isAuthenticated, async (req, res) => {
  const { label, kind, lat, lng, is_public, consent } = req.body || {}
  if (typeof label !== 'string' || !label.trim() || label.length > 120)
    return res.status(400).json({ error: 'label required (1–120 chars)' })
  const k = kind || 'water_level'
  if (!SENSOR_KINDS.has(k)) return res.status(400).json({ error: 'Invalid kind' })
  const fLat = Number(lat), fLng = Number(lng)
  if (!Number.isFinite(fLat) || fLat < -90 || fLat > 90)
    return res.status(400).json({ error: 'lat must be -90..90' })
  if (!Number.isFinite(fLng) || fLng < -180 || fLng > 180)
    return res.status(400).json({ error: 'lng must be -180..180' })
  if (consent !== true)
    return res.status(400).json({ error: 'Explicit consent required to publish a sensor' })

  const r = await query(
    `INSERT INTO community_sensors (user_id, label, kind, lat, lng, is_public, consent_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
    [userId(req), label.trim(), k, fLat, fLng, !!is_public]
  )
  res.json({ id: r.rows[0].id })
})

router.delete('/me/sensors/:id', isAuthenticated, async (req, res) => {
  const r = await query(
    `DELETE FROM community_sensors WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId(req)]
  )
  res.json({ deleted: r.rowCount })
})

// Reading ingest. Auth required; the sensor must belong to the caller.
// The payload is opaque jsonb (height_ft, mm_per_hr, battery, etc.) so
// hobbyist hardware can post whatever shape it has.
//
// A per-sensor token bucket caps ingest to ~12 readings/minute (one every
// 5s on average, with a small burst). Honest devices stay well under;
// misbehaving firmware can't fill the table or drown the disk.
const SENSOR_BUCKETS = new Map()
const SENSOR_BUCKET_CAP = 12
const SENSOR_REFILL_PER_SEC = 12 / 60  // = 1 token every 5s

function consumeSensorToken(sensorId) {
  const now = Date.now()
  let b = SENSOR_BUCKETS.get(sensorId)
  if (!b) { b = { tokens: SENSOR_BUCKET_CAP, ts: now }; SENSOR_BUCKETS.set(sensorId, b) }
  const elapsedSec = (now - b.ts) / 1000
  b.tokens = Math.min(SENSOR_BUCKET_CAP, b.tokens + elapsedSec * SENSOR_REFILL_PER_SEC)
  b.ts = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}
// Periodically prune buckets for sensors that haven't posted in 10 min so
// the map can't grow unbounded across the lifetime of the process.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000
  for (const [id, b] of SENSOR_BUCKETS) if (b.ts < cutoff) SENSOR_BUCKETS.delete(id)
}, 5 * 60_000).unref?.()

router.post('/me/sensors/:id/readings', isAuthenticated, async (req, res) => {
  const own = await query(
    `SELECT id FROM community_sensors WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId(req)]
  )
  if (!own.rowCount) return res.status(404).json({ error: 'Sensor not found' })
  if (!consumeSensorToken(req.params.id))
    return res.status(429).json({ error: 'Sensor reading rate limit (12/min) — slow your posts down.' })
  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return res.status(400).json({ error: 'payload object required' })
  // Cap payload size at ~2 KB so misbehaving devices can't fill the table.
  if (JSON.stringify(payload).length > 2048)
    return res.status(413).json({ error: 'payload too large (max 2 KB)' })
  const observedAt = req.body?.observed_at ? new Date(req.body.observed_at) : new Date()
  if (isNaN(observedAt)) return res.status(400).json({ error: 'invalid observed_at' })
  // Reject readings dated in the future or absurdly far in the past
  // so a misconfigured clock can't poison the time series.
  const ageMs = Date.now() - observedAt.getTime()
  if (ageMs < -5 * 60_000) return res.status(400).json({ error: 'observed_at is in the future' })
  if (ageMs >  7 * 24 * 60 * 60_000) return res.status(400).json({ error: 'observed_at older than 7 days' })
  await query(
    `INSERT INTO sensor_readings (sensor_id, observed_at, payload)
       VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (sensor_id, observed_at) DO UPDATE SET payload = EXCLUDED.payload`,
    [req.params.id, observedAt.toISOString(), JSON.stringify(payload)]
  )
  res.json({ ok: true })
})

// Public view: only sensors the owner has explicitly marked public, with
// the most recent reading attached. Useful for the public map.
router.get('/sensors/community', async (_req, res) => {
  const r = await query(
    `SELECT s.id, s.label, s.kind, s.lat, s.lng,
            r.observed_at AS last_observed_at, r.payload AS last_payload
       FROM community_sensors s
       LEFT JOIN LATERAL (
         SELECT observed_at, payload FROM sensor_readings
          WHERE sensor_id = s.id ORDER BY observed_at DESC LIMIT 1
       ) r ON true
      WHERE s.is_public = true AND s.consent_at IS NOT NULL
      ORDER BY s.label ASC`)
  res.json(r.rows)
})

router.get('/sensors/:id/history', async (req, res) => {
  // History is public only for is_public sensors; private ones 404.
  const meta = await query(
    `SELECT id FROM community_sensors WHERE id = $1 AND is_public = true`,
    [req.params.id]
  )
  if (!meta.rowCount) return res.status(404).json({ error: 'Sensor not found' })
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000)
  const r = await query(
    `SELECT observed_at, payload FROM sensor_readings
      WHERE sensor_id = $1 ORDER BY observed_at DESC LIMIT $2`,
    [req.params.id, limit]
  )
  res.json(r.rows)
})

// --- Admin (env-promoted) ---------------------------------------------
// Admins inherit every standard user capability (plan='admin' satisfies
// limitsFor) and additionally get this backend-management surface.
// Promotion happens via ADMIN_EMAILS at login — there is no shared
// password. Every action runs under the operator's own Google identity
// so sessions and audit trails remain attributable.



router.patch('/admin/users/:id/plan', isAdmin, async (req, res) => {
  const { plan } = req.body || {}
  if (!ALLOWED_PLANS.has(plan)) return res.status(400).json({ error: 'Invalid plan' })
  await query('UPDATE users SET plan = $2, updated_at = now() WHERE id = $1', [req.params.id, plan])
  res.json({ ok: true })
})

router.post('/admin/users/:id/revoke-sessions', isAdmin, async (req, res) => {
  const r = await query(
    `DELETE FROM sessions WHERE sess->'passport'->'user'->>'id' = $1`,
    [req.params.id]
  )
  res.json({ revoked: r.rowCount })
})

router.get('/admin/stats', isAuthenticated, isAdmin, async (_req, res) => {
  const [users, subs, incidents, ai, srcCache, srcHistory] = await Promise.all([
    query(`SELECT plan, COUNT(*)::int AS n FROM users GROUP BY plan`),
    query(`SELECT COUNT(*)::int AS n FROM alert_subscriptions`),
    query(`SELECT COUNT(*)::int AS n, MAX(occurred_at) AS latest FROM incidents`),
    query(`SELECT COALESCE(SUM(request_count),0)::int AS today
             FROM ai_usage WHERE date = CURRENT_DATE`),
    query(`SELECT COUNT(*)::int AS n FROM source_cache`),
    query(`SELECT COUNT(*)::int AS n FROM source_history`),
  ])
  res.json({
    usersByPlan: Object.fromEntries(users.rows.map(r => [r.plan, r.n])),
    subscriptions: subs.rows[0].n,
    incidents: incidents.rows[0].n,
    latestIncident: incidents.rows[0].latest,
    aiCallsToday: ai.rows[0].today,
    sourceCacheKeys: srcCache.rows[0].n,
    sourceHistoryRows: srcHistory.rows[0].n,
  })
})

router.get('/admin/users', isAuthenticated, isAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
  const search = (req.query.q || '').toString().trim().toLowerCase()
  const params = []
  let where = ''
  if (search) {
    params.push(`%${search}%`)
    where = `WHERE LOWER(email) LIKE $1 OR LOWER(COALESCE(first_name,'')) LIKE $1 OR LOWER(COALESCE(last_name,'')) LIKE $1`
  }
  params.push(limit)
  const r = await query(
    `SELECT id, email, first_name, last_name, plan, created_at, updated_at
       FROM users ${where}
       ORDER BY updated_at DESC NULLS LAST
       LIMIT $${params.length}`,
    params
  )
  res.json(r.rows)
})

router.patch('/admin/users/:id', isAuthenticated, isAdmin, async (req, res) => {
  const { plan } = req.body || {}
  if (!ALLOWED_PLANS.has(plan)) return res.status(400).json({ error: 'Invalid plan' })
  const r = await query(
    `UPDATE users SET plan = $2, updated_at = now() WHERE id = $1 RETURNING id, plan`,
    [req.params.id, plan]
  )
  if (!r.rowCount) return res.status(404).json({ error: 'User not found' })
  res.json(r.rows[0])
})

router.get('/admin/incidents', isAuthenticated, isAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000)
  const r = await query(
    `SELECT id, gauge_id, gauge_name, from_level, to_level, height_ft, flow_cfs, occurred_at
       FROM incidents ORDER BY occurred_at DESC LIMIT $1`, [limit])
  res.json(r.rows)
})

router.delete('/admin/incidents/:id', isAuthenticated, isAdmin, async (req, res) => {
  const r = await query(`DELETE FROM incidents WHERE id = $1`, [req.params.id])
  res.json({ deleted: r.rowCount })
})

router.get('/admin/source-cache', isAuthenticated, isAdmin, async (_req, res) => {
  const r = await query(
    `SELECT key, fetched_at, pg_column_size(payload) AS size_bytes
       FROM source_cache ORDER BY fetched_at DESC`)
  res.json(r.rows)
})

router.delete('/admin/source-cache/:key', isAuthenticated, isAdmin, async (req, res) => {
  const r = await query(`DELETE FROM source_cache WHERE key = $1`, [req.params.key])
  res.json({ deleted: r.rowCount })
})

router.get('/admin/ai-cache', isAuthenticated, isAdmin, async (_req, res) => {
  const r = await query(
    `SELECT cache_key, model, hits, created_at, expires_at,
            pg_column_size(response) AS size_bytes
       FROM ai_briefing_cache ORDER BY created_at DESC LIMIT 200`)
  res.json(r.rows)
})

router.post('/admin/ai-cache/purge', isAuthenticated, isAdmin, async (_req, res) => {
  const r = await query(`DELETE FROM ai_briefing_cache`)
  res.json({ deleted: r.rowCount })
})

router.get('/admin/notifications', isAuthenticated, isAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
  const r = await query(
    `SELECT id, subscription_id, incident_id, channel, status, error, sent_at
       FROM notifications_sent ORDER BY sent_at DESC LIMIT $1`, [limit])
  res.json(r.rows)
})

// Stripe checkout — create a hosted payment session
router.post('/stripe/checkout', isAuthenticated, async (req, res) => {
  try {
    const user = await query('SELECT email FROM users WHERE id=$1', [req.session.userId])
    const origin = `${req.protocol}://${req.get('host')}`
    const url = await createCheckoutSession(req.session.userId, user.rows[0].email, origin)
    res.json({ url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Stripe customer portal — manage/cancel subscription
router.post('/stripe/portal', isAuthenticated, async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get('host')}`
    const url = await createPortalSession(req.session.userId, origin)
    res.json({ url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
