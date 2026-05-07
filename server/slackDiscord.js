import { getConfig } from './config.js'

function alertEmoji(level) {
  return { YELLOW: '🟡', ORANGE: '🟠', RED: '🔴', BLACK: '⚫' }[level] || '🌊'
}

function buildMessage(incident) {
  const gauge = incident.gauge_name || incident.gauge_id
  const emoji = alertEmoji(incident.to_level)
  const lines = [
    `${emoji} *Guadalupe Sentinel — ${gauge}*`,
    `Alert: ${incident.from_level || 'normal'} → *${incident.to_level}*`,
    incident.height_ft != null ? `Stage: ${incident.height_ft} ft` : null,
    incident.flow_cfs  != null ? `Flow: ${incident.flow_cfs} cfs` : null
  ].filter(Boolean)
  return lines.join('\n')
}

async function buildMessageWithUrl(incident) {
  const publicUrl = await getConfig('PUBLIC_URL') || ''
  const msg = buildMessage(incident)
  return publicUrl ? `${msg}\n<${publicUrl}/gauge/${incident.gauge_id}|Open dashboard>` : msg
}

export async function sendSlackAlert(sub, incident) {
  if (!sub.slack_webhook_url) throw new Error('No Slack webhook URL on subscription')
  const text = await buildMessageWithUrl(incident)
  const r = await fetch(sub.slack_webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })
  if (!r.ok) throw new Error(`Slack webhook error ${r.status}`)
}

export async function sendDiscordAlert(sub, incident) {
  if (!sub.discord_webhook_url) throw new Error('No Discord webhook URL on subscription')
  const publicUrl = await getConfig('PUBLIC_URL') || ''
  const gauge = incident.gauge_name || incident.gauge_id
  const embed = {
    title: `${alertEmoji(incident.to_level)} ${gauge}`,
    description: `Alert escalated: **${incident.from_level || 'normal'} → ${incident.to_level}**`,
    color: { YELLOW: 0xfbbf24, ORANGE: 0xf97316, RED: 0xef4444, BLACK: 0x111111 }[incident.to_level] || 0x3b82f6,
    fields: [
      incident.height_ft != null ? { name: 'Stage', value: `${incident.height_ft} ft`, inline: true } : null,
      incident.flow_cfs  != null ? { name: 'Flow',  value: `${incident.flow_cfs} cfs`, inline: true } : null
    ].filter(Boolean),
    url: publicUrl ? `${publicUrl}/gauge/${incident.gauge_id}` : undefined,
    timestamp: new Date().toISOString()
  }
  const r = await fetch(sub.discord_webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] })
  })
  if (!r.ok) throw new Error(`Discord webhook error ${r.status}`)
}
