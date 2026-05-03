// Open-Meteo Flood API — free, CORS-enabled river discharge forecasts
// derived from GloFAS. Daily resolution, parameterized by lat/lon, no
// API key required.
//
// Docs: https://open-meteo.com/en/docs/flood-api

const FLOOD_BASE = 'https://flood-api.open-meteo.com/v1/flood'
const FETCH_TIMEOUT_MS = 8000

// 1 m³/s = 35.3147 cfs. Convert so the chart matches the rest of the
// app (USGS reports flow in cfs).
const M3S_TO_CFS = 35.3146667

function withTimeout(signal, ms) {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return { signal: controller.signal, cancel: () => clearTimeout(tid) }
}

function toCfs(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return n * M3S_TO_CFS
}

function buildSeries(daily) {
  if (!daily || !Array.isArray(daily.time)) return []
  const t = daily.time
  const median = daily.river_discharge_median || daily.river_discharge || []
  const lo = daily.river_discharge_min || []
  const hi = daily.river_discharge_max || []
  const out = []
  for (let i = 0; i < t.length; i++) {
    const q = toCfs(median[i])
    if (q === null) continue
    // Open-Meteo daily times are date-only (YYYY-MM-DD). Anchor them
    // to UTC noon so chart x-axis math behaves predictably.
    const iso = `${t[i]}T12:00:00Z`
    out.push({
      t: iso,
      q,
      qLow: toCfs(lo[i]),
      qHigh: toCfs(hi[i])
    })
  }
  return out
}

/**
 * Fetch Open-Meteo flood discharge for a lat/lon.
 * Returns { source, series, updated, units } or null on failure.
 */
export async function fetchOpenMeteoFlood(lat, lon, { signal, pastDays = 2, forecastDays = 15 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { signal: timedSignal, cancel } = withTimeout(signal, FETCH_TIMEOUT_MS)
  const url = `${FLOOD_BASE}?latitude=${lat}&longitude=${lon}&daily=river_discharge,river_discharge_min,river_discharge_max,river_discharge_median&past_days=${pastDays}&forecast_days=${forecastDays}`
  try {
    const res = await fetch(url, {
      signal: timedSignal,
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    const series = buildSeries(json?.daily)
    if (series.length === 0) return null
    return {
      source: 'open-meteo',
      series,
      units: 'cfs',
      updated: new Date().toISOString(),
      raw: { lat: json?.latitude, lon: json?.longitude, elevation: json?.elevation }
    }
  } catch {
    return null
  } finally {
    cancel()
  }
}

export { M3S_TO_CFS }
