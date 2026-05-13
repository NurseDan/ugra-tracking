// CSRF double-submit cookie tests. Drives the middleware with a minimal
// req/res stub so we can verify each contract without spinning up Express.

import assert from 'node:assert/strict'
import { csrfMiddleware } from './csrf.js'

function makeReqRes({ method = 'GET', path = '/api/me/profile', cookie, header } = {}) {
  const headers = {}
  if (cookie) headers.cookie = cookie
  if (header !== undefined) headers['x-csrf-token'] = header
  const req = { method, path, headers }
  const res = {
    statusCode: 200,
    body: null,
    _headers: {},
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; this.ended = true; return this },
    setHeader(k, v) { this._headers[k.toLowerCase()] = v },
    getHeader(k) { return this._headers[k.toLowerCase()] },
  }
  return { req, res }
}

function tokenFromSetCookie(res) {
  const sc = res.getHeader('set-cookie')
  const line = Array.isArray(sc) ? sc[0] : sc
  const m = /^csrf=([^;]+)/.exec(line || '')
  return m ? decodeURIComponent(m[1]) : null
}

// 1. A GET issues a fresh cookie and calls next().
{
  const { req, res } = makeReqRes({ method: 'GET' })
  let nextCalled = false
  csrfMiddleware(req, res, () => { nextCalled = true })
  assert.ok(nextCalled, 'GET should pass through')
  assert.ok(tokenFromSetCookie(res), 'GET should set the csrf cookie')
  assert.equal(req.csrfToken?.length > 20, true, 'token should look random')
}

// 2. An unauthenticated POST without matching header is rejected with 403.
{
  const { req, res } = makeReqRes({
    method: 'POST',
    cookie: 'csrf=abc123',
    // no x-csrf-token header
  })
  csrfMiddleware(req, res, () => { throw new Error('next should not be called') })
  assert.equal(res.statusCode, 403, 'missing header must 403')
  assert.match(res.body.error, /CSRF/i)
}

// 3. POST with a non-matching header is rejected.
{
  const { req, res } = makeReqRes({
    method: 'POST',
    cookie: 'csrf=correct-token',
    header: 'wrong-token',
  })
  csrfMiddleware(req, res, () => { throw new Error('next should not be called') })
  assert.equal(res.statusCode, 403)
}

// 4. POST with a matching header succeeds.
{
  const { req, res } = makeReqRes({
    method: 'POST',
    cookie: 'csrf=matching-token',
    header: 'matching-token',
  })
  let nextCalled = false
  csrfMiddleware(req, res, () => { nextCalled = true })
  assert.ok(nextCalled, 'matching token should pass')
  assert.notEqual(res.statusCode, 403)
}

// 5. Exempt path (Stripe webhook) is allowed without a token even on POST.
{
  const { req, res } = makeReqRes({ method: 'POST', path: '/api/stripe/webhook' })
  let nextCalled = false
  csrfMiddleware(req, res, () => { nextCalled = true })
  assert.ok(nextCalled, 'Stripe webhook must be CSRF-exempt')
}

// 6. Exempt sensor reading ingest is allowed (machine-to-machine; auth still applies).
{
  const { req, res } = makeReqRes({
    method: 'POST',
    path: '/api/sensors/abc-123/readings',
  })
  let nextCalled = false
  csrfMiddleware(req, res, () => { nextCalled = true })
  assert.ok(nextCalled, 'sensor ingest must be CSRF-exempt')
}

// 7. Same-length tokens with one byte changed are still rejected (constant-time
//    comparison sanity check).
{
  const a = 'a'.repeat(32)
  const b = 'a'.repeat(31) + 'b'
  const { req, res } = makeReqRes({
    method: 'POST',
    cookie: `csrf=${a}`,
    header: b,
  })
  csrfMiddleware(req, res, () => { throw new Error('next should not be called') })
  assert.equal(res.statusCode, 403)
}

console.log('csrf: all tests passed')
