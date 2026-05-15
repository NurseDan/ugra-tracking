import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'
import { AHPS_LIDS } from '../src/config/ahpsLids.js'
import { NWM_REACHES } from '../src/config/nwmReaches.js'
import {
  fetchUSGSCurrent, fetchOpenMeteoForecast, fetchNwsAlerts,
  fetchAhps, fetchNwm, fetchCanyonLake
} from './sources.js'
import { calculateRates, getAlertLevel, dispatchIncident, dispatchToSubscription, ALERT_LEVELS } from './alertEngine.js'

const STALE_AFTER_MIN = 20

const lastRun = {}

function shouldRun(name, intervalMs) {
  const last = lastRun[name] || 0
  if (Date.now() - last < intervalMs) return false
  lastRun[name] = Date.now()
  return true
}

function isStale(timeStr) {
  if (!timeStr) return true
  return (Date.now() - new Date(timeStr).getTime()) / 60000 > STALE_AFTER_MIN
}

async function persistReadings(siteId, history, flowHistory) {
  if (!history?.length) return
  const flowMap = new Map((flowHistory || []).map(p => [p.time, p.flow]))
  const rows = history.map(p => [siteId, p.time, p.height, flowMap.get(p.time) ?? null, 'usgs_iv'])
  const values = []
  const params = []
  rows.forEach((r, i) => {
    const off = i * 5
    values.push(`($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5})`)
    params.push(...r)
  })
  await query(
    `INSERT INTO gauge_readings (gauge_id, observed_at, height_ft, flow_cfs, source)
     VALUES ${values.join(',')}
     ON CONFLICT (gauge_id, observed_at) DO UPDATE
       SET height_ft = EXCLUDED.height_ft,
           flow_cfs  = COALESCE(EXCLUDED.flow_cfs, gauge_readings.flow_cfs)`,
    params
  )
}

async function appendHistory(source, key, payload) {
  if (!payload) return
  await query(
    `INSERT INTO source_history (source, key, observed_at, payload)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (source, key, observed_at) DO NOTHING`,
    [source, key || '', payload]
  )
}

