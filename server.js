import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { initSchema, query } from './server/db.js'
import { startPoller } from './server/poller.js'
import { setupAuth } from './server/auth.js'
import apiRouter from './server/api.js'
import { callProvider, getUserLlmConfig, open as openSealed } from './server/llm.js'
import { handleStripeWebhook } from './server/stripe.js'
import { csrfMiddleware } from './server/csrf.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

// Lightweight liveness probe for cloud hosts. Intentionally does not touch
// the database so it can report process health independently of dependencies.
app.get('/health', (_req, res) => res.json({ ok: true }))

// --- Security headers --------------------------------------------------
// Defense-in-depth headers that cost nothing to set. The CSP allows the
// Google Fonts CDN (Inter + Fraunces) and the OAuth login pop-up, and
// permits images from data: URIs (used by the inline hill silhouette and
// Leaflet's marker tiles). connect-src is broad because the dashboard
// reaches USGS / NWS / weather.gov / ahps over HTTPS at runtime.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  )
  // CSP is intentionally not set on /api/* JSON responses — browsers only
  // honour it on document loads. Setting it once on every response is
  // harmless and protects the SPA when it's served from this same app.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' https://fonts.gstatic.com data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self'",
      "connect-src 'self' https:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join('; ')
  )
  next()
})
// Stripe webhook needs the raw body — register before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '64kb' }))

// CSRF (double-submit cookie). Mounted after express.json so we still
// parse bodies for legitimate requests, but before any router that
// would mutate state.
app.use(csrfMiddleware)

// --- Existing AI proxy --------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash'
const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'])
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20
const rateLimitMap = new Map()

