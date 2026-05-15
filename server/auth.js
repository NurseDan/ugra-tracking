import session from 'express-session'
import connectPg from 'connect-pg-simple'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { query, pool } from './db.js'

// 7-day session lifetime; we only push the expiration forward once it has
// burned through more than half its window. That cuts the per-request
// session-row UPDATE that connect-pg-simple does by default (every API
// call, every poll tick) down to at most one UPDATE per (window / 2).
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_THRESHOLD_MS = Math.floor(SESSION_MAX_AGE_MS / 2)

function buildSession() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required')
  }
  const PgStore = connectPg(session)
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    ttl: SESSION_MAX_AGE_MS / 1000,
    disableTouch: true,
  })
  return session({
    secret: process.env.SESSION_SECRET,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    },
  })
}

function sessionRefresh(req, _res, next) {
  if (!req.session || !req.sessionID || !req.sessionStore?.touch) return next()
  const expires = req.session.cookie?.expires
  const expiresMs = expires ? new Date(expires).getTime() : 0
  const remaining = expiresMs - Date.now()
  if (remaining > 0 && remaining < SESSION_REFRESH_THRESHOLD_MS) {
    req.session.cookie.maxAge = SESSION_MAX_AGE_MS
    req.sessionStore.touch(req.sessionID, req.session, () => {})
  }
  next()
}

export async function setupAuth(app) {
  app.set('trust proxy', 1)
  app.use(buildSession())
  app.use(sessionRefresh)

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, first_name, last_name } = req.body
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
      }
      
      const normalizedEmail = email.toLowerCase().trim()
      
      // Check if user exists
      const existing = await query('SELECT id, password_hash FROM users WHERE email = $1', [normalizedEmail])
      if (existing.rows.length > 0) {
        if (existing.rows[0].password_hash) {
          return res.status(409).json({ error: 'Account already exists for this email' })
        } else {
          // Allow setting a password for an existing OAuth account
          const hash = await bcrypt.hash(password, 10)
          await query(
            `UPDATE users SET password_hash = $1, provider = 'local', first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), updated_at = now() WHERE id = $4`,
            [hash, first_name?.trim() || null, last_name?.trim() || null, existing.rows[0].id]
          )
          req.session.userId = existing.rows[0].id
          return res.json({ ok: true, id: existing.rows[0].id })
        }
      }

      const hash = await bcrypt.hash(password, 10)
      const id = crypto.randomUUID()
      
      await query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, provider, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'local', now())`,
        [id, normalizedEmail, hash, first_name?.trim() || null, last_name?.trim() || null]
      )

      req.session.userId = id
      res.json({ ok: true, id })
    } catch (err) {
      console.error('Registration error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
      }

      const normalizedEmail = email.toLowerCase().trim()
      const result = await query('SELECT id, password_hash FROM users WHERE email = $1', [normalizedEmail])
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }

      const user = result.rows[0]
      if (!user.password_hash) {
        return res.status(401).json({ error: 'Please sign up to set a password for this account.' })
      }

      const match = await bcrypt.compare(password, user.password_hash)
      if (!match) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }

      req.session.userId = user.id
      res.json({ ok: true })
    } catch (err) {
      console.error('Login error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid', { path: '/' })
      res.json({ ok: true })
    })
  })

  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    try {
      const id = req.session.userId
      const r = await query(
        `SELECT id, email, first_name, last_name, profile_image_url, plan, phone,
                default_email, default_min_level, default_channels
           FROM users WHERE id = $1`,
        [id]
      )
      res.json(r.rows[0] || null)
    } catch (err) {
      console.error('Get user error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.patch('/api/auth/user', isAuthenticated, async (req, res) => {
    try {
      const id = req.session.userId
      const { first_name, last_name, phone } = req.body || {}
      await query(
        `UPDATE users SET
           first_name = COALESCE($2, first_name),
           last_name  = COALESCE($3, last_name),
           phone      = COALESCE($4, phone),
           updated_at = now()
         WHERE id = $1`,
        [id, first_name?.trim() || null, last_name?.trim() || null, phone?.trim() || null]
      )
      res.json({ ok: true })
    } catch (err) {
      console.error('Update user error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  console.log('[auth] Local Auth ready')
  return true
}

export const isAdmin = async (req, res, next) => {
  return isAuthenticated(req, res, async () => {
    try {
      const id = req.session?.userId
      if (!id) return res.status(401).json({ error: 'Unauthorized' })
      const r = await query('SELECT plan FROM users WHERE id = $1', [id])
      if (r.rows[0]?.plan !== 'admin') return res.status(403).json({ error: 'Forbidden' })
      next()
    } catch {
      res.status(500).json({ error: 'Internal server error' })
    }
  })
}

export const isAuthenticated = async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  next()
}