async function pollUSGS() {
  const ids = GAUGES.map(g => g.id)
  const data = await fetchUSGSCurrent(ids)
  const prevResult = await query('SELECT gauge_id, alert_level FROM gauge_status WHERE gauge_id = ANY($1)', [ids])
  const prevLevels = new Map(prevResult.rows.map(r => [r.gauge_id, r.alert_level]))
  for (const g of GAUGES) {
    const d = data[g.id]
    if (!d) continue
    try {
      await persistReadings(g.id, d.history, d.flowHistory)
    } catch (err) {
      console.warn(`[poller] persist failed for ${g.id}:`, err.message)
    }

    const stale = isStale(d.time)
    const rates = calculateRates(d.history || [], d)
    const level = getAlertLevel(rates, { isStale: stale })
    const payload = { ...d, rates, alert: level, isStale: stale }

    const prevLevel = prevLevels.get(g.id) || 'GREEN'

    await query(
      `INSERT INTO gauge_status (gauge_id, height_ft, flow_cfs, observed_at, alert_level, rise_5m, rise_15m, rise_60m, is_stale, payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (gauge_id) DO UPDATE SET
         height_ft = EXCLUDED.height_ft,
         flow_cfs = EXCLUDED.flow_cfs,
         observed_at = EXCLUDED.observed_at,
         alert_level = EXCLUDED.alert_level,
         rise_5m = EXCLUDED.rise_5m,
         rise_15m = EXCLUDED.rise_15m,
         rise_60m = EXCLUDED.rise_60m,
         is_stale = EXCLUDED.is_stale,
         payload = EXCLUDED.payload,
         updated_at = now()`,
      [g.id, d.height ?? null, d.flow ?? null, d.time || null, level,
       rates.rise5m, rates.rise15m, rates.rise60m, stale, payload]
    )

    const prevPri = ALERT_LEVELS[prevLevel]?.priority ?? 0
    const newPri = ALERT_LEVELS[level]?.priority ?? 0
    if (newPri > prevPri) {
      const inc = await query(
        `INSERT INTO incidents (gauge_id, gauge_name, from_level, to_level, height_ft, flow_cfs, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [g.id, g.name, prevLevel, level, d.height ?? null, d.flow ?? null, payload]
      )
      console.log(`[poller] ESCALATION ${g.id}: ${prevLevel} -> ${level}`)
      try {
        await dispatchIncident(inc.rows[0])
      } catch (err) {
        console.warn(`[poller] dispatch failed for ${g.id}:`, err.message)
      }
    }
  }
  console.log(`[poller] usgs done (${Object.keys(data).length} gauges)`)
}

async function cacheSource(key, fetcher, historySource = null, historyKey = '') {
  try {
    const payload = await fetcher()
    if (payload === null || payload === undefined) return null
    await query(
      `INSERT INTO source_cache (key, fetched_at, payload) VALUES ($1, now(), $2)
       ON CONFLICT (key) DO UPDATE SET fetched_at = now(), payload = EXCLUDED.payload`,
      [key, payload]
    )
    if (historySource) await appendHistory(historySource, historyKey, payload)
    return payload
  } catch (err) {
    console.warn(`[poller] cache ${key} failed:`, err.message)
    return null
  }
}

async function pollWeather() {
  await Promise.all(GAUGES.map(g =>
    cacheSource(`weather:${g.id}`, () => fetchOpenMeteoForecast(g.lat, g.lng), 'weather', g.id)
  ))
  console.log('[poller] weather done')
}

// Track which NWS alert ids we've already dispatched per cycle so we
// don't re-dispatch the same alert every 2 minutes for the duration of
// its lifetime. The notifications_sent unique index is the durable
// guarantee — this is just a fast in-memory short-circuit.
const nwsDispatchedAlerts = new Set()

async function dispatchNwsAlert(alert) {
  if (!alert?.id) return
  // Fast in-memory short-circuit. We DO NOT add to this set until the
  // subscription loop completes successfully — otherwise a transient DB
  // error on the first tick would permanently skip this alert. Durable
  // dedup is enforced by the uq_notifications_dedup_sent partial unique
  // index, so even if we re-enter this function multiple ticks in a row,
  // each subscription/channel gets exactly one successful send.
  if (nwsDispatchedAlerts.has(alert.id)) return

  const ugcs = Array.isArray(alert.ugcCodes) ? alert.ugcCodes : []
  if (!ugcs.length) {
    nwsDispatchedAlerts.add(alert.id) // no targets — safe to mark done
    return
  }

  // Find subscriptions whose ugc_codes overlap with this alert's UGC list.
  const subs = await query(
    `SELECT * FROM alert_subscriptions
      WHERE enabled = true
        AND jsonb_array_length(ugc_codes) > 0
        AND ugc_codes ?| $1::text[]`,
    [ugcs]
  )
  let allSucceeded = true
  for (const sub of subs.rows) {
    // Optional event filter: only fire for matching event types.
    const filter = Array.isArray(sub.nws_event_filter) ? sub.nws_event_filter : []
    if (filter.length > 0 && !filter.includes(alert.event)) continue

    // Synthesize an incident-shaped record so dispatchToSubscription can
    // share the same channel pipeline. Use the NWS alert id as the
    // incident_id so DB-level dedup works across ticks.
    const fakeIncident = {
      id: alert.id,
      gauge_id: 'NWS',
      gauge_name: alert.headline || alert.event || 'NWS Alert',
      from_level: null,
      to_level: alert.severity?.toUpperCase() || 'ORANGE',
      height_ft: null,
      flow_cfs: null,
      occurred_at: alert.effective || new Date().toISOString()
    }
    try { await dispatchToSubscription(sub, fakeIncident) }
    catch (err) {
      allSucceeded = false
      console.warn('[poller] nws dispatch failed (will retry next tick):', err.message)
    }
  }
  // Only suppress further attempts when every subscriber dispatch
  // returned cleanly. dispatchOne already records 'failed' rows for
  // permanently-failed channels, so retries are bounded by the DB
  // unique index and channel-level retry budget.
  if (allSucceeded) nwsDispatchedAlerts.add(alert.id)
}

async function pollNws() {
  const cached = await cacheSource('nws_alerts', async () => {
    const alerts = await fetchNwsAlerts()
    return { alerts, fetchedAt: new Date().toISOString() }
  }, 'nws_alerts', '')
  const alerts = cached?.alerts || []
  // Trim the in-memory dedup set when alerts expire — keep it bounded.
  const liveIds = new Set(alerts.map(a => a.id))
  for (const id of nwsDispatchedAlerts) {
    if (!liveIds.has(id)) nwsDispatchedAlerts.delete(id)
  }
  for (const a of alerts) {
    try { await dispatchNwsAlert(a) }
    catch (err) { console.warn('[poller] nws dispatch err:', err.message) }
  }
  console.log(`[poller] nws done (${alerts.length} active)`)
}

async function pollAhps() {
  await Promise.all(
    Object.entries(AHPS_LIDS)
      .filter(([, lid]) => lid)
      .map(([siteId, lid]) => cacheSource(`ahps:${siteId}`, () => fetchAhps(lid), 'ahps', siteId))
  )
  console.log('[poller] ahps done')
}

async function pollNwm() {
  await Promise.all(
    Object.entries(NWM_REACHES)
      .filter(([, reach]) => reach)
      .map(([siteId, reach]) => cacheSource(`nwm:${siteId}`, () => fetchNwm(reach), 'nwm', siteId))
  )
  console.log('[poller] nwm done')
}

async function pollCanyonLake() {
  await cacheSource('canyon_lake', () => fetchCanyonLake(), 'canyon_lake', '')
  console.log('[poller] canyon lake done')
}

async function safe(name, fn) {
  try { await fn() }
  catch (err) { console.error(`[poller] ${name} failed:`, err?.message || err) }
}

let tickInFlight = false
async function tick() {
  if (tickInFlight) return
  tickInFlight = true
  try {
    if (shouldRun('usgs', 5 * 60_000))     await safe('usgs',    pollUSGS)
    if (shouldRun('nws',  2 * 60_000))     await safe('nws',     pollNws)
    if (shouldRun('ahps', 15 * 60_000))    await safe('ahps',    pollAhps)
    if (shouldRun('nwm',  15 * 60_000))    await safe('nwm',     pollNwm)
    if (shouldRun('weather', 60 * 60_000)) await safe('weather', pollWeather)
    if (shouldRun('canyon', 30 * 60_000))  await safe('canyon',  pollCanyonLake)
    if (shouldRun('retention', 24 * 60 * 60_000)) await safe('retention', runRetention)
  } finally {
    tickInFlight = false
  }
}

async function runRetention() {
  const cutoff = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString()
  const r1 = await query(`DELETE FROM gauge_readings WHERE observed_at < $1`, [cutoff])
  const r2 = await query(`DELETE FROM incidents WHERE occurred_at < $1`, [cutoff])
  const r3 = await query(`DELETE FROM source_history WHERE observed_at < $1`, [cutoff])
  const r4 = await query(`DELETE FROM notifications_sent WHERE sent_at < now() - interval '90 days'`)
  const r5 = await query(`DELETE FROM sessions WHERE expire < now()`)
  console.log(`[poller] retention: readings=${r1.rowCount} incidents=${r2.rowCount} source_history=${r3.rowCount} notifs=${r4.rowCount} sessions=${r5.rowCount}`)
}

let started = false
export function startPoller() {
  if (started) return
  started = true
  console.log('[poller] starting scheduler')
  tick()
  setInterval(tick, 60_000)
}
