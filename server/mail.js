import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

export async function sendEmail({ subject, text, html, to }) {
  if (!process.env.SMTP_HOST) throw new Error('SMTP not configured')
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  })
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
