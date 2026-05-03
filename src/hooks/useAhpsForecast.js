import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAhpsForecast } from '../lib/ahps.js'
import { getAhpsLidForGauge } from '../config/ahpsLids.js'

const CACHE_TTL_MS = 10 * 60 * 1000

// Module-level cache so multiple components on the same page share
// network requests for the same LID and survive remounts within TTL.
//
// entry shape: { data, expires, promise, controller }
//   - data:    most recently resolved payload (or null)
//   - expires: ms timestamp when `data` becomes stale
//   - promise: in-flight shared fetch promise (cleared on settle)
//   - controller: AbortController owned by the shared fetch (NOT a
//     per-component signal). Component unmounts must never abort it.
const cache = new Map()

function readFreshData(lid) {
  const entry = cache.get(lid)
  if (!entry) return null
  if (entry.data && entry.expires > Date.now()) return entry.data
  return null
}

function readAnyData(lid) {
  return cache.get(lid)?.data || null
}

/**
 * Shared loader. Returns a promise that resolves with the AHPS payload
 * (or null for unknown LIDs). Multiple concurrent callers share a single
 * in-flight request. The shared request is governed by an internal
 * AbortController so individual subscribers cannot cancel it.
 */
function loadShared(lid, { force = false } = {}) {
  const existing = cache.get(lid)

  if (!force) {
    if (existing?.data && existing.expires > Date.now()) {
      return Promise.resolve(existing.data)
    }
    if (existing?.promise) return existing.promise
  } else if (existing?.promise) {
    // A revalidation is already in-flight; reuse it instead of racing.
    return existing.promise
  }

  const controller = new AbortController()
  const promise = (async () => {
    try {
      const data = await fetchAhpsForecast(lid, { signal: controller.signal })
      cache.set(lid, {
        data,
        expires: Date.now() + CACHE_TTL_MS,
        promise: null,
        controller: null
      })
      return data
    } catch (err) {
      // Preserve previously-cached data on failure rather than wiping it.
      const prev = cache.get(lid)
      cache.set(lid, {
        data: prev?.data ?? null,
        expires: prev?.expires ?? 0,
        promise: null,
        controller: null
      })
      throw err
    }
  })()

  cache.set(lid, {
    data: existing?.data ?? null,
    expires: existing?.expires ?? 0,
    promise,
    controller
  })
  return promise
}

export function useAhpsForecast(gaugeOrId, { refreshMs = CACHE_TTL_MS } = {}) {
  const lid = getAhpsLidForGauge(gaugeOrId)

  // Initialize state from cache for the *current* LID so a gauge/LID
  // change doesn't briefly render the previous gauge's data.
  const [state, setState] = useState(() => ({
    lid,
    data: lid ? readAnyData(lid) : null,
    loading: !!lid && !readFreshData(lid),
    error: null
  }))

  const mountedRef = useRef(true)
  const timerRef = useRef(null)
  const requestSeqRef = useRef(0)

  const load = useCallback(
    async (force = false) => {
      if (!lid) {
        setState({ lid: null, data: null, loading: false, error: null })
        return
      }
      const seq = ++requestSeqRef.current
      const fresh = !force ? readFreshData(lid) : null
      if (fresh) {
        setState({ lid, data: fresh, loading: false, error: null })
        return
      }
      setState((s) => ({ ...s, loading: true }))
      try {
        const data = await loadShared(lid, { force })
        if (!mountedRef.current) return
        if (seq !== requestSeqRef.current) return // a newer request superseded
        setState({ lid, data, loading: false, error: null })
      } catch (err) {
        if (!mountedRef.current) return
        if (seq !== requestSeqRef.current) return
        if (err?.name === 'AbortError') return
        setState((s) => ({
          lid,
          data: s.lid === lid ? s.data : readAnyData(lid),
          loading: false,
          error: err?.message || 'Unable to load AHPS forecast'
        }))
      }
    },
    [lid]
  )

  // Reset visible state immediately when LID changes (no stale flash).
  useEffect(() => {
    requestSeqRef.current++
    setState({
      lid,
      data: lid ? readAnyData(lid) : null,
      loading: !!lid && !readFreshData(lid),
      error: null
    })
  }, [lid])

  useEffect(() => {
    mountedRef.current = true
    load()
    if (lid && refreshMs > 0) {
      timerRef.current = setInterval(() => load(true), refreshMs)
    }
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearInterval(timerRef.current)
      // NOTE: we deliberately do NOT abort the shared in-flight request
      // here — other subscribers may still be waiting on it.
    }
  }, [lid, load, refreshMs])

  return {
    lid,
    observed: state.data?.observed || [],
    forecast: state.data?.forecast || [],
    floodCategories: state.data?.floodCategories || null,
    data: state.data,
    lastUpdated: state.data?.lastUpdated || null,
    loading: state.loading,
    error: state.error,
    refresh: () => load(true)
  }
}

export function _clearAhpsCache() {
  cache.clear()
}
