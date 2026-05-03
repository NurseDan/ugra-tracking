import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { initSchema, query } from './server/db.js'
import { startPoller } from './server/poller.js'
import { setupAuth } from './server/auth.js'
import apiRouter from './server/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json({ limit: '64kb' }))

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

app.post('/api/chat', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' })
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return res.status(503).json({ error: 'OpenAI API key not configured on server' })
  const { system, user, schema, schemaName, model } = req.body
  if (typeof system !== 'string' || !system.trim()) return res.status(400).json({ error: 'Missing system' })
  if (typeof user !== 'string' || !user.trim()) return res.status(400).json({ error: 'Missing user' })
  if (system.length > 8000 || user.length > 32000) return res.status(400).json({ error: 'Fields too long' })
  const resolvedModel = model || DEFAULT_MODEL
  if (!ALLOWED_MODELS.has(resolvedModel)) return res.status(400).json({ error: `Model not allowed` })
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
