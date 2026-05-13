import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { initSchema, query } from './server/db.js'
import { startPoller } from './server/poller.js'
import { setupAuth } from './server/auth.js'
import apiRouter from './server/api.js'
import { callProvider, getUserLlmConfig, open as openSealed } from './server/llm.js'
import { csrfMiddleware } from './server/csrf.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()

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

// --- Existing OpenAI proxy --------------------------------------------

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'
const ALLOWED_MODELS = new Set(['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'])
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
  const userId = req.user?.id ?? (sub ? `google:${sub}` : null)

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

  // 2) Fall back to the server-funded key, gated by plan quota. This stays
  //    available so anonymous-but-allowed callers (e.g. when OPENAI_API_KEY
  //    is set and the plan allows it) still work.
  const apiKey = process.env.OPENAI_API_KEY
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
    return res.status(402).json({ error: 'Server-funded AI is disabled on your plan. Add your own API key under Account → AI Key for unlimited use.' })
  if (userId && limits.aiCallsPerDay !== Infinity) {
    const { query: dbQuery } = await import('./server/db.js')
    const usageRow = await dbQuery(
      'SELECT request_count FROM ai_usage WHERE user_id=$1 AND date=CURRENT_DATE', [userId])
    const used = usageRow.rows[0]?.request_count ?? 0
    res.set('X-RateLimit-Limit', limits.aiCallsPerDay)
    res.set('X-RateLimit-Remaining', Math.max(0, limits.aiCallsPerDay - used))
    if (used >= limits.aiCallsPerDay)
      return res.status(429).json({ error: `Daily AI limit reached (${limits.aiCallsPerDay}). Add your own API key for unlimited use.` })
  }

  const body = {
    model: resolvedModel,
    temperature: 0.2,
    max_tokens: cappedMaxTokens,
    messages: [{ role: 'system', content: cleanSystem }, { role: 'user', content: cleanUser }]
  }
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName || 'briefing', schema, strict: true } }
  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    })
    if (!upstream.ok) return res.status(upstream.status).json({ error: (await upstream.text().catch(() => '')).slice(0, 500) })
    const result = await upstream.json()

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

    res.json(result)
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
