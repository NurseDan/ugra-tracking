import { Router } from 'express'
import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'
import { isAuthenticated } from './auth.js'
import { getPublicKey } from './push.js'
import { validateWebhookUrl } from './webhooks.js'
import { dispatchToSubscription } from './alertEngine.js'

const router = Router()

const ALLOWED_LEVELS = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED', 'BLACK'])
const ALLOWED_CHANNELS = new Set(['push', 'email', 'sms', 'webhook'])
const VALID_GAUGE_IDS = new Set(GAUGES.map(g => g.id))

function userId(req) {
  return req.user?.claims?.sub
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
  res.json({ ...r.rows[0].payload, _fetchedAt: r.rows[0].fetched_at })
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
    `SELECT id, gauge_id, min_level, channels, email, phone, webhook_url, push_endpoint IS NOT NULL AS has_push,
            enabled, created_at
       FROM alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId(req)]
  )
  res.json(r.rows)
})

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

  const r = await query(
    `INSERT INTO alert_subscriptions
       (user_id, gauge_id, min_level, channels, email, phone, webhook_url, webhook_secret,
        push_endpoint, push_p256dh, push_auth, enabled)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,true)
     RETURNING id`,
    [
      userId(req), gaugeId, minLevel, JSON.stringify(channels),
      b.email || null, b.phone || null, b.webhook_url || null, b.webhook_secret || null,
      b.push?.endpoint || null, b.push?.keys?.p256dh || null, b.push?.keys?.auth || null
    ]
  )
  res.json({ id: r.rows[0].id })
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
