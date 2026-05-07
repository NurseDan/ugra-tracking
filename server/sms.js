import { getConfig } from './config.js'

export async function sendSms(to, body) {
  const [accountSid, authToken, from] = await Promise.all([
    getConfig('TWILIO_ACCOUNT_SID'),
    getConfig('TWILIO_AUTH_TOKEN'),
    getConfig('TWILIO_FROM_NUMBER')
  ])
  if (!accountSid || !authToken || !from) {
    throw new Error('SMS not configured. Set Twilio credentials in the admin panel.')
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString()
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.message || `Twilio error ${r.status}`)
  }
  return r.json()
}

export async function sendAlertSms(sub, incident) {
  if (!sub.phone) throw new Error('No phone number on subscription')
  const publicUrl = await getConfig('PUBLIC_URL') || ''
  const body = [
    `[Guadalupe Sentinel] ${incident.gauge_name || incident.gauge_id}`,
    `${incident.from_level || 'normal'} → ${incident.to_level}`,
    incident.height_ft != null ? `Stage: ${incident.height_ft} ft` : null,
    `${publicUrl}/gauge/${incident.gauge_id}`
  ].filter(Boolean).join('\n')
  return sendSms(sub.phone, body)
}
