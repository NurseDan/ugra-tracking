import { useCallback, useEffect, useRef, useState } from 'react'
import { generateGaugeBriefing, generateBasinBriefing } from '../lib/aiBriefing'

const TTL_MS = 10 * 60 * 1000
const DEBOUNCE_MS = 800

const gaugeCache = new Map()
const basinCache = { key: null, briefing: null, fetchedAt: 0, inFlight: null }

function cacheKey(context) {
  if (!context?.gauge?.id) return null
  return `${context.gauge.id}:${context.current?.alertLevel || 'NONE'}`
}

export function clearBriefingCache() {
  gaugeCache.clear()
  basinCache.key = null
  basinCache.briefing = null
  basinCache.fetchedAt = 0
  basinCache.inFlight = null
}

export function useGaugeBriefing(gauge, context, options = {}) {
  const { enabled = true, ttlMs = TTL_MS, debounceMs = DEBOUNCE_MS } = options
  const [state, setState] = useState({
    briefing: null,
    loading: false,
    error: null,
    fetchedAt: 0
  })
  const seqRef = useRef(0)
  const abortRef = useRef(null)
  const debounceRef = useRef(null)

  const run = useCallback(
    async (force = false) => {
      if (!gauge?.id || !context) return
      const key = cacheKey(context)
      if (!key) return

      const cached = gaugeCache.get(key)
      const now = Date.now()
      if (!force && cached?.briefing && now - cached.fetchedAt < ttlMs) {
        setState({ briefing: cached.briefing, loading: false, error: null, fetchedAt: cached.fetchedAt })
        return
      }
      if (!force && cached?.inFlight) {
        setState((s) => ({ ...s, loading: true }))
        try {
          const briefing = await cached.inFlight
          setState({ briefing, loading: false, error: null, fetchedAt: Date.now() })
        } catch (err) {
          setState({ briefing: null, loading: false, error: err, fetchedAt: 0 })
        }
        return
      }

      const seq = ++seqRef.current
      const controller = new AbortController()
      abortRef.current = controller
      setState((s) => ({ ...s, loading: true, error: null }))

      const promise = generateGaugeBriefing(context, { signal: controller.signal })
      gaugeCache.set(key, { ...cached, inFlight: promise })
      try {
        const briefing = await promise
        if (seq !== seqRef.current) return
        gaugeCache.set(key, { briefing, fetchedAt: Date.now(), inFlight: null })
        setState({ briefing, loading: false, error: null, fetchedAt: Date.now() })
      } catch (err) {
        if (seq !== seqRef.current) return
        gaugeCache.set(key, { briefing: null, fetchedAt: 0, inFlight: null })
        if (err?.name !== 'AbortError') {
          setState({ briefing: null, loading: false, error: err, fetchedAt: 0 })
        }
      }
    },
    [gauge?.id, context, ttlMs]
  )

  useEffect(() => {
    if (!enabled) return undefined
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => run(false), debounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [enabled, run, debounceMs])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const regenerate = useCallback(() => run(true), [run])

  return { ...state, regenerate }
}

export function useBasinBriefing(contexts, briefings = {}, options = {}) {
  const { enabled = true, ttlMs = TTL_MS, debounceMs = 1500 } = options
  const [state, setState] = useState({
    briefing: null,
    loading: false,
    error: null,
    fetchedAt: 0
  })
  const seqRef = useRef(0)
  const abortRef = useRef(null)
  const debounceRef = useRef(null)

  const fingerprint =
    (contexts || [])
      .filter(Boolean)
      .map((c) => `${c.gauge.id}:${c.current?.alertLevel || 'N'}:${c.current?.heightFt ?? '-'}`)
      .join('|') || 'empty'

  const run = useCallback(
    async (force = false) => {
      const validContexts = (contexts || []).filter(Boolean)
      if (!validContexts.length) {
        setState({ briefing: null, loading: false, error: null, fetchedAt: 0 })
        return
      }
      const now = Date.now()
      if (
        !force &&
        basinCache.key === fingerprint &&
        basinCache.briefing &&
        now - basinCache.fetchedAt < ttlMs
      ) {
        setState({
          briefing: basinCache.briefing,
          loading: false,
          error: null,
          fetchedAt: basinCache.fetchedAt
        })
        return
      }

      const seq = ++seqRef.current
      const controller = new AbortController()
      abortRef.current = controller
      setState((s) => ({ ...s, loading: true, error: null }))

      const promise = generateBasinBriefing(validContexts, {
        briefings,
        signal: controller.signal
      })
      basinCache.inFlight = promise
      try {
        const briefing = await promise
        if (seq !== seqRef.current) return
        basinCache.key = fingerprint
        basinCache.briefing = briefing
        basinCache.fetchedAt = Date.now()
        basinCache.inFlight = null
        setState({ briefing, loading: false, error: null, fetchedAt: basinCache.fetchedAt })
      } catch (err) {
        if (seq !== seqRef.current) return
        basinCache.inFlight = null
        if (err?.name !== 'AbortError') {
          setState({ briefing: null, loading: false, error: err, fetchedAt: 0 })
        }
      }
    },
    [contexts, briefings, fingerprint, ttlMs]
  )

  useEffect(() => {
    if (!enabled) return undefined
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => run(false), debounceMs)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [enabled, run, debounceMs])

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const regenerate = useCallback(() => run(true), [run])
  return { ...state, regenerate }
}
