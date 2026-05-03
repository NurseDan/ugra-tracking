import crypto from 'node:crypto'
import { lookup } from 'node:dns/promises'
import net from 'node:net'

// SSRF guard: only http(s), and the resolved IPs must all be public.
// Without this an authenticated user could ask the server to POST to
// 127.0.0.1, 169.254.169.254 (cloud metadata), or RFC1918 hosts.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true   // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true                 // multicast/reserved
    return false
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true   // ULA
    if (lower.startsWith('fe80')) return true                            // link-local
    if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7))  // mapped v4
    return false
  }
  return true
}

export async function validateWebhookUrl(rawUrl) {
  let url
  try { url = new URL(rawUrl) } catch { throw new Error('Invalid webhook URL') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Webhook URL must use http or https')
  }
  if (!url.hostname) throw new Error('Webhook URL missing host')
  // Block literal private/loopback IPs and obvious internal hostnames.
  if (/^localhost$/i.test(url.hostname)) throw new Error('Webhook host not allowed')
  let addrs
  try { addrs = await lookup(url.hostname, { all: true }) }
  catch { throw new Error('Webhook host could not be resolved') }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('Webhook host resolves to a private/internal address')
  }
  return url.href
}

export async function dispatchWebhook(sub, incident) {
  if (!sub.webhook_url) throw new Error('webhook_url not configured')
  await validateWebhookUrl(sub.webhook_url)
  const payload = JSON.stringify({
    type: 'gauge.alert.escalated',
    incident: {
      id: incident.id,
      gauge_id: incident.gauge_id,
      gauge_name: incident.gauge_name,
      from_level: incident.from_level,
      to_level: incident.to_level,
      height_ft: incident.height_ft,
      flow_cfs: incident.flow_cfs,
      occurred_at: incident.occurred_at
    },
    sent_at: new Date().toISOString()
  })
  const headers = { 'Content-Type': 'application/json' }
  if (sub.webhook_secret) {
    const sig = crypto.createHmac('sha256', sub.webhook_secret).update(payload).digest('hex')
    headers['X-Sentinel-Signature'] = `sha256=${sig}`
  }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 10_000)
  try {
    const res = await fetch(sub.webhook_url, {
      method: 'POST', headers, body: payload, signal: ctl.signal
    })
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`)
  } finally {
    clearTimeout(t)
  }
}
