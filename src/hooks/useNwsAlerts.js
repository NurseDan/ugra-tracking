import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bboxFromGauges, fetchActiveAlerts, sortAlertsBySeverity, ugcCodesForPoint, MOCK_ALERT } from '../lib/nwsAlerts.js'

const POLL_INTERVAL_MS = 2 * 60 * 1000
const BACKOFF_BASE_MS = 30 * 1000
const BACKOFF_MAX_MS = 10 * 60 * 1000

export function useNwsAlerts(bboxOverride = null, gauges = [], options = {}) {
  const { mock = false } = options

  const bbox = useMemo(() => {
    if (bboxOverride) return bboxOverride
    return bboxFromGauges(gauges)
  }, [bboxOverride, gauges])

  const gaugeUgcs = useMemo(() => {
    const set = new Set()
    for (const g of gauges || []) {
      for (const u of ugcCodesForPoint(g.lat, g.lng)) set.add(u)
    }
    return [...set]
  }, [gauges])

  const [alerts, setAlerts] = useState(mock ? [MOCK_ALERT] : [])
  const [loading, setLoading] = useState(!mock)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(mock ? new Date() : null)

  const failuresRef = useRef(0)
  const timeoutRef = useRef(null)
  const abortRef = useRef(null)
  const mountedRef = useRef(true)

  const clearTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const load = useCallback(async () => {
    if (mock) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    try {
      const next = await fetchActiveAlerts({ bbox, gaugeUgcs, signal: controller.signal })
      if (!mountedRef.current) return
      setAlerts(sortAlertsBySeverity(next))
      setError(null)
      setLastUpdated(new Date())
      failuresRef.current = 0
    } catch (err) {
      if (err?.name === 'AbortError') return
      if (!mountedRef.current) return
      failuresRef.current += 1
      setError(err)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [bbox, mock])

  const schedule = useCallback(() => {
    clearTimer()
    if (mock) return
    if (typeof document !== 'undefined' && document.hidden) return
    const failures = failuresRef.current
    const delay = failures > 0
      ? Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
      : POLL_INTERVAL_MS
    timeoutRef.current = setTimeout(async () => {
      await load()
      schedule()
    }, delay)
  }, [load, mock])

  useEffect(() => {
    mountedRef.current = true
    if (mock) {
      setAlerts([MOCK_ALERT])
      setLastUpdated(new Date())
      setLoading(false)
      return () => {
        mountedRef.current = false
      }
    }

    let cancelled = false
    ;(async () => {
      await load()
      if (!cancelled) schedule()
    })()

    const onVisibility = () => {
      if (document.hidden) {
        clearTimer()
      } else {
        load().then(() => schedule())
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onVisibility)
      clearTimer()
      if (abortRef.current) abortRef.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, gaugeUgcs, mock])

  const refresh = useCallback(async () => {
    failuresRef.current = 0
    await load()
    schedule()
  }, [load, schedule])

  return { alerts, loading, error, lastUpdated, refresh }
}
