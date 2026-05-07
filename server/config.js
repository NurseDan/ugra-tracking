// Encrypted runtime configuration service.
// Values are stored in the app_config table using AES-256-GCM. The
// CONFIG_ENCRYPTION_KEY env var (64 hex chars = 32 bytes) is the only
// secret that must live in the environment — everything else can be set
// via the admin panel and is stored encrypted in Postgres.
//
// Reads check the DB first (30-second in-process cache), then fall back
// to process.env, so existing env-var deployments continue working with
// no migration.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { query } from './db.js'

const ALG = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey() {
  const k = process.env.CONFIG_ENCRYPTION_KEY
  if (!k) return null
  const buf = Buffer.from(k, 'hex')
  if (buf.length !== 32) {
    console.warn('[config] CONFIG_ENCRYPTION_KEY must be 64 hex characters (32 bytes) — encrypted config disabled')
    return null
  }
  return buf
}

function encrypt(plaintext) {
  const key = getKey()
  if (!key) throw new Error('CONFIG_ENCRYPTION_KEY not set or invalid')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALG, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decrypt(ciphertext) {
  const key = getKey()
  if (!key) throw new Error('CONFIG_ENCRYPTION_KEY not set or invalid')
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.slice(0, IV_LEN)
  const tag = buf.slice(IV_LEN, IV_LEN + TAG_LEN)
  const enc = buf.slice(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

// 30-second in-process cache to avoid a DB round-trip on every request.
const cache = new Map()
const CACHE_TTL = 30_000

export async function getConfig(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value

  try {
    const r = await query('SELECT value, encrypted FROM app_config WHERE key = $1', [key])
    if (r.rowCount) {
      const { value, encrypted } = r.rows[0]
      const plain = encrypted ? decrypt(value) : value
      cache.set(key, { value: plain, at: Date.now() })
      return plain
    }
  } catch (err) {
    console.warn(`[config] DB read for ${key} failed, falling back to env:`, err.message)
  }

  // Fall back to environment variable.
  return process.env[key] ?? null
}

export async function setConfig(key, value, shouldEncrypt = true) {
  const stored = shouldEncrypt ? encrypt(value) : value
  await query(
    `INSERT INTO app_config (key, value, encrypted, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, encrypted = EXCLUDED.encrypted, updated_at = now()`,
    [key, stored, shouldEncrypt]
  )
  cache.delete(key)
}

export async function deleteConfig(key) {
  await query('DELETE FROM app_config WHERE key = $1', [key])
  cache.delete(key)
}

export async function listConfigMeta() {
  const r = await query('SELECT key, encrypted, updated_at FROM app_config ORDER BY key')
  return r.rows
}

export function encryptionAvailable() {
  return !!getKey()
}
