// Thin client wrapper around the server's /api/* endpoints.

export const API_BASE = (typeof window !== 'undefined' && window.Capacitor?.isNative)
  ? 'https://ugra-b9zkhu1q3-daniel-wiglesworths-projects.vercel.app'
  : ''

async function jsonFetch(url, init) {
  const fullUrl = url.startsWith('/') ? `${API_BASE}${url}` : url
  const res = await fetch(fullUrl, { credentials: 'same-origin', ...init })
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

export function exportUrl(kind, fmt, params = {}) {
  const qs = new URLSearchParams(params).toString()
  return `${API_BASE}/api/export/${kind}.${fmt}${qs ? `?${qs}` : ''}`
}
