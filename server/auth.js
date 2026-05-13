import * as client from 'openid-client'
import { Strategy as OidcStrategy } from 'openid-client/passport'
import passport from 'passport'
import session from 'express-session'
import connectPg from 'connect-pg-simple'
import memoize from 'memoizee'
import { query, pool } from './db.js'

const getOidcConfig = memoize(
  async () => client.discovery(
    new URL('https://accounts.google.com'),
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  ),
  { maxAge: 3600_000 }
)

function buildSession() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required')
  }
  const PgStore = connectPg(session)
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    ttl: 7 * 24 * 60 * 60
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
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
}

function adminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  )
}

async function upsertUser(claims) {
  const id = `google:${claims.sub}`
  await query(
    `INSERT INTO users (id, email, first_name, last_name, profile_image_url, provider, provider_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'google', $6, now())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       profile_image_url = EXCLUDED.profile_image_url,
       provider_id = EXCLUDED.provider_id,
       updated_at = now()`,
    [
      id,
      claims.email || null,
      claims.given_name ?? claims.first_name ?? null,
      claims.family_name ?? claims.last_name ?? null,
      claims.picture ?? claims.profile_image_url ?? null,
      claims.sub
    ]
  )
  // Promote configured admin emails. Promotion only happens on a verified
  // Google login, never via password — there is no shared admin credential
  // to leak. Demotion happens automatically if the email is removed from
  // ADMIN_EMAILS so a former admin loses access on next sign-in.
  // Strict verification: require an explicit true so a future OIDC provider
  // that omits the claim never accidentally hands out admin rights. Google
  // always populates email_verified, so this doesn't break the current flow.
  const admins = adminEmails()
  const email = (claims.email || '').toLowerCase()
  const verified = claims.email_verified === true
  if (email && verified) {
    if (admins.has(email)) {
      await query("UPDATE users SET plan = 'admin' WHERE id = $1 AND plan <> 'admin'", [id])
    } else {
      // Auto-demote anyone who was previously promoted but is no longer on
      // the env list. Paid plans are unaffected because we only touch 'admin'.
      await query("UPDATE users SET plan = 'free' WHERE id = $1 AND plan = 'admin'", [id])
    }
  }
  return id
}

function attachTokens(user, tokens) {
  user.claims = tokens.claims()
  user.access_token = tokens.access_token
  user.refresh_token = tokens.refresh_token
  user.expires_at = user.claims?.exp
}

export async function setupAuth(app) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn('[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — auth routes will return 503')
    return false
  }

  app.set('trust proxy', 1)
  app.use(buildSession())
  app.use(passport.initialize())
  app.use(passport.session())

  const config = await getOidcConfig()
  const verify = async (tokens, done) => {
    const user = {}
    attachTokens(user, tokens)
    try {
      const id = await upsertUser(tokens.claims())
      // Store our composite id so downstream code can reference it directly.
      user.id = id
      done(null, user)
    } catch (err) {
      done(err)
    }
  }

  const allowedDomains = new Set(
    (process.env.ALLOWED_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean)
  )
  if (process.env.PUBLIC_DOMAIN) allowedDomains.add(process.env.PUBLIC_DOMAIN)

  const registered = new Set()
  function ensureStrategy(domain) {
    if (!allowedDomains.has(domain)) {
      throw new Error(`Auth not configured for host: ${domain}`)
    }
    const name = `googleauth:${domain}`
    if (registered.has(name)) return
    passport.use(new OidcStrategy({
      name,
      config,
      scope: 'openid email profile',
      callbackURL: `https://${domain}/api/callback`
    }, verify))
    registered.add(name)
  }

  passport.serializeUser((user, cb) => cb(null, user))
  passport.deserializeUser((user, cb) => cb(null, user))

  app.get('/api/login', (req, res, next) => {
    ensureStrategy(req.hostname)
    passport.authenticate(`googleauth:${req.hostname}`, {
      access_type: 'offline',
      prompt: 'consent',
      scope: ['openid', 'email', 'profile']
    })(req, res, next)
  })

  app.get('/api/callback', (req, res, next) => {
    ensureStrategy(req.hostname)
    passport.authenticate(`googleauth:${req.hostname}`, {
      successReturnToOrRedirect: '/my-alerts',
      failureRedirect: '/api/login'
    })(req, res, next)
  })

  app.get('/api/logout', (req, res) => {
    req.logout(() => {
      res.redirect('/')
    })
  })

  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    const sub = req.user?.claims?.sub
    if (!sub) return res.status(401).json({ message: 'Unauthorized' })
    const id = `google:${sub}`
    const r = await query(
      `SELECT id, email, first_name, last_name, profile_image_url, plan, phone,
              stripe_customer_id, stripe_subscription_id,
              default_email, default_min_level, default_channels
         FROM users WHERE id = $1`,
      [id]
    )
    res.json(r.rows[0] || null)
  })

  app.patch('/api/auth/user', isAuthenticated, async (req, res) => {
    const sub = req.user?.claims?.sub
    if (!sub) return res.status(401).json({ message: 'Unauthorized' })
    const id = `google:${sub}`
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
  })

  console.log('[auth] Google OAuth ready')
  return true
}

export const isAdmin = async (req, res, next) => {
  return isAuthenticated(req, res, async () => {
    try {
      const id = req.user?.id ?? (req.user?.claims?.sub ? `google:${req.user.claims.sub}` : null)
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
  const user = req.user
  if (!req.isAuthenticated || !req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  const now = Math.floor(Date.now() / 1000)
  if (now <= user.expires_at) return next()
  if (!user.refresh_token) return res.status(401).json({ message: 'Unauthorized' })
  try {
    const config = await getOidcConfig()
    const tokens = await client.refreshTokenGrant(config, user.refresh_token)
    attachTokens(user, tokens)
    return next()
  } catch {
    return res.status(401).json({ message: 'Unauthorized' })
  }
}
