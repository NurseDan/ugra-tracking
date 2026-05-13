// Lightweight CSRF protection using the double-submit cookie pattern.
//
// On every request, we ensure a non-HttpOnly cookie called `csrf` is set
// with a 32-byte random token. State-changing requests must echo that
// token back in the `X-CSRF-Token` header. The browser cannot read or
// forge another origin's cookie thanks to SameSite=Lax, so this stops
// classic cross-origin POST attacks without breaking the same-site
// session cookie that the rest of the app relies on.
//
// We intentionally skip enforcement for:
//   - GET / HEAD / OPTIONS (read-only, no state change)
//   - /api/stripe/webhook (signed by Stripe, raw body)
//   - /api/sensors/:id/readings (machine ingest; auth still required)
//
// The token is opaque and rotates only when the cookie expires (7d).

import { randomBytes, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'csrf'
const HEADER_NAME = 'x-csrf-token'
const TOKEN_BYTES = 32
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
// Paths that legitimately POST without a browser-supplied CSRF token.
// These have their own integrity controls (signed webhook / device key).
const CSRF_EXEMPT_PREFIXES = [
  '/api/stripe/webhook',
]
const CSRF_EXEMPT_REGEXES = [
  /^\/api\/sensors\/[^/]+\/readings$/,
]

function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${opts.path || '/'}`)
  parts.push(`Max-Age=${opts.maxAge ?? 7 * 24 * 60 * 60}`)
  parts.push('SameSite=Lax')
  // Not HttpOnly: the SPA needs to read this cookie to mirror it into
  // the X-CSRF-Token header. Confidentiality of the token is not what
  // protects us — origin separation enforced by SameSite is.
  if (opts.secure !== false) parts.push('Secure')
  // Append rather than overwrite so we don't clobber the session cookie.
  const existing = res.getHeader('Set-Cookie')
  const cookie = parts.join('; ')
  if (!existing) res.setHeader('Set-Cookie', cookie)
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookie])
  else res.setHeader('Set-Cookie', [existing, cookie])
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function isExempt(path) {
  for (const p of CSRF_EXEMPT_PREFIXES) if (path.startsWith(p)) return true
  for (const re of CSRF_EXEMPT_REGEXES) if (re.test(path)) return true
  return false
}

export function csrfMiddleware(req, res, next) {
  // Ensure the cookie exists on every response so the SPA can read it.
  let token = readCookie(req, COOKIE_NAME)
  if (!token) {
    token = randomBytes(TOKEN_BYTES).toString('base64url')
    setCookie(res, COOKIE_NAME, token, { secure: process.env.NODE_ENV === 'production' })
  }
  req.csrfToken = token

  if (SAFE_METHODS.has(req.method)) return next()
  if (isExempt(req.path)) return next()
  // Only enforce on /api/* — static asset POSTs (there are none today)
  // shouldn't trip the check if added later by mistake.
  if (!req.path.startsWith('/api/')) return next()

  const supplied = req.headers[HEADER_NAME]
  if (!supplied || typeof supplied !== 'string' || !safeEqual(supplied, token)) {
    return res.status(403).json({ error: 'CSRF token missing or invalid' })
  }
  next()
}
