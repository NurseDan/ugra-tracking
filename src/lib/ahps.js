// AHPS / NWS official river forecasts.
//
// IMPLEMENTATION NOTE: The task spec referenced the legacy
// water.weather.gov/ahps2/hydrograph_to_xml.php XML endpoint. That host
// is no longer reliably reachable (and NOAA has been retiring it in
// favor of NWPS). This module instead targets the modern, CORS-friendly
// NWPS REST API at api.water.noaa.gov/nwps/v1, which returns the same
// observed + forecast time series plus structured flood-category
// thresholds in JSON — no XML parser required.
//
// Endpoints used per LID:
//   GET /gauges/{LID}                  -> metadata + flood categories
//   GET /gauges/{LID}/stageflow         -> observed time series
//   GET /gauges/{LID}/stageflow/forecast-> forecast time series

import { getAhpsLidForGauge } from '../config/ahpsLids.js'

const NWPS_BASE = 'https://api.water.noaa.gov/nwps/v1'
const INVALID_VALUE = -999

const FLOOD_CATEGORY_KEYS = ['action', 'minor', 'moderate', 'major']

function num(v) {
  if (v === undefined || v === null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n <= INVALID_VALUE) return null
  return n
}

function pickStage(point) {
  // NWPS returns `primary` (stage in ft) and `secondary` (flow). We only
  // care about stage for AHPS-style charts.
  const stage = num(point?.primary)
  if (stage === null) return null
  const t = point?.validTime
  if (!t) return null
  return { t, stage }
}

function extractDataArray(payload, preferKey) {
  if (!payload) return { data: [], issuedTime: null }
  // Forecast endpoint: flat shape { data: [...], issuedTime }
  if (Array.isArray(payload.data)) {
    return { data: payload.data, issuedTime: payload.issuedTime || null }
  }
  // Stageflow endpoint: nested { observed: { data: [...] }, forecast: {...} }
  const inner = preferKey && payload[preferKey] ? payload[preferKey] : null
  if (inner && Array.isArray(inner.data)) {
    return { data: inner.data, issuedTime: inner.issuedTime || null }
  }
  // Fallback: scan for any nested data array
  for (const key of ['observed', 'forecast']) {
    if (payload[key] && Array.isArray(payload[key].data)) {
      return { data: payload[key].data, issuedTime: payload[key].issuedTime || null }
    }
  }
  return { data: [], issuedTime: null }
}

function normalizeSeries(payload, preferKey) {
  const { data } = extractDataArray(payload, preferKey)
  return data
    .map(pickStage)
    .filter(Boolean)
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

function normalizeFloodCategories(meta) {
  const cats = meta?.flood?.categories || {}
  const out = {}
  FLOOD_CATEGORY_KEYS.forEach((k) => {
    out[k] = num(cats[k]?.stage)
  })
  return out
}

async function fetchJson(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' }
  })
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body?.message || `Not found: ${url}`)
    err.code = 'NOT_FOUND'
    throw err
  }
  if (!res.ok) {
    throw new Error(`NWPS HTTP ${res.status} for ${url}`)
  }
  return res.json()
}

/**
 * Fetch observed + forecast stage and flood thresholds for a single LID.
 * Returns null if the LID is unknown to NWPS.
 */
export async function fetchAhpsForecast(lid, { signal } = {}) {
  if (!lid) return null

  const safeLid = encodeURIComponent(lid)
  const metaUrl = `${NWPS_BASE}/gauges/${safeLid}`
  const obsUrl = `${NWPS_BASE}/gauges/${safeLid}/stageflow`
  const fcstUrl = `${NWPS_BASE}/gauges/${safeLid}/stageflow/forecast`

  let meta
  try {
    meta = await fetchJson(metaUrl, signal)
  } catch (err) {
    if (err?.code === 'NOT_FOUND') return null
    throw err
  }

  const [obsRes, fcstRes] = await Promise.allSettled([
    fetchJson(obsUrl, signal),
    fetchJson(fcstUrl, signal)
  ])

  const observed =
    obsRes.status === 'fulfilled' ? normalizeSeries(obsRes.value, 'observed') : []
  const forecast =
    fcstRes.status === 'fulfilled' ? normalizeSeries(fcstRes.value, 'forecast') : []

  const obsIssued =
    obsRes.status === 'fulfilled'
      ? extractDataArray(obsRes.value, 'observed').issuedTime
      : null
  const fcstIssued =
    fcstRes.status === 'fulfilled'
      ? extractDataArray(fcstRes.value, 'forecast').issuedTime
      : null
  const issuedTimes = [obsIssued, fcstIssued]
    .filter(Boolean)
    .filter((t) => !t.startsWith('0001-01-01'))

  const lastUpdated =
    issuedTimes
      .map((t) => new Date(t).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0] || null

  return {
    lid,
    name: meta?.name || null,
    rfc: meta?.rfc?.abbreviation || null,
    wfo: meta?.wfo?.abbreviation || null,
    timeZone: meta?.timeZone || null,
    units: 'ft',
    observed,
    forecast,
    floodCategories: normalizeFloodCategories(meta),
    currentFloodCategory: meta?.status?.observed?.floodCategory || null,
    forecastFloodCategory: meta?.status?.forecast?.floodCategory || null,
    lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
    raw: meta
  }
}

export function categoryForStage(stage, categories) {
  if (!Number.isFinite(stage) || !categories) return null
  const ordered = ['major', 'moderate', 'minor', 'action']
  for (const key of ordered) {
    const threshold = categories[key]
    if (Number.isFinite(threshold) && stage >= threshold) return key
  }
  return null
}

/**
 * Compute the next 24h crest from the forecast series.
 * Returns { stage, t, category } or null if no forecast.
 */
export function next24hCrest(forecast, categories, now = Date.now()) {
  if (!Array.isArray(forecast) || forecast.length === 0) return null
  const horizon = now + 24 * 60 * 60 * 1000
  const window = forecast.filter((p) => {
    const tt = new Date(p.t).getTime()
    return Number.isFinite(tt) && tt >= now && tt <= horizon
  })
  if (window.length === 0) return null
  const peak = window.reduce(
    (best, p) => (p.stage > best.stage ? p : best),
    window[0]
  )
  return {
    stage: peak.stage,
    t: peak.t,
    category: categoryForStage(peak.stage, categories)
  }
}

export function highestForecastCategory(forecast, categories, { withinMs = null, now = Date.now() } = {}) {
  if (!Array.isArray(forecast) || forecast.length === 0) return null
  const ranks = { action: 1, minor: 2, moderate: 3, major: 4 }
  const horizon = withinMs ? now + withinMs : null
  let best = null
  for (const p of forecast) {
    if (horizon !== null) {
      const tt = new Date(p.t).getTime()
      if (!Number.isFinite(tt) || tt < now || tt > horizon) continue
    }
    const c = categoryForStage(p.stage, categories)
    if (!c) continue
    if (!best || ranks[c] > ranks[best]) best = c
  }
  return best
}

export { getAhpsLidForGauge }
