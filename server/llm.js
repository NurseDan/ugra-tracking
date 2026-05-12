// BYOK LLM proxy. Users store their own provider API key, sealed at rest
// with AES-256-GCM. The server unseals only at request time, calls the
// provider, and never logs or returns the cleartext key.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { query } from './db.js'

const SECRET = process.env.LLM_KEY_SECRET || process.env.SESSION_SECRET || ''
if (!SECRET) {
  console.warn('[llm] LLM_KEY_SECRET and SESSION_SECRET both unset — BYOK keys cannot be sealed.')
}
// Derive a 32-byte key from whatever secret material is available.
const KEY = SECRET ? createHash('sha256').update(SECRET).digest() : null

export const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    style: 'openai',
  },
  anthropic: {
    label: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5-20251001',
    style: 'anthropic',
  },
  groq: {
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.1-8b-instant',
    style: 'openai',
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    style: 'openai',
  },
}

export function isValidProvider(p) {
  return typeof p === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, p)
}

export function seal(plaintext) {
  if (!KEY) throw new Error('Encryption secret not configured')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Store (ciphertext || tag) so the layout is self-contained.
  return { iv, ciphertext: Buffer.concat([ct, tag]) }
}

export function open({ iv, ciphertext }) {
  if (!KEY) throw new Error('Encryption secret not configured')
  const buf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext)
  const tag = buf.subarray(buf.length - 16)
  const ct  = buf.subarray(0, buf.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.isBuffer(iv) ? iv : Buffer.from(iv))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

export async function getUserLlmConfig(userId) {
  if (!userId) return null
  const r = await query(
    `SELECT provider, model, ciphertext, iv, last_four, updated_at
       FROM user_llm_keys WHERE user_id = $1`, [userId])
  if (!r.rowCount) return null
  return r.rows[0]
}

export async function storeUserLlmKey(userId, { provider, model, key }) {
  if (!isValidProvider(provider)) throw new Error('Unsupported provider')
  if (typeof key !== 'string' || key.length < 8 || key.length > 512)
    throw new Error('Invalid API key')
  const { iv, ciphertext } = seal(key)
  const lastFour = key.slice(-4)
  const cleanModel = model ? String(model).slice(0, 80) : null
  await query(
    `INSERT INTO user_llm_keys (user_id, provider, model, ciphertext, iv, last_four)
       VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE
       SET provider = EXCLUDED.provider,
           model = EXCLUDED.model,
           ciphertext = EXCLUDED.ciphertext,
           iv = EXCLUDED.iv,
           last_four = EXCLUDED.last_four,
           updated_at = now()`,
    [userId, provider, cleanModel, ciphertext, iv, lastFour]
  )
}

export async function deleteUserLlmKey(userId) {
  await query('DELETE FROM user_llm_keys WHERE user_id = $1', [userId])
}

// Token-economical chat. Caller passes already-sanitized strings.
// maxTokens defaults to 400 so users on their own key don't get surprise
// bills from a runaway response.
export async function callProvider({ provider, model, key, system, user, schema, schemaName, maxTokens = 400 }) {
  const p = PROVIDERS[provider]
  if (!p) throw Object.assign(new Error('Unsupported provider'), { status: 400 })
  const resolvedModel = model || p.defaultModel

  let body, headers
  if (p.style === 'anthropic') {
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }
    body = {
      model: resolvedModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }
  } else {
    headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    }
    body = {
      model: resolvedModel,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }
    if (schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: schemaName || 'briefing', schema, strict: true },
      }
    }
  }

  const upstream = await fetch(p.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!upstream.ok) {
    const text = (await upstream.text().catch(() => '')).slice(0, 500)
    const err = new Error(text || `Upstream ${upstream.status}`)
    err.status = upstream.status
    throw err
  }
  const raw = await upstream.json()

  // Normalize to the OpenAI choices[0].message.content shape that the
  // client code expects, so BYOK Anthropic users get the same response.
  if (p.style === 'anthropic') {
    const content = raw.content?.find(c => c.type === 'text')?.text ?? ''
    return {
      choices: [{ message: { role: 'assistant', content } }],
      usage: raw.usage,
      model: raw.model,
      provider,
    }
  }
  return { ...raw, provider }
}
