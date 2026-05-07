import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { initSchema, query } from './server/db.js'
import { startPoller } from './server/poller.js'
import { setupAuth } from './server/auth.js'
import apiRouter from './server/api.js'
import billingRouter, { handleStripeWebhook } from './server/billing.js'
import adminRouter from './server/admin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

// Stripe webhooks must receive the raw body before express.json parses it.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook)

app.use(express.json({ limit: '64kb' }))

// --- OpenAI proxy with per-user monthly budget and per-IP burst limit -------

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'
const ALLOWED_MODELS = new Set(['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'])

// Per-plan monthly AI call limits. Logged-out (anonymous) users get the free budget
// tracked per IP. Logged-in users are tracked in the DB so limits survive restarts.
const AI_MONTHLY_LIMIT = { free: 20, pro: 200 }

// Fallback in-memory IP bucket for anonymous / unauthenticated callers.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const rateLimitMap = new Map()

function isIpRateLimited(ip) {
  const now = Date.now()
  let entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 }
    rateLimitMap.set(ip, entry)
  }
  entry.count += 1
  return entry.count > RATE_LIMIT_MAX
}
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2
  for (const [ip, entry] of rateLimitMap) {
    if (entry.windowStart < cutoff) rateLimitMap.delete(ip)
  }
}, RATE_LIMIT_WINDOW_MS * 2)

// Check and atomically increment a user's monthly AI call counter.
// Returns { allowed, used, limit, resetsAt } — does NOT throw.
async function checkAndIncrementBudget(userId) {
  try {
    // Reset counter if the monthly window has rolled over.
    await query(
      `UPDATE users SET ai_calls_this_month = 0, ai_calls_reset_at = now()
       WHERE id = $1 AND ai_calls_reset_at < now() - interval '30 days'`,
      [userId]
    )
    const r = await query(
      `UPDATE users
         SET ai_calls_this_month = ai_calls_this_month + 1
       WHERE id = $1
       RETURNING ai_calls_this_month, ai_calls_reset_at, plan`,
      [userId]
    )
    if (!r.rowCount) return { allowed: true, used: 1, limit: AI_MONTHLY_LIMIT.free }
    const { ai_calls_this_month: used, ai_calls_reset_at: resetAt, plan } = r.rows[0]
    const limit = AI_MONTHLY_LIMIT[plan] ?? AI_MONTHLY_LIMIT.free
    if (used > limit) {
      // Rollback the increment we just applied.
      await query('UPDATE users SET ai_calls_this_month = ai_calls_this_month - 1 WHERE id = $1', [userId])
      return { allowed: false, used: used - 1, limit, resetsAt: resetAt }
    }
    return { allowed: true, used, limit, resetsAt: resetAt }
  } catch {
    // If DB is unavailable, allow the call rather than blocking the whole feature.
    return { allowed: true }
  }
}

app.post('/api/chat', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'

  // Authenticated users: enforce monthly DB budget.
  const uid = req.user?.claims?.sub || req.user?.id
  if (uid) {
    const budget = await checkAndIncrementBudget(uid)
    if (!budget.allowed) {
      return res.status(429).json({
        error: `Monthly AI briefing limit reached (${budget.limit} requests/month). Resets in ~30 days.`,
        limit: budget.limit,
        used: budget.used,
        upgrade: budget.limit < AI_MONTHLY_LIMIT.pro,
        resets_at: budget.resetsAt
      })
    }
  } else {
    // Anonymous: IP-based burst limit only.
    if (isIpRateLimited(ip)) return res.status(429).json({ error: 'Too many requests — sign in for a higher limit' })
  }

  const apiKey = await import('./server/config.js').then(m => m.getConfig('OPENAI_API_KEY'))
  if (!apiKey) return res.status(503).json({ error: 'OpenAI API key not configured on server' })

  const { system, user, schema, schemaName, model } = req.body
  if (typeof system !== 'string' || !system.trim()) return res.status(400).json({ error: 'Missing system' })
  if (typeof user !== 'string' || !user.trim()) return res.status(400).json({ error: 'Missing user' })
  if (system.length > 8000 || user.length > 32000) return res.status(400).json({ error: 'Fields too long' })
  const resolvedModel = model || DEFAULT_MODEL
  if (!ALLOWED_MODELS.has(resolvedModel)) return res.status(400).json({ error: 'Model not allowed' })

  const body = {
    model: resolvedModel,
    temperature: 0.2,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  }
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName || 'briefing', schema, strict: true } }

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    })
    if (!upstream.ok) return res.status(upstream.status).json({ error: (await upstream.text().catch(() => '')).slice(0, 500) })
    res.json(await upstream.json())
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// --- Bootstrap --------------------------------------------------------

async function main() {
  await initSchema()

  // Auth must be registered before the api router so /api/me/* can use sessions.
  let authReady = false
  try {
    authReady = await setupAuth(app)
  } catch (err) {
    console.warn('[auth] setup failed:', err.message)
  }

  if (!authReady) {
    // Stub the auth-required endpoints so the public app still loads.
    app.get('/api/auth/user', (_req, res) => res.status(401).json({ message: 'Auth not configured' }))
    app.get('/api/login', (_req, res) => res.status(503).send('Auth not configured on this deployment'))
  }

  app.use('/api', apiRouter)
  app.use('/api/billing', billingRouter)
  app.use('/api/admin', adminRouter)

  // Bootstrap first admin from INITIAL_ADMIN_EMAIL if set.
  if (process.env.INITIAL_ADMIN_EMAIL) {
    const email = process.env.INITIAL_ADMIN_EMAIL.toLowerCase().trim()
    query('UPDATE users SET is_admin = true WHERE email = $1 AND is_admin = false', [email])
      .then(r => { if (r.rowCount) console.log(`[admin] Promoted ${email} to admin`) })
      .catch(err => console.warn('[admin] Could not promote initial admin:', err.message))
  }

  // Serve the built SPA in production (single-port deploy).
  const distDir = path.join(__dirname, 'dist')
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next()
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
    console.log('[server] serving static SPA from', distDir)
  }

  startPoller()

  const PORT = Number(process.env.PORT || process.env.API_PORT || 3001)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server listening on ${PORT}`)
  })
}

main().catch(err => {
  console.error('[server] fatal:', err)
  process.exit(1)
})
