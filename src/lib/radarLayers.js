// Radar + MRMS QPE tile layer sources for the river basin map.
//
// Two data sources:
//
// 1. RainViewer (https://www.rainviewer.com/api.html)
//    - Public API at api.rainviewer.com/public/weather-maps.json returns
//      a host + a list of "past" radar frames (10-min cadence, ~2h
//      retention) and "nowcast" frames (extrapolated, ~30min ahead).
//    - Tile URL template:
//        {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
//      size:    256 or 512
//      color:   color scheme index (1=Original, 2=Universal Blue, etc.)
//      options: "{smooth}_{snow}" e.g. "1_1"
//    - CORS-enabled, no API key needed.
//
// 2. NOAA MRMS QPE via Iowa Environmental Mesonet WMS
//    - Endpoint: https://mesonet.agron.iastate.edu/cgi-bin/wms/us/mrms.cgi
//    - Layers (verified live during build):
//        mrms_p1h   (NMQ Q3 1 Hour Precipitation)
//        mrms_p24h  (NMQ Q3 24 Hour Precipitation)
//        mrms_p48h  (NMQ Q3 48 Hour Precipitation)
//        mrms_p72h  (NMQ Q3 72 Hour Precipitation)
//    - DEVIATION FROM SPEC: spec listed `6h` as a window. IEM does NOT
//      publish a mrms_p6h layer (only 1h, 24h, 48h, 72h). The window
//      enum exposes what's actually available; the controls fall back
//      gracefully so a future agent can swap in a different MRMS
//      provider without touching call sites.

import { useEffect, useRef, useState } from 'react'

const RAINVIEWER_INDEX_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const RAINVIEWER_INDEX_TTL_MS = 5 * 60 * 1000 // refresh every 5 min
const FRAME_INTERVAL_MS = 500
const MRMS_WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/us/mrms.cgi'

export const MRMS_WINDOWS = Object.freeze({
  '1h':  { layer: 'mrms_p1h',  label: '1-hr Rainfall',  hours: 1 },
  '24h': { layer: 'mrms_p24h', label: '24-hr Rainfall', hours: 24 },
  '48h': { layer: 'mrms_p48h', label: '48-hr Rainfall', hours: 48 },
  '72h': { layer: 'mrms_p72h', label: '72-hr Rainfall', hours: 72 }
})

export const DEFAULT_MRMS_WINDOW = '24h'

/**
 * Build a Leaflet-compatible XYZ tile URL template for a RainViewer
 * radar frame.
 */
export function buildRainViewerTileUrl(host, path, {
  size = 256,
  color = 2,        // Universal Blue
  smooth = 1,
  snow = 1
} = {}) {
  if (!host || !path) return null
  return `${host}${path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`
}

/**
 * Get WMS configuration for an MRMS QPE accumulation window. Returns
 * null for unknown windows so callers can render a clear empty state.
 */
export function getMrmsQpeLayer(window = DEFAULT_MRMS_WINDOW) {
  const cfg = MRMS_WINDOWS[window]
  if (!cfg) return null
  return {
    url: MRMS_WMS_URL,
    layer: cfg.layer,
    label: cfg.label,
    hours: cfg.hours,
    attribution: 'MRMS QPE &copy; Iowa Environmental Mesonet / NOAA'
  }
}

/**
 * Backwards-compat helper that returns just the WMS URL the caller
 * should hit (the WMS layer name is then provided to react-leaflet's
 * <WMSTileLayer layers="..." />). Spec referred to this as
 * `getMrmsQpeLayerUrl(window)`.
 */
export function getMrmsQpeLayerUrl(window = DEFAULT_MRMS_WINDOW) {
  const cfg = getMrmsQpeLayer(window)
  return cfg?.url || null
}

// ---------- RainViewer index fetch + caching ----------

let indexCache = null // { data, expires, promise }

