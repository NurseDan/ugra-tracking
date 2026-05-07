// Auth layer supporting both Replit OIDC and local email/password auth.
// Replit OIDC is used when REPL_ID is set; local auth is always available.
import * as client from 'openid-client'
import { Strategy as OidcStrategy } from 'openid-client/passport'
import passport from 'passport'
import session from 'express-session'
import connectPg from 'connect-pg-simple'
import memoize from 'memoizee'
import { query, pool } from './db.js'
import { setupLocalAuth } from './localAuth.js'

const getOidcConfig = memoize(
  async () => client.discovery(
    new URL(process.env.ISSUER_URL || 'https://replit.com/oidc'),
    process.env.REPL_ID
  ),
  { maxAge: 3600_000 }
)

// Returns the canonical user ID regardless of auth provider.
export function userId(req) {
  return req.user?.claims?.sub || req.user?.id
}

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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
}

async function upsertReplitUser(claims) {
  await query(
    `INSERT INTO users (id, email, first_name, last_name, profile_image_url, auth_provider, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'replit', now())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       profile_image_url = EXCLUDED.profile_image_url,
       updated_at = now()`,
    [claims.sub, claims.email || null, claims.first_name || null,
     claims.last_name || null, claims.profile_image_url || null]
  )
}

function attachTokens(user, tokens) {
  user.claims = tokens.claims()
  user.access_token = tokens.access_token
  user.refresh_token = tokens.refresh_token
  user.expires_at = user.claims?.exp
}

async function setupReplitAuth(app) {
  const config = await getOidcConfig()
  const verify = async (tokens, done) => {
    const user = {}
    attachTokens(user, tokens)
    try {
      await upsertReplitUser(tokens.claims())
      done(null, user)
    } catch (err) {
      done(err)
    }
  }

  const allowedDomains = new Set(
    (process.env.REPLIT_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean)
  )
  if (process.env.REPLIT_DEV_DOMAIN) allowedDomains.add(process.env.REPLIT_DEV_DOMAIN)
  if (process.env.PUBLIC_DOMAIN) allowedDomains.add(process.env.PUBLIC_DOMAIN)

  const registered = new Set()
  function ensureStrategy(domain) {
    if (!allowedDomains.has(domain)) throw new Error(`Auth not configured for host: ${domain}`)
    const name = `replitauth:${domain}`
    if (registered.has(name)) return
    passport.use(new OidcStrategy({
      name,
      config,
      scope: 'openid email profile offline_access',
      callbackURL: `https://${domain}/api/callback`
    }, verify))
    registered.add(name)
  }

  app.get('/api/login', (req, res, next) => {
    ensureStrategy(req.hostname)
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: 'login consent',
      scope: ['openid', 'email', 'profile', 'offline_access']
    })(req, res, next)
  })

  app.get('/api/callback', (req, res, next) => {
    ensureStrategy(req.hostname)
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: '/my-alerts',
      failureRedirect: '/login'
    })(req, res, next)
  })

  app.get('/api/logout', (req, res) => {
    req.logout(() => {
      try {
        const url = client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`
        }).href
        res.redirect(url)
      } catch {
        res.redirect('/')
      }
    })
  })

  console.log('[auth] Replit Auth ready')
}

export async function setupAuth(app) {
  app.set('trust proxy', 1)
  app.use(buildSession())
  app.use(passport.initialize())
  app.use(passport.session())

  passport.serializeUser((user, cb) => cb(null, user))
  passport.deserializeUser((user, cb) => cb(null, user))

  // Local auth is always available regardless of platform.
  setupLocalAuth(app)

  // Replit OIDC is optional — only configured when REPL_ID is present.
  if (process.env.REPL_ID) {
    try {
      await setupReplitAuth(app)
    } catch (err) {
      console.warn('[auth] Replit OIDC setup failed:', err.message)
    }
  }

  // Shared /api/auth/user and /api/logout routes (logout for local auth).
  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    const id = userId(req)
    if (!id) return res.status(401).json({ message: 'Unauthorized' })
    const r = await query(
      'SELECT id, email, first_name, last_name, profile_image_url, plan FROM users WHERE id = $1',
      [id]
    )
    res.json(r.rows[0] || null)
  })

  // Local-auth logout (Replit OIDC overrides this above if REPL_ID is set).
  if (!process.env.REPL_ID) {
    app.get('/api/logout', (req, res) => {
      req.logout(() => res.redirect('/'))
    })
  }

  console.log('[auth] Auth ready (local auth always enabled)')
  return true
}

// isAuthenticated works for both Replit OIDC users (token expiry/refresh)
// and local password users (session-based, no token to refresh).
export const isAuthenticated = async (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: 'Unauthorized' })
  }
  const user = req.user
  // Replit users carry an expires_at claim; refresh the token if stale.
  if (user.expires_at) {
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
  // Local auth: session presence is sufficient.
  return next()
}
