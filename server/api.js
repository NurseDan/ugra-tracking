import { Router } from 'express'
import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'
import { isAuthenticated, isAdmin } from './auth.js'
import { getPublicKey } from './push.js'
import { validateWebhookUrl } from './webhooks.js'
import { dispatchToSubscription } from './alertEngine.js'
import { limitsFor } from './plans.js'
import { PROVIDERS, isValidProvider, storeUserLlmKey, deleteUserLlmKey, getUserLlmConfig } from './llm.js'
import Stripe from 'stripe'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_MEMBER]:        'member',
  [process.env.STRIPE_PRICE_PRO]:           'pro',
  [process.env.STRIPE_PRICE_PRO_PLUS]:      'pro_plus',
  [process.env.STRIPE_PRICE_MEMBER_YEAR]:   'member',
  [process.env.STRIPE_PRICE_PRO_YEAR]:      'pro',
  [process.env.STRIPE_PRICE_PRO_PLUS_YEAR]: 'pro_plus',
}

const router = Router()

const ALLOWED_LEVELS = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'BLACK'])
const ALLOWED_CHANNELS = new Set(['push', 'email', 'sms', 'webhook'])
const VALID_GAUGE_IDS = new Set(GAUGES.map(g => g.id))

function userId(req) {
  return req.user?.id ?? (req.user?.claims?.sub ? `google:${req.user.claims.sub}` : undefined)
}

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
    `DELETE FROM sessions WHERE sess->'passport'->'user'->>'id' = $1`,
    [uid]
  )
  req.logout(() => res.json({ ok: true }))
})

router.delete('/me', isAuthenticated, async (req, res) => {
  const uid = userId(req)
  // Cascades to alert_subscriptions, ai_usage, notifications_sent.
  await query('DELETE FROM users WHERE id = $1', [uid])
  await query(
    `DELETE FROM sessions WHERE sess->'passport'->'user'->>'id' = $1`,
    [uid]
  )
  req.logout(() => res.json({ ok: true }))
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
router.post('/me/sensors/:id/readings', isAuthenticated, async (req, res) => {
  const own = await query(
    `SELECT id FROM community_sensors WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId(req)]
  )
  if (!own.rowCount) return res.status(404).json({ error: 'Sensor not found' })
  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return res.status(400).json({ error: 'payload object required' })
  // Cap payload size at ~2 KB so misbehaving devices can't fill the table.
  if (JSON.stringify(payload).length > 2048)
    return res.status(413).json({ error: 'payload too large (max 2 KB)' })
  const observedAt = req.body?.observed_at ? new Date(req.body.observed_at) : new Date()
  if (isNaN(observedAt)) return res.status(400).json({ error: 'invalid observed_at' })
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

const ALLOWED_PLANS = new Set(['free', 'member', 'pro', 'pro_plus', 'admin'])

router.get('/admin/users', isAdmin, async (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase()
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500)
  const params = []
  let where = ''
  if (q) { params.push(`%${q}%`); where = `WHERE LOWER(email) LIKE $1 OR LOWER(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) LIKE $1` }
  params.push(limit)
  const r = await query(
    `SELECT id, email, first_name, last_name, plan, created_at, updated_at
       FROM users ${where}
       ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  )
  res.json(r.rows)
})

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

router.get('/admin/stats', isAdmin, async (_req, res) => {
  const [users, subs, ai, sensors] = await Promise.all([
    query(`SELECT plan, COUNT(*)::int AS n FROM users GROUP BY plan`),
    query(`SELECT COUNT(*)::int AS n FROM alert_subscriptions WHERE enabled`),
    query(`SELECT COALESCE(SUM(request_count),0)::int AS n FROM ai_usage WHERE date = CURRENT_DATE`),
    query(`SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE is_public)::int AS public
             FROM community_sensors`),
  ])
  res.json({
    users_by_plan: Object.fromEntries(users.rows.map(r => [r.plan, r.n])),
    active_subscriptions: subs.rows[0]?.n ?? 0,
    ai_calls_today: ai.rows[0]?.n ?? 0,
    sensors: sensors.rows[0] ?? { total: 0, public: 0 },
  })
})

// --- Stripe routes ----------------------------------------------------

router.post('/stripe/create-checkout-session', isAuthenticated, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })
  const uid = userId(req)
  if (!uid) return res.status(401).json({ error: 'Unauthorized' })
  const { priceId } = req.body || {}
  if (!priceId) return res.status(400).json({ error: 'priceId required' })

  const userRow = await query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [uid])
  if (!userRow.rowCount) return res.status(404).json({ error: 'User not found' })
  const { email, stripe_customer_id } = userRow.rows[0]

  let customerId = stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ email, metadata: { user_id: uid } })
    customerId = customer.id
    await query('UPDATE users SET stripe_customer_id = $2 WHERE id = $1', [uid, customerId])
  }

  const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5173'
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${PUBLIC_URL}/account?upgraded=1`,
    cancel_url: `${PUBLIC_URL}/pricing`,
    metadata: { user_id: uid },
  })
  res.json({ url: session.url })
})

router.post('/stripe/portal', isAuthenticated, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' })
  const uid = userId(req)
  if (!uid) return res.status(401).json({ error: 'Unauthorized' })

  const userRow = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [uid])
  const customerId = userRow.rows[0]?.stripe_customer_id
  if (!customerId) return res.status(400).json({ error: 'No Stripe customer found' })

  const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5173'
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${PUBLIC_URL}/account`,
  })
  res.json({ url: portalSession.url })
})

// Stripe webhook — raw body required; mount this before express.json() in server/index.js
router.post('/stripe/webhook', async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe not configured')
  const sig = req.headers['stripe-signature']
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`)
  }

  async function setPlan(customerId, priceId, subscriptionId) {
    const plan = PRICE_TO_PLAN[priceId] || 'free'
    await query(
      `UPDATE users SET plan = $2, stripe_subscription_id = $3 WHERE stripe_customer_id = $1`,
      [customerId, plan, subscriptionId]
    )
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.mode === 'subscription') {
      const sub = await stripe.subscriptions.retrieve(session.subscription)
      const priceId = sub.items.data[0]?.price?.id
      await setPlan(session.customer, priceId, sub.id)
    }
  } else if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object
    const priceId = sub.items.data[0]?.price?.id
    await setPlan(sub.customer, priceId, sub.id)
  } else if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object
    await query(
      `UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = $1`,
      [sub.customer]
    )
  }

  res.json({ received: true })
})

export default router
