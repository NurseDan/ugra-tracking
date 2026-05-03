import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCanyonLakeStatus } from './canyonLake.js'

const DEFAULT_REFRESH_MS = 10 * 60 * 1000

export function useReservoirStatus({ refreshMs = DEFAULT_REFRESH_MS } = {}) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const abortRef = useRef(null)
  const timerRef = useRef(null)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const result = await fetchCanyonLakeStatus({ signal: controller.signal })
      if (!mountedRef.current || controller.signal.aborted) return
      setStatus(result)
      setError(null)
      setLastUpdated(new Date().toISOString())
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return
      if (!mountedRef.current) return
      setError(err?.message || 'Unable to load reservoir status')
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false)
    }
  }, [])

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (typeof document !== 'undefined' && document.hidden) return
    timerRef.current = setTimeout(async () => {
      await load()
      schedule()
    }, refreshMs)
  }, [load, refreshMs])

  useEffect(() => {
    mountedRef.current = true
    load().then(schedule)

    const onVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current)
      } else {
        load().then(schedule)
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [load, schedule])

  return {
    status,
    loading,
    error,
    lastUpdated,
    refresh: load
  }
}
