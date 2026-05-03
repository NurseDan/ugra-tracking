// NOAA National Water Model (NWM) streamflow forecasts.
//
// IMPLEMENTATION NOTE: NOAA's modern public NWM API endpoint at
// api.water.noaa.gov/nwps/v1/reaches/{reachId}/streamflow currently
// returns HTTP 501 ("Not Implemented") for all `series` values
// (short_range, medium_range, medium_range_blend, long_range,
// analysis_assimilation) when probed during development. The legacy
// AWS-hosted NWM grids require NetCDF and are not browser-friendly
// (no CORS).
//
// The spec explicitly allows this path: "if CORS blocks both, document
// the limitation and ship the Open-Meteo path only". This module is
// kept in place so that as soon as NOAA enables the streamflow series
// endpoint, no other code needs to change — `useStreamflowForecast`
// will pick up NWM as the preferred source automatically.
//
// Until then, `fetchNwmForecast` returns null (indicating "no data
// available") rather than throwing. The hook's fallback path handles
// that cleanly by switching to Open-Meteo.

const NWPS_BASE = 'https://api.water.noaa.gov/nwps/v1'
const FETCH_TIMEOUT_MS = 8000
const INVALID_VALUE = -999

export const NWM_RANGES = Object.freeze({
  SHORT: 'short_range',           // ~18h
  MEDIUM: 'medium_range',         // ~10d ensemble
  MEDIUM_BLEND: 'medium_range_blend',
  LONG: 'long_range',             // ~30d ensemble
  ANALYSIS: 'analysis_assimilation'
})

function withTimeout(signal, ms) {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return { signal: controller.signal, cancel: () => clearTimeout(tid) }
}

function num(v) {
  if (v === undefined || v === null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n <= INVALID_VALUE) return null
  return n
}

function normalizeReachStreamflow(payload) {
  // Best-effort normalizer covering plausible response shapes:
  //   { data: [{ validTime, primary, secondary }] }
  //   { series: [{ ... }] }
  //   { ensemble: { min: [...], median: [...], max: [...] } }
  if (!payload) return []
  const flat = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.series)
    ? payload.series
    : []
  return flat
    .map((p) => {
      const t = p?.validTime || p?.time || p?.t
      const q = num(p?.primary ?? p?.q ?? p?.value)
      if (!t || q === null) return null
      return {
        t,
        q,
        qLow: num(p?.qLow ?? p?.min),
        qHigh: num(p?.qHigh ?? p?.max)
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
}

/**
 * Try to fetch NWM streamflow for a reach.
 *
 * Returns:
 *   { source: 'nwm', range, series, updated }   on success
 *   null                                         when unavailable / unsupported
 *
 * Never throws on network/CORS/HTTP failures — those are treated as
 * "unavailable" so the caller can fall back to another source.
 */
export async function fetchNwmForecast(reachId, range = NWM_RANGES.MEDIUM, { signal } = {}) {
  if (!reachId) return null
  const { signal: timedSignal, cancel } = withTimeout(signal, FETCH_TIMEOUT_MS)
  const url = `${NWPS_BASE}/reaches/${encodeURIComponent(reachId)}/streamflow?series=${encodeURIComponent(range)}`
  try {
    const res = await fetch(url, {
      signal: timedSignal,
      headers: { Accept: 'application/json' }
    })
    // 501 = endpoint exists but unimplemented (current NOAA state).
    // 404 = reach not in NWM index.
    // Both → "no data" rather than a thrown error.
    if (res.status === 501 || res.status === 404 || !res.ok) return null
    const json = await res.json().catch(() => null)
    const series = normalizeReachStreamflow(json)
    if (series.length === 0) return null
    return {
      source: 'nwm',
      range,
      reachId,
      series,
      updated: json?.issuedTime || json?.generatedTime || new Date().toISOString()
    }
  } catch {
    // CORS / DNS / abort / timeout → silent unavailability
    return null
  } finally {
    cancel()
  }
}
