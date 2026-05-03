// Server-side alert engine. Mirrors src/lib/alertEngine.js but is a
// standalone module (no React, no browser deps) and adds the
// subscription dispatch layer.
import { query } from './db.js'
import { dispatchPush } from './push.js'
import { sendAlertEmail } from './mail.js'
import { dispatchWebhook } from './webhooks.js'

export const ALERT_LEVELS = {
  GREEN: { label: 'Normal', priority: 0 },
  YELLOW: { label: 'Early rise detected', priority: 1 },
  ORANGE: { label: 'Rapid rise warning', priority: 2 },
  RED: { label: 'Dangerous rise', priority: 3 },
  BLACK: { label: 'Critical / catastrophic', priority: 4 }
}

export function calculateRates(history, current) {
  function delta(minutes) {
    if (!current?.time) return 0
    const ct = new Date(current.time).getTime()
    const tgt = minutes * 60 * 1000
    const past = [...history].reverse().find(p => ct - new Date(p.time).getTime() >= tgt)
    if (!past || typeof current.height !== 'number' || typeof past.height !== 'number') return 0
    return current.height - past.height
  }
  return { rise5m: delta(5), rise15m: delta(15), rise60m: delta(60) }
}

export function getAlertLevel(rates, opts = {}) {
  const { isStale = false, upstreamAlert = 'GREEN' } = opts
  const r5 = rates?.rise5m ?? 0
  const r15 = rates?.rise15m ?? 0
  const r60 = rates?.rise60m ?? 0
  if (isStale && (ALERT_LEVELS[upstreamAlert]?.priority ?? 0) >= 3) return 'BLACK'
  if (r5 >= 2 || r15 >= 4 || r60 >= 8) return 'BLACK'
  if (r5 >= 1 || r15 >= 2 || r60 >= 4) return 'RED'
  if (r5 >= 0.5 || r15 >= 1 || r60 >= 2) return 'ORANGE'
  if (r5 >= 0.2 || r15 >= 0.4 || r60 >= 0.75) return 'YELLOW'
  return 'GREEN'
}

const NOTIFY_LEVELS = ['YELLOW', 'ORANGE', 'RED', 'BLACK']

function meetsMinLevel(level, minLevel) {
  return (ALERT_LEVELS[level]?.priority ?? 0) >= (ALERT_LEVELS[minLevel]?.priority ?? 0)
}

// Single-subscription dispatch with idempotent dedup. We rely on the
// uq_notifications_dedup_sent partial unique index for atomic dedup —
// the SELECT-then-INSERT pattern was racy under concurrent ticks.
async function dispatchOne(sub, incident, channel) {
  // Pre-check: if a successful send already exists, skip.
  const dup = await query(
    `SELECT 1 FROM notifications_sent
      WHERE subscription_id = $1 AND incident_id = $2 AND channel = $3 AND status = 'sent'
      LIMIT 1`,
    [sub.id, incident.id, channel]
  )
  if (dup.rowCount > 0) return
  try {
    if (channel === 'push') await dispatchPush(sub, incident)
    else if (channel === 'email') await sendAlertEmail(sub, incident)
    else if (channel === 'webhook') await dispatchWebhook(sub, incident)
    else if (channel === 'sms') throw new Error('SMS channel requires Twilio connection — not yet configured')
    else throw new Error(`Unknown channel: ${channel}`)
    // The unique index makes this insert idempotent: if a parallel
    // dispatch already wrote the success row, we silently swallow.
    await query(
      `INSERT INTO notifications_sent (subscription_id, incident_id, channel, status)
       VALUES ($1, $2, $3, 'sent')
       ON CONFLICT DO NOTHING`,
      [sub.id, incident.id, channel]
    )
  } catch (err) {
    await query(
      `INSERT INTO notifications_sent (subscription_id, incident_id, channel, status, error)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [sub.id, incident.id, channel, String(err?.message || err).slice(0, 500)]
    )
  }
}

// Dispatch a single subscription on all of its configured channels — used
// by the test-alert endpoint so a logged-in user can verify their own
// subscription without fanning out to every other matching subscriber.
export async function dispatchToSubscription(sub, incident) {
  const channels = Array.isArray(sub.channels) ? sub.channels : []
  for (const channel of channels) {
    await dispatchOne(sub, incident, channel)
  }
}

// Called by the poller when a gauge escalates. Fans out to every enabled
// subscription that asked to be notified at this level or above.
export async function dispatchIncident(incident) {
  if (!NOTIFY_LEVELS.includes(incident.to_level)) return
  const subs = await query(
    `SELECT * FROM alert_subscriptions
     WHERE enabled = true
       AND (gauge_id IS NULL OR gauge_id = $1)`,
    [incident.gauge_id]
  )
  for (const sub of subs.rows) {
    if (!meetsMinLevel(incident.to_level, sub.min_level)) continue
    await dispatchToSubscription(sub, incident)
  }
}
