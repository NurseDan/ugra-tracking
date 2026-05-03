import webpush from 'web-push'
import { query } from './db.js'

let configured = false
let publicKey = null

export async function ensureVapid() {
  if (configured) return publicKey
  const existing = await query('SELECT * FROM vapid_keys WHERE id = 1')
  let row = existing.rows[0]
  if (!row) {
    const keys = webpush.generateVAPIDKeys()
    const subject = process.env.VAPID_SUBJECT || 'mailto:ops@guadalupe-sentinel.local'
    await query(
      `INSERT INTO vapid_keys (id, public_key, private_key, subject) VALUES (1, $1, $2, $3)`,
      [keys.publicKey, keys.privateKey, subject]
    )
    row = { public_key: keys.publicKey, private_key: keys.privateKey, subject }
    console.log('[push] generated new VAPID keypair')
  }
  webpush.setVapidDetails(row.subject, row.public_key, row.private_key)
  publicKey = row.public_key
  configured = true
  return publicKey
}

export async function getPublicKey() {
  return ensureVapid()
}

export async function dispatchPush(sub, incident) {
  await ensureVapid()
  if (!sub.push_endpoint) throw new Error('No push endpoint registered for subscription')
  const payload = JSON.stringify({
    title: `${incident.gauge_name || incident.gauge_id}: ${incident.to_level}`,
    body: `Alert escalated from ${incident.from_level || 'normal'} to ${incident.to_level}`,
    url: `/gauge/${incident.gauge_id}`,
    tag: `alert-${incident.gauge_id}`,
    incidentId: incident.id
  })
  await webpush.sendNotification(
    {
      endpoint: sub.push_endpoint,
      keys: { p256dh: sub.push_p256dh, auth: sub.push_auth }
    },
    payload,
    { TTL: 3600 }
  )
}
