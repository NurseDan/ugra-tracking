import { useState, useEffect, useCallback } from 'react'
import { getHistory, mergeHistory } from '../lib/gaugeHistory'
import { fetchUSGS14DayHistory } from '../lib/usgs'

const inFlight = new Set()

export function useGaugeHistory(siteId) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastFetched, setLastFetched] = useState(null)

  const load = useCallback(async (forceRefresh = false) => {
    if (!siteId) return
    if (inFlight.has(siteId)) return

    const cached = await getHistory(siteId)
    if (cached.length > 0) {
      setHistory(cached)
      if (!forceRefresh && cached.length > 200) {
        return
      }
    }

    inFlight.add(siteId)
    setLoading(true)
    setError(null)

    try {
      const points = await fetchUSGS14DayHistory(siteId)
      if (points.length > 0) {
        await mergeHistory(siteId, points)
        const merged = await getHistory(siteId)
        setHistory(merged)
        setLastFetched(new Date())
      } else if (cached.length === 0) {
        setError('No history available (offline or upstream unavailable).')
      }
    } catch (err) {
      console.warn(`[useGaugeHistory] Failed to fetch history for ${siteId}:`, err)
      if (cached.length === 0) {
        setError(err?.message || 'Failed to load history')
      }
    } finally {
      inFlight.delete(siteId)
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load(false)
  }, [load])

  const refresh = useCallback(() => load(true), [load])

  return { history, loading, error, lastFetched, refresh }
}
