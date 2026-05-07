import bcrypt from 'bcryptjs'
import { Strategy as LocalStrategy } from 'passport-local'
import passport from 'passport'
import { randomUUID } from 'node:crypto'
import { query } from './db.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function setupLocalAuth(app) {
  passport.use('local', new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const r = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])
        const user = r.rows[0]
        if (!user || !user.password_hash) {
          return done(null, false, { message: 'Invalid email or password' })
        }
        const match = await bcrypt.compare(password, user.password_hash)
        if (!match) return done(null, false, { message: 'Invalid email or password' })
        return done(null, {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name
        })
      } catch (err) {
        return done(err)
      }
    }
  ))

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, first_name, last_name } = req.body || {}
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    const normalEmail = email.toLowerCase().trim()
    try {
      const exists = await query('SELECT id FROM users WHERE email = $1', [normalEmail])
      if (exists.rowCount) return res.status(409).json({ error: 'Email already registered' })
      const hash = await bcrypt.hash(password, 12)
      const id = randomUUID()
      await query(
        `INSERT INTO users (id, email, first_name, last_name, auth_provider, password_hash)
         VALUES ($1, $2, $3, $4, 'local', $5)`,
        [id, normalEmail, first_name?.trim() || null, last_name?.trim() || null, hash]
      )
      const user = { id, email: normalEmail, first_name: first_name?.trim() || null, last_name: last_name?.trim() || null }
      req.login(user, err => {
        if (err) return res.status(500).json({ error: 'Login after registration failed' })
        res.json({ ok: true })
      })
    } catch {
      res.status(500).json({ error: 'Registration failed' })
    }
  })

  app.post('/api/auth/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
      if (err) return res.status(500).json({ error: 'Authentication error' })
      if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' })
      req.login(user, err => {
        if (err) return res.status(500).json({ error: 'Login failed' })
        res.json({ ok: true })
      })
    })(req, res, next)
  })

  console.log('[auth] Local email/password auth ready')
}
