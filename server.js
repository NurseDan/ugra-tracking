import express from 'express'

const app = express()
app.use(express.json({ limit: '64kb' }))

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

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests — please wait before trying again' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'OpenAI API key not configured on server' })
  }

  const { system, user, schema, schemaName, model } = req.body

  if (typeof system !== 'string' || !system.trim()) {
    return res.status(400).json({ error: 'Missing required field: system (string)' })
  }
  if (typeof user !== 'string' || !user.trim()) {
    return res.status(400).json({ error: 'Missing required field: user (string)' })
  }
  if (system.length > 8000 || user.length > 32000) {
    return res.status(400).json({ error: 'Request fields exceed allowed length' })
  }

  const resolvedModel = model || DEFAULT_MODEL
  if (!ALLOWED_MODELS.has(resolvedModel)) {
    return res.status(400).json({ error: `Model not allowed: ${resolvedModel}` })
  }

  const body = {
    model: resolvedModel,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }

  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schemaName || 'briefing', schema, strict: true }
    }
  }

  try {
    const upstream = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return res.status(upstream.status).json({ error: text.slice(0, 500) })
    }

    const data = await upstream.json()
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

const PORT = process.env.API_PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API proxy server running on port ${PORT}`)
})
