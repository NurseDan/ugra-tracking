import { query } from './db.js'
import { GAUGES } from '../src/config/gauges.js'
import { AHPS_LIDS } from '../src/config/ahpsLids.js'
import { NWM_REACHES } from '../src/config/nwmReaches.js'
import {
  fetchUSGSCurrent, fetchOpenMeteoForecast, fetchNwsAlerts,
  fetchAhps, fetchNwm, fetchCanyonLake
} from './sources.js'
import { calculateRates, getAlertLevel, dispatchIncident, ALERT_LEVELS } from './alertEngine.js'

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
  // Bulk upsert via values list (single statement, parameterized).
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

async function pollUSGS() {
  const ids = GAUGES.map(g => g.id)
  const data = await fetchUSGSCurrent(ids)
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

    // Read previous level for escalation detection.
    const prev = await query('SELECT alert_level FROM gauge_status WHERE gauge_id = $1', [g.id])
    const prevLevel = prev.rows[0]?.alert_level || 'GREEN'

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

async function cacheSource(key, fetcher) {
  try {
    const payload = await fetcher()
    if (payload === null || payload === undefined) return
    await query(
      `INSERT INTO source_cache (key, fetched_at, payload) VALUES ($1, now(), $2)
       ON CONFLICT (key) DO UPDATE SET fetched_at = now(), payload = EXCLUDED.payload`,
      [key, payload]
    )
  } catch (err) {
    console.warn(`[poller] cache ${key} failed:`, err.message)
  }
}

async function pollWeather() {
  for (const g of GAUGES) {
    await cacheSource(`weather:${g.id}`, () => fetchOpenMeteoForecast(g.lat, g.lng))
  }
  console.log('[poller] weather done')
}

async function pollNws() {
  await cacheSource('nws_alerts', async () => {
    const alerts = await fetchNwsAlerts()
    return { alerts, fetchedAt: new Date().toISOString() }
  })
  console.log('[poller] nws done')
}

async function pollAhps() {
  for (const [siteId, lid] of Object.entries(AHPS_LIDS)) {
    if (!lid) continue
    await cacheSource(`ahps:${siteId}`, () => fetchAhps(lid))
  }
  console.log('[poller] ahps done')
}

async function pollNwm() {
  for (const [siteId, reach] of Object.entries(NWM_REACHES)) {
    if (!reach) continue
    await cacheSource(`nwm:${siteId}`, () => fetchNwm(reach))
  }
  console.log('[poller] nwm done')
}

async function pollCanyonLake() {
  await cacheSource('canyon_lake', () => fetchCanyonLake())
  console.log('[poller] canyon lake done')
}

// Per-task isolation: one source failing must not kill the others.
async function safe(name, fn) {
  try { await fn() }
  catch (err) { console.error(`[poller] ${name} failed:`, err?.message || err) }
}

// Reentrancy guard: long-running ticks must not overlap. setInterval can
// fire again while a previous tick is still mid-flight (e.g. AHPS for
// many gauges), which would otherwise duplicate incident creation.
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
  const r3 = await query(`DELETE FROM notifications_sent WHERE sent_at < now() - interval '90 days'`)
  const r4 = await query(`DELETE FROM sessions WHERE expire < now()`)
  console.log(`[poller] retention: readings=${r1.rowCount} incidents=${r2.rowCount} notifs=${r3.rowCount} sessions=${r4.rowCount}`)
}

let started = false
export function startPoller() {
  if (started) return
  started = true
  console.log('[poller] starting scheduler')
  // Kick off immediately so the dashboard has data on first request.
  tick()
  setInterval(tick, 60_000)
}
