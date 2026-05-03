import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNwmForecast, NWM_RANGES } from '../lib/nwm.js'
import { fetchOpenMeteoFlood } from '../lib/openMeteoFlood.js'
import { getNwmReachId } from '../config/nwmReaches.js'

const CACHE_TTL_MS = 30 * 60 * 1000

// Module-level shared cache: key = gauge.id (or `${lat},${lon}` if no id)
// entry shape: { data, expires, promise }
const cache = new Map()

function cacheKey(gauge) {
  if (!gauge) return null
  if (gauge.id) return `g:${gauge.id}`
  if (Number.isFinite(gauge.lat) && Number.isFinite(gauge.lng)) {
    return `c:${gauge.lat.toFixed(4)},${gauge.lng.toFixed(4)}`
  }
  return null
}

function readFresh(key) {
  const e = cache.get(key)
  if (!e) return null
  if (e.data && e.expires > Date.now()) return e.data
  return null
}

function readAny(key) {
  return cache.get(key)?.data || null
}

async function loadShared(gauge, key, { force } = {}) {
  const existing = cache.get(key)
  if (!force && existing?.data && existing.expires > Date.now()) {
    return existing.data
  }
  if (existing?.promise) return existing.promise

  const controller = new AbortController()
  const promise = (async () => {
    let result = null

    // 1) Try NWM first (preferred — official model). If unavailable,
    //    fetchNwmForecast resolves null without throwing.
    const reachId = getNwmReachId(gauge)
    if (reachId) {
      result = await fetchNwmForecast(reachId, NWM_RANGES.MEDIUM, {
        signal: controller.signal
      })
    }

    // 2) Fallback to Open-Meteo (works for any lat/lon).
    if (!result && Number.isFinite(gauge?.lat) && Number.isFinite(gauge?.lng)) {
      result = await fetchOpenMeteoFlood(gauge.lat, gauge.lng, {
        signal: controller.signal
      })
    }

    // 3) Both failed — explicit "none" payload so UI can render an
    //    informative empty state instead of spinning forever.
    if (!result) {
      result = {
        source: 'none',
        series: [],
        updated: new Date().toISOString()
      }
    }

    cache.set(key, {
      data: result,
      expires: Date.now() + CACHE_TTL_MS,
      promise: null
    })
    return result
  })().catch((err) => {
    const prev = cache.get(key)
    cache.set(key, {
      data: prev?.data ?? null,
      expires: prev?.expires ?? 0,
      promise: null
    })
    throw err
  })

  cache.set(key, {
    data: existing?.data ?? null,
    expires: existing?.expires ?? 0,
    promise
  })
  return promise
}

export function useStreamflowForecast(gauge, { refreshMs = CACHE_TTL_MS } = {}) {
  const key = cacheKey(gauge)
  const [state, setState] = useState(() => ({
    key,
    data: key ? readAny(key) : null,
    loading: !!key && !readFresh(key),
    error: null
  }))

  const mountedRef = useRef(true)
  const timerRef = useRef(null)
  const seqRef = useRef(0)

  const load = useCallback(
    async (force = false) => {
      if (!gauge || !key) {
        setState({ key: null, data: null, loading: false, error: null })
        return
      }
      const seq = ++seqRef.current
      const fresh = !force ? readFresh(key) : null
      if (fresh) {
        setState({ key, data: fresh, loading: false, error: null })
        return
      }
      setState((s) => ({ ...s, loading: true }))
      try {
        const data = await loadShared(gauge, key, { force })
        if (!mountedRef.current || seq !== seqRef.current) return
        setState({ key, data, loading: false, error: null })
      } catch (err) {
        if (!mountedRef.current || seq !== seqRef.current) return
        setState((s) => ({
          key,
          data: s.key === key ? s.data : readAny(key),
          loading: false,
          error: err?.message || 'Unable to load streamflow forecast'
        }))
      }
    },
    [gauge, key]
  )

  useEffect(() => {
    seqRef.current++
    setState({
      key,
      data: key ? readAny(key) : null,
      loading: !!key && !readFresh(key),
      error: null
    })
  }, [key])

  useEffect(() => {
    mountedRef.current = true
    load()
    if (key && refreshMs > 0) {
      timerRef.current = setInterval(() => load(true), refreshMs)
    }
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [key, load, refreshMs])

  const data = state.data
  return {
    source: data?.source || 'none',
    series: data?.series || [],
    updated: data?.updated || null,
    loading: state.loading,
    error: state.error,
    refresh: () => load(true),
    data
  }
}

export function _clearStreamflowCache() {
  cache.clear()
}
