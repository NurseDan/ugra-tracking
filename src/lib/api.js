// Thin client wrapper around the server's /api/* endpoints.

async function jsonFetch(url, init) {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (res.status === 401) throw new Error('401: Unauthorized')
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function getCurrentUser() {
  try { return await jsonFetch('/api/auth/user') }
  catch (err) {
    if (String(err.message).startsWith('401')) return null
    throw err
  }
}

export async function listSubscriptions() {
  return jsonFetch('/api/me/subscriptions')
}

export async function createSubscription(body) {
  return jsonFetch('/api/me/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function deleteSubscription(id) {
  return jsonFetch(`/api/me/subscriptions/${id}`, { method: 'DELETE' })
}

export async function getVapidPublicKey() {
  const r = await jsonFetch('/api/push/vapid-public-key')
  return r.publicKey
}

export async function testSubscription(id) {
  return jsonFetch('/api/me/test-alert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription_id: id })
  })
}

export async function getServerIncidents(limit = 200) {
  return jsonFetch(`/api/incidents?limit=${limit}`)
}

export async function getUsage() {
  return jsonFetch('/api/me/usage')
}

export async function updateProfile(body) {
  return jsonFetch('/api/me/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function updatePreferences(body) {
  return jsonFetch('/api/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export async function signOutEverywhere() {
  return jsonFetch('/api/me/sign-out-everywhere', { method: 'POST' })
}

export async function deleteAccount() {
  return jsonFetch('/api/me', { method: 'DELETE' })
}

export async function createCheckoutSession(priceId) {
  return jsonFetch('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId }),
  })
}

export async function createPortalSession() {
  return jsonFetch('/api/stripe/portal', { method: 'POST' })
}

export async function updateUserProfile(body) {
  return jsonFetch('/api/auth/user', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function exportUrl(kind, fmt, params = {}) {
  const qs = new URLSearchParams(params).toString()
  return `/api/export/${kind}.${fmt}${qs ? `?${qs}` : ''}`
}