async function fetchRainViewerIndex(signal) {
  const now = Date.now()
  if (indexCache?.data && indexCache.expires > now) return indexCache.data
  if (indexCache?.promise) return indexCache.promise

  const promise = (async () => {
    try {
      const res = await fetch(RAINVIEWER_INDEX_URL, {
        signal,
        headers: { Accept: 'application/json' }
      })
      if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`)
      const json = await res.json()
      const past = Array.isArray(json?.radar?.past) ? json.radar.past : []
      const nowcast = Array.isArray(json?.radar?.nowcast) ? json.radar.nowcast : []
      const data = {
        host: json?.host || 'https://tilecache.rainviewer.com',
        generated: json?.generated || Math.floor(now / 1000),
        past,
        nowcast
      }
      indexCache = { data, expires: now + RAINVIEWER_INDEX_TTL_MS, promise: null }
      return data
    } catch (err) {
      indexCache = { data: indexCache?.data ?? null, expires: 0, promise: null }
      throw err
    }
  })()

  indexCache = { ...(indexCache || {}), promise }
  return promise
}

export function _clearRainViewerCache() {
  indexCache = null
}

// ---------- Frame hook ----------

/**
 * Hook returning RainViewer radar frames + the currently active frame
 * index, with auto-advance.
 *
 * @param {object} options
 * @param {number} options.intervalMs   - ms between frames (default 500)
 * @param {boolean} options.includeNowcast - also include forecast frames
 * @param {boolean} options.playing     - controls whether the frame index advances
 * @param {boolean} options.pauseWhenHidden - pause when document.hidden (default true)
 * @returns {{
 *   frames: Array<{ time:number, path:string, kind:'past'|'nowcast', url:string|null }>,
 *   index: number,
 *   setIndex: (n:number)=>void,
 *   loading: boolean,
 *   error: string|null,
 *   host: string|null,
 *   refresh: () => void
 * }}
 */
export function useRainViewerFrames({
  intervalMs = FRAME_INTERVAL_MS,
  includeNowcast = true,
  playing = true,
  pauseWhenHidden = true,
  size = 256,
  color = 2,
  smooth = 1,
  snow = 1
} = {}) {
  const [state, setState] = useState({
    frames: [],
    host: null,
    loading: true,
    error: null
  })
  const [index, setIndex] = useState(0)
  const timerRef = useRef(null)
  const abortRef = useRef(null)
  const mountedRef = useRef(true)

  const tileOpts = { size, color, smooth, snow }

  const load = async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState((s) => ({ ...s, loading: true }))
    try {
      const idx = await fetchRainViewerIndex(controller.signal)
      if (!mountedRef.current) return
      const past = idx.past.map((f) => ({
        time: f.time,
        path: f.path,
        kind: 'past'
      }))
      const nowcast = includeNowcast
        ? idx.nowcast.map((f) => ({
            time: f.time,
            path: f.path,
            kind: 'nowcast'
          }))
        : []
      const frames = [...past, ...nowcast].map((f) => ({
        ...f,
        url: buildRainViewerTileUrl(idx.host, f.path, tileOpts)
      }))
      setState({ frames, host: idx.host, loading: false, error: null })
      setIndex((cur) => {
        if (frames.length === 0) return 0
        // Default to last "past" frame if we just loaded.
        if (cur === 0 || cur >= frames.length) {
          const lastPast = frames.map((f) => f.kind).lastIndexOf('past')
          return lastPast >= 0 ? lastPast : frames.length - 1
        }
        return Math.min(cur, frames.length - 1)
      })
    } catch (err) {
      if (controller.signal.aborted) return
      if (!mountedRef.current) return
      setState((s) => ({
        ...s,
        loading: false,
        error: err?.message || 'Unable to load radar frames'
      }))
    }
  }

  // Initial load + periodic refresh.
  useEffect(() => {
    mountedRef.current = true
    load()
    const refreshTimer = setInterval(load, RAINVIEWER_INDEX_TTL_MS)
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
      clearInterval(refreshTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeNowcast, size, color, smooth, snow])

  // Auto-advance frame index.
  useEffect(() => {
    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
    const start = () => {
      stop()
      timerRef.current = setInterval(() => {
        setIndex((cur) => {
          const n = state.frames.length
          if (n === 0) return 0
          return (cur + 1) % n
        })
      }, intervalMs)
    }

    const shouldRun =
      playing &&
      state.frames.length > 1 &&
      !(pauseWhenHidden && typeof document !== 'undefined' && document.hidden)

    if (shouldRun) start()
    else stop()

    const onVisibility = () => {
      if (!playing) return
      const hidden = pauseWhenHidden && document.hidden
      if (hidden) stop()
      else if (state.frames.length > 1) start()
    }
    if (typeof document !== 'undefined' && pauseWhenHidden) {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      stop()
      if (typeof document !== 'undefined' && pauseWhenHidden) {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [playing, intervalMs, pauseWhenHidden, state.frames.length])

  return {
    frames: state.frames,
    index,
    setIndex,
    loading: state.loading,
    error: state.error,
    host: state.host,
    refresh: load
  }
}
