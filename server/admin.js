import { Router } from 'express'
import { query } from './db.js'
import { isAuthenticated, userId } from './auth.js'
import { getConfig, setConfig, deleteConfig, listConfigMeta, encryptionAvailable } from './config.js'

const router = Router()

// ── isAdmin middleware ────────────────────────────────────────────────────────

export async function isAdmin(req, res, next) {
  const uid = userId(req)
  if (!uid) return res.status(401).json({ error: 'Unauthorized' })
  const r = await query('SELECT is_admin FROM users WHERE id = $1', [uid])
  if (!r.rows[0]?.is_admin) return res.status(403).json({ error: 'Forbidden' })
  next()
}

// ── Config key registry ───────────────────────────────────────────────────────
// Defines every setting the admin panel can manage. `encrypted` controls
// whether the value is AES-256-GCM encrypted before writing to Postgres.

export const ADMIN_CONFIG_KEYS = [
  // Stripe
  { key: 'STRIPE_SECRET_KEY',         label: 'Stripe Secret Key',             encrypted: true,  hint: 'sk_live_…',        section: 'Stripe' },
  { key: 'STRIPE_PRICE_ID_PRO',       label: 'Pro Monthly Price ID',          encrypted: false, hint: 'price_…',          section: 'Stripe' },
  { key: 'STRIPE_PRICE_ID_PRO_ANNUAL',label: 'Pro Annual Price ID',           encrypted: false, hint: 'price_…',          section: 'Stripe' },
  { key: 'STRIPE_WEBHOOK_SECRET',     label: 'Stripe Webhook Secret',         encrypted: true,  hint: 'whsec_…',          section: 'Stripe' },
  // Twilio SMS
  { key: 'TWILIO_ACCOUNT_SID',        label: 'Twilio Account SID',            encrypted: false, hint: 'AC…',              section: 'Twilio SMS' },
  { key: 'TWILIO_AUTH_TOKEN',         label: 'Twilio Auth Token',             encrypted: true,  hint: '',                 section: 'Twilio SMS' },
  { key: 'TWILIO_FROM_NUMBER',        label: 'Twilio From Number',            encrypted: false, hint: '+15551234567',     section: 'Twilio SMS' },
  // OpenAI
  { key: 'OPENAI_API_KEY',            label: 'OpenAI API Key',                encrypted: true,  hint: 'sk-…',             section: 'AI briefings' },
  // General
  { key: 'PUBLIC_URL',                label: 'Public base URL',               encrypted: false, hint: 'https://…',        section: 'General' },
  { key: 'VAPID_SUBJECT',             label: 'VAPID Subject (push sender)',   encrypted: false, hint: 'mailto:ops@…',     section: 'General' },
]

// ── Config endpoints ──────────────────────────────────────────────────────────

router.get('/config', isAuthenticated, isAdmin, async (_req, res) => {
  const dbKeys = new Set((await listConfigMeta()).map(r => r.key))
  const encAvail = encryptionAvailable()

  const settings = ADMIN_CONFIG_KEYS.map(def => ({
    key: def.key,
    label: def.label,
    hint: def.hint,
    section: def.section,
    encrypted: def.encrypted,
    source: dbKeys.has(def.key) ? 'database' : (process.env[def.key] ? 'env' : 'unset'),
    set: dbKeys.has(def.key) || !!process.env[def.key]
  }))

  res.json({ settings, encryptionAvailable: encAvail })
})

router.put('/config/:key', isAuthenticated, isAdmin, async (req, res) => {
  const { key } = req.params
  const def = ADMIN_CONFIG_KEYS.find(k => k.key === key)
  if (!def) return res.status(400).json({ error: 'Unknown config key' })

  const { value } = req.body || {}
  if (typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'value is required' })
  }
  if (def.encrypted && !encryptionAvailable()) {
    return res.status(503).json({ error: 'CONFIG_ENCRYPTION_KEY is not set — encrypted settings cannot be saved' })
  }

  try {
    await setConfig(key, value.trim(), def.encrypted)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/config/:key', isAuthenticated, isAdmin, async (req, res) => {
  const { key } = req.params
  if (!ADMIN_CONFIG_KEYS.find(k => k.key === key)) {
    return res.status(400).json({ error: 'Unknown config key' })
  }
  await deleteConfig(key)
  res.json({ ok: true })
})

// ── User management ───────────────────────────────────────────────────────────

router.get('/users', isAuthenticated, isAdmin, async (_req, res) => {
  const r = await query(
    `SELECT id, email, first_name, last_name, auth_provider, plan, plan_status,
            is_admin, created_at,
            (SELECT COUNT(*) FROM alert_subscriptions WHERE user_id = users.id) AS sub_count
       FROM users ORDER BY created_at DESC LIMIT 1000`
  )
  res.json(r.rows)
})

router.patch('/users/:id', isAuthenticated, isAdmin, async (req, res) => {
  const { plan, is_admin: makeAdmin } = req.body || {}
  const updates = []
  const params = []

  if (plan !== undefined) {
    if (!['free', 'pro'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' })
    params.push(plan); updates.push(`plan = $${params.length}`)
  }
  if (makeAdmin !== undefined) {
    params.push(!!makeAdmin); updates.push(`is_admin = $${params.length}`)
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' })

  params.push(req.params.id)
  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
  res.json({ ok: true })
})

// ── Stats snapshot ────────────────────────────────────────────────────────────

router.get('/stats', isAuthenticated, isAdmin, async (_req, res) => {
  const [users, subs, notifs, incidents] = await Promise.all([
    query(`SELECT
             COUNT(*) FILTER (WHERE plan = 'free') AS free_users,
             COUNT(*) FILTER (WHERE plan = 'pro')  AS pro_users,
             COUNT(*) AS total_users
           FROM users`),
    query(`SELECT COUNT(*) AS total_subs FROM alert_subscriptions WHERE enabled = true`),
    query(`SELECT COUNT(*) AS sent_today FROM notifications_sent WHERE sent_at >= now() - interval '24h' AND status = 'sent'`),
    query(`SELECT COUNT(*) AS incidents_week FROM incidents WHERE occurred_at >= now() - interval '7 days'`)
  ])
  res.json({
    ...users.rows[0],
    ...subs.rows[0],
    ...notifs.rows[0],
    ...incidents.rows[0]
  })
})

export default router
