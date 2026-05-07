import { Router } from 'express'
import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'
import { isAuthenticated, userId } from './auth.js'
import { getPublicKey } from './push.js'
import { validateWebhookUrl } from './webhooks.js'
import { dispatchToSubscription } from './alertEngine.js'
import { FREE_SUBSCRIPTION_LIMIT } from './billing.js'

const router = Router()

const ALLOWED_LEVELS = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'BLACK'])
const ALLOWED_CHANNELS = new Set(['push', 'email', 'sms', 'webhook', 'slack', 'discord'])
const VALID_GAUGE_IDS = new Set(GAUGES.map(g => g.id))

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
            webhook_url, slack_webhook_url, discord_webhook_url,
            push_endpoint IS NOT NULL AS has_push,
            custom_height_ft, custom_flow_cfs,
            enabled, created_at
       FROM alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId(req)]
  )
  res.json(r.rows)
})

const UGC_RE = /^[A-Z]{2}[CZ]\d{3}$/  // e.g. TXC265 (county) or TXZ187 (zone)

router.post('/me/subscriptions', isAuthenticated, async (req, res) => {
  const uid = userId(req)
  // Enforce free-tier subscription cap.
  const userRow = await query('SELECT plan FROM users WHERE id = $1', [uid])
  const plan = userRow.rows[0]?.plan || 'free'
  if (plan !== 'pro') {
    const count = await query(
      'SELECT COUNT(*) FROM alert_subscriptions WHERE user_id = $1',
      [uid]
    )
    if (parseInt(count.rows[0].count, 10) >= FREE_SUBSCRIPTION_LIMIT) {
      return res.status(403).json({
        error: `Free plan is limited to ${FREE_SUBSCRIPTION_LIMIT} alert subscription. Upgrade to Pro for unlimited alerts.`,
        upgrade: true
      })
    }
  }

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

  // Validate Slack/Discord webhook URLs if provided
  const slackUrl = channels.includes('slack') ? (b.slack_webhook_url || null) : null
  const discordUrl = channels.includes('discord') ? (b.discord_webhook_url || null) : null
  if (channels.includes('slack') && !slackUrl) {
    return res.status(400).json({ error: 'slack_webhook_url required for slack channel' })
  }
  if (channels.includes('discord') && !discordUrl) {
    return res.status(400).json({ error: 'discord_webhook_url required for discord channel' })
  }

  // Custom thresholds (Pro only)
  let customHeightFt = null
  let customFlowCfs = null
  if (plan === 'pro') {
    if (b.custom_height_ft != null) {
      const v = parseFloat(b.custom_height_ft)
      if (!isNaN(v) && v > 0) customHeightFt = v
    }
    if (b.custom_flow_cfs != null) {
      const v = parseFloat(b.custom_flow_cfs)
      if (!isNaN(v) && v > 0) customFlowCfs = v
    }
  }

  const r = await query(
    `INSERT INTO alert_subscriptions
       (user_id, gauge_id, ugc_codes, nws_event_filter, min_level, channels,
        email, phone, webhook_url, webhook_secret,
        slack_webhook_url, discord_webhook_url,
        push_endpoint, push_p256dh, push_auth,
        custom_height_ft, custom_flow_cfs,
        enabled)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true)
     RETURNING id`,
    [
      uid, gaugeId, JSON.stringify(ugcCodes), JSON.stringify(eventFilter),
      minLevel, JSON.stringify(channels),
      b.email || null, b.phone || null, b.webhook_url || null, b.webhook_secret || null,
      slackUrl, discordUrl,
      b.push?.endpoint || null, b.push?.keys?.p256dh || null, b.push?.keys?.auth || null,
      customHeightFt, customFlowCfs
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

export default router
