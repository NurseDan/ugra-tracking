import pg from 'pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set — server will not be able to persist data')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000
})

pool.on('error', err => console.error('[db] pool error:', err))

export async function query(text, params) {
  return pool.query(text, params)
}

export async function initSchema() {
  const here = dirname(fileURLToPath(import.meta.url))
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8')

  let retries = 15
  while (retries > 0) {
    try {
      await pool.query(sql)
      console.log('[db] schema ready')

      try {
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`)
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`)
      } catch (err) {
        console.warn('[db] stripe column migration failed:', err.message)
      }
      return
    } catch (err) {
      const isTransient = err.code === '57P03' || err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH'
      if (isTransient) {
        console.warn(`[db] Database unavailable (${err.code}), retrying in 3s... (${retries} left)`)
        await new Promise(r => setTimeout(r, 3000))
        retries--
      } else {
        throw err
      }
    }
  }
  throw new Error('[db] Failed to initialize database schema after multiple retries')
}
