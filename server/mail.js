// Replit Mail wrapper (JS port of the Replit Mail blueprint snippet).
// Sends to the verified Replit email of the workspace owner — used for
// alert delivery to logged-in subscribers.
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const exec = promisify(execFile)

async function getAuth() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  if (!hostname) throw new Error('REPLIT_CONNECTORS_HOSTNAME not set')
  const { stdout } = await exec(
    'replit',
    ['identity', 'create', '--audience', `https://${hostname}`],
    { encoding: 'utf8' }
  )
  const token = stdout.trim()
  if (!token) throw new Error('Replit identity token not available')
  return { authToken: `Bearer ${token}`, hostname }
}

export async function sendEmail({ subject, text, html, to }) {
  const { authToken, hostname } = await getAuth()
  const body = { subject, text, html }
  if (to) body.to = to
  const res = await fetch(`https://${hostname}/api/v2/mailer/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Replit-Authentication': authToken
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Mailer HTTP ${res.status}`)
  }
  return res.json()
}

export async function sendAlertEmail(sub, incident) {
  const subject = `[Guadalupe Sentinel] ${incident.gauge_name || incident.gauge_id}: ${incident.to_level}`
  const text = [
    `Alert escalated from ${incident.from_level || 'normal'} to ${incident.to_level}`,
    `Gauge: ${incident.gauge_name || incident.gauge_id}`,
    `Stage: ${incident.height_ft ?? 'n/a'} ft`,
    `Flow: ${incident.flow_cfs ?? 'n/a'} cfs`,
    `Time: ${new Date(incident.occurred_at).toISOString()}`,
    '',
    `View: ${process.env.PUBLIC_URL || ''}/gauge/${incident.gauge_id}`
  ].join('\n')
  const html = `
    <div style="font-family:system-ui,sans-serif">
      <h2 style="margin:0 0 8px">${incident.gauge_name || incident.gauge_id}</h2>
      <p><strong>${incident.from_level || 'normal'} → ${incident.to_level}</strong></p>
      <ul>
        <li>Stage: ${incident.height_ft ?? 'n/a'} ft</li>
        <li>Flow: ${incident.flow_cfs ?? 'n/a'} cfs</li>
        <li>Time: ${new Date(incident.occurred_at).toISOString()}</li>
      </ul>
      <p><a href="${process.env.PUBLIC_URL || ''}/gauge/${incident.gauge_id}">Open gauge dashboard</a></p>
    </div>
  `
  return sendEmail({ subject, text, html, to: sub.email || undefined })
}