function isRateLimited(ip) {
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

const sanitize = s => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

// Cache TTL for server-side AI briefing responses. Briefings are derived
// from gauge/forecast snapshots that the poller refreshes every ~5 minutes,
// so a 10 minute TTL captures repeated calls within a refresh window
// without serving truly stale narrative.
const AI_CACHE_TTL_MS = 10 * 60_000

function aiCacheKey({ model, system, user, schema }) {
  return createHash('sha256')
    .update(model + ' ' + system + ' ' + user + ' ' + JSON.stringify(schema || null))
    .digest('hex')
}

let lastCachePrune = 0
async function pruneAiCache() {
  if (Date.now() - lastCachePrune < 60_000) return
  lastCachePrune = Date.now()
  try { await query(`DELETE FROM ai_briefing_cache WHERE expires_at < now()`) }
  catch (err) { console.warn('[ai-cache] prune failed:', err.message) }
}

function assertSchemaDepth(obj, depth = 0) {
  if (depth > 5) throw Object.assign(new Error('Schema too deep'), { status: 400 })
  if (obj && typeof obj === 'object')
    for (const v of Object.values(obj)) assertSchemaDepth(v, depth + 1)
}

app.post('/api/chat', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' })

  const { system, user, schema, schemaName, model, maxTokens } = req.body
  if (typeof system !== 'string' || !system.trim()) return res.status(400).json({ error: 'Missing system' })
  if (typeof user !== 'string' || !user.trim()) return res.status(400).json({ error: 'Missing user' })
  if (system.length > 8000 || user.length > 32000) return res.status(400).json({ error: 'Fields too long' })
  try { if (schema) assertSchemaDepth(schema) }
  catch (err) { return res.status(err.status || 400).json({ error: err.message }) }

  // Clamp max_tokens to keep responses cheap by default — the whole point
  // of BYOK is that users can predict their spend.
  const cappedMaxTokens = Math.min(Math.max(parseInt(maxTokens, 10) || 400, 32), 2048)

  const cleanSystem = sanitize(system)
  const cleanUser   = sanitize(user)

  // Identify the caller (may be unauthenticated for the public proxy path).
  const sub = req.user?.claims?.sub
  const userId = req.user?.id ?? (sub ? `google:${sub}` : null) ?? req.session?.userId ?? null

  // 1) Prefer the user's own stored API key (BYOK). No plan check, no quota,
  //    no usage accounting — they're paying their provider directly.
  if (userId) {
    try {
      const cfg = await getUserLlmConfig(userId)
      if (cfg) {
        const key = openSealed({ iv: cfg.iv, ciphertext: cfg.ciphertext })
        const result = await callProvider({
          provider: cfg.provider,
          model: model || cfg.model,
          key,
          system: cleanSystem,
          user: cleanUser,
          schema,
          schemaName,
          maxTokens: cappedMaxTokens,
        })
        return res.json(result)
      }
    } catch (err) {
      const status = err.status || 502
      return res.status(status).json({ error: err.message || 'Provider error', byok: true })
    }
  }

  // 2) Fall back to the server-funded key, gated by plan quota.
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return res.status(402).json({
    error: 'No API key on file. Add your own provider key under Account → AI Key, or ask the admin to configure a shared key.'
  })

  const resolvedModel = model || DEFAULT_MODEL
  if (!ALLOWED_MODELS.has(resolvedModel)) return res.status(400).json({ error: `Model not allowed` })

  const { limitsFor } = await import('./server/plans.js')
  let plan = 'free'
  if (userId) {
    const { query: dbQuery } = await import('./server/db.js')
    const planRow = await dbQuery('SELECT plan FROM users WHERE id=$1', [userId])
    plan = planRow.rows[0]?.plan ?? 'free'
  }
  const limits = limitsFor(plan)
  if (limits.aiCallsPerDay === 0)
    return res.status(402).json({ error: 'AI briefings require a Pro subscription or your own API key. Upgrade to Pro under Account Settings, or add your own OpenAI/Anthropic key under Account → AI Key.' })
  if (userId && limits.aiCallsPerDay !== Infinity) {
    const { query: dbQuery } = await import('./server/db.js')
    const usageRow = await dbQuery(
      'SELECT request_count FROM ai_usage WHERE user_id=$1 AND date=CURRENT_DATE', [userId])
    const used = usageRow.rows[0]?.request_count ?? 0
    res.set('X-RateLimit-Limit', limits.aiCallsPerDay)
    res.set('X-RateLimit-Remaining', Math.max(0, limits.aiCallsPerDay - used))
    if (used >= limits.aiCallsPerDay)
      return res.status(429).json({ error: `Daily AI limit reached (${limits.aiCallsPerDay}). Add your own API key for unlimited use.` })

    if (limits.aiCallsPerMonth && limits.aiCallsPerMonth !== Infinity) {
      const monthRow = await dbQuery(
        `SELECT SUM(request_count) as month_count FROM ai_usage WHERE user_id=$1 AND date_trunc('month', date) = date_trunc('month', CURRENT_DATE)`, [userId])
      const usedMonth = parseInt(monthRow.rows[0]?.month_count || 0, 10)
      if (usedMonth >= limits.aiCallsPerMonth)
        return res.status(429).json({ error: `Monthly AI limit reached (${limits.aiCallsPerMonth}). Add your own API key for unlimited use.` })
    }
  }

  // Server-side cache: identical (model, system, user, schema) within the
  // TTL window returns the saved completion without spending OpenAI tokens.
  await pruneAiCache()
  const cacheKey = aiCacheKey({ model: resolvedModel, system: cleanSystem, user: cleanUser, schema })
  try {
    const hit = await query(
      `UPDATE ai_briefing_cache SET hits = hits + 1
        WHERE cache_key = $1 AND expires_at > now()
        RETURNING response`,
      [cacheKey]
    )
    if (hit.rowCount) {
      res.set('X-AI-Cache', 'hit')
      return res.json(hit.rows[0].response)
    }
  } catch (err) {
    console.warn('[ai-cache] lookup failed:', err.message)
  }
  res.set('X-AI-Cache', 'miss')

  try {
    const result = await callProvider({
      provider: 'google',
      model: resolvedModel,
      key: apiKey,
      system: cleanSystem,
      user: cleanUser,
      schema,
      schemaName,
      maxTokens: cappedMaxTokens,
    })

    if (userId) {
      const { query: dbQuery } = await import('./server/db.js')
      await dbQuery(
        `INSERT INTO ai_usage (user_id, date, request_count) VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (user_id, date) DO UPDATE SET request_count = ai_usage.request_count + 1`,
        [userId])
    }

    if (schema?.required) {
      try {
        const content = result.choices?.[0]?.message?.content
        const parsed = content ? JSON.parse(content) : null
        if (parsed) {
          const missing = schema.required.filter(k => !(k in parsed))
          if (missing.length) {
            console.warn('[chat] response missing required fields:', missing)
            return res.status(502).json({ error: 'Upstream returned incomplete response', missing })
          }
        }
      } catch { /* non-JSON response — let caller handle */ }
    }

    // Persist the validated response for re-use within the TTL window.
    try {
      const expires = new Date(Date.now() + AI_CACHE_TTL_MS).toISOString()
      await query(
        `INSERT INTO ai_briefing_cache (cache_key, model, response, expires_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (cache_key) DO UPDATE
           SET response = EXCLUDED.response,
               expires_at = EXCLUDED.expires_at,
               hits = ai_briefing_cache.hits`,
        [cacheKey, resolvedModel, JSON.stringify(result), expires]
      )
    } catch (err) {
      console.warn('[ai-cache] store failed:', err.message)
    }

    res.json(result)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
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

  app.post('/api/stripe/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature']
    try {
      await handleStripeWebhook(req.body, sig)
      res.json({ received: true })
    } catch (err) {
      console.error('[stripe webhook]', err.message)
      res.status(400).json({ error: err.message })
    }
  })

  app.use('/api', apiRouter)

  app.post('/api/internal/cron', async (req, res) => {
    const { tick } = await import('./server/poller.js')
    await tick()
    res.json({ ok: true })
  })

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

  // Only start the background poller interval if not running on Cloud Run,
  // since Cloud Run scales to zero and requires a Scheduler trigger instead.
  if (!process.env.K_SERVICE) {
    startPoller()
  } else {
    console.log('[server] Running in Cloud Run environment; relying on external cron triggers.')
  }

  const PORT = Number(process.env.PORT || process.env.API_PORT || 3001)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API server listening on ${PORT}`)
  })
}

main().catch(err => {
  console.error('[server] fatal:', err)
  process.exit(1)
})
