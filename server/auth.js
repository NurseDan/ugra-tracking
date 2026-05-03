// Replit Auth (OIDC) — JS port of the standard blueprint, adapted to our
// plain JS Express server. Stores users + sessions in Postgres.
import * as client from 'openid-client'
import { Strategy as OidcStrategy } from 'openid-client/passport'
import passport from 'passport'
import session from 'express-session'
import connectPg from 'connect-pg-simple'
import memoize from 'memoizee'
import { query, pool } from './db.js'

const getOidcConfig = memoize(
  async () => client.discovery(
    new URL(process.env.ISSUER_URL || 'https://replit.com/oidc'),
    process.env.REPL_ID
  ),
  { maxAge: 3600_000 }
)

function buildSession() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required for Replit Auth')
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

async function upsertUser(claims) {
  await query(
    `INSERT INTO users (id, email, first_name, last_name, profile_image_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
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

export async function setupAuth(app) {
  if (!process.env.REPL_ID) {
    console.warn('[auth] REPL_ID not set — auth routes will return 503')
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
      await upsertUser(tokens.claims())
      done(null, user)
    } catch (err) {
      done(err)
    }
  }

  // Bound the strategy registry to the domains the deployment is
  // actually configured for. Without this an attacker could send
  // `Host: <anything>` headers to make us register an unbounded number
  // of passport strategies (memory DoS).
  const allowedDomains = new Set(
    (process.env.REPLIT_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean)
  )
  if (process.env.REPLIT_DEV_DOMAIN) allowedDomains.add(process.env.REPLIT_DEV_DOMAIN)
  if (process.env.PUBLIC_DOMAIN) allowedDomains.add(process.env.PUBLIC_DOMAIN)

  const registered = new Set()
  function ensureStrategy(domain) {
    if (!allowedDomains.has(domain)) {
      throw new Error(`Auth not configured for host: ${domain}`)
    }
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

  passport.serializeUser((user, cb) => cb(null, user))
  passport.deserializeUser((user, cb) => cb(null, user))

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
      failureRedirect: '/api/login'
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

  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    const sub = req.user?.claims?.sub
    if (!sub) return res.status(401).json({ message: 'Unauthorized' })
    const r = await query(
      'SELECT id, email, first_name, last_name, profile_image_url FROM users WHERE id = $1',
      [sub]
    )
    res.json(r.rows[0] || null)
  })

  console.log('[auth] Replit Auth ready')
  return true
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
