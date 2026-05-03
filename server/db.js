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
  await pool.query(sql)
  console.log('[db] schema ready')
}
