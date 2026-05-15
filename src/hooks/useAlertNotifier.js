import { useEffect, useRef } from 'react'
import {
  notifyAlertEscalation,
  notifyNwsAlert,
  ensureServiceWorker,
  isSupported,
  isSubscribedToGauge,
  isNwsAlertsEnabled
} from '../lib/notifications'
import { ALERT_LEVELS } from '../lib/alertEngine'

function priority(level) {
  return ALERT_LEVELS[level]?.priority ?? 0
}

function normalizeAlerts(raw) {
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw?.alerts)) return raw.alerts
  if (Array.isArray(raw?.data)) return raw.data
  return null
}

function findGauge(gauges, id) {
  if (!Array.isArray(gauges)) return null
  return gauges.find((g) => g?.id === id) || null
}

function alertsTouchGauge(alert, gauge) {
  if (!alert || !gauge) return false
  if (Array.isArray(alert.gaugeIds) && alert.gaugeIds.includes(gauge.id)) return true
  if (Array.isArray(alert.affectedGaugeIds) && alert.affectedGaugeIds.includes(gauge.id)) return true
  if (alert.gaugeId && alert.gaugeId === gauge.id) return true
  const text = `${alert.areaDesc || ''} ${alert.headline || ''} ${alert.description || ''}`.toLowerCase()
  const candidates = [gauge.shortName, gauge.name, gauge.county]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
  return candidates.some((c) => c && text.includes(c))
}

export function useAlertNotifier(gaugesData, nwsAlerts, options = {}) {
  const { gauges = [], enabled = true } = options
  const previousLevels = useRef({})
  const seenAlertIds = useRef(new Set())
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!enabled || !isSupported()) return
    ensureServiceWorker()
  }, [enabled])

  useEffect(() => {
    if (!enabled || !isSupported() || !gaugesData) return

    const next = {}
    Object.entries(gaugesData).forEach(([id, data]) => {
      const level = data?.alert || 'GREEN'
      next[id] = level

      if (!initializedRef.current) return
      const prev = previousLevels.current[id] || 'GREEN'
      if (priority(level) > priority(prev) && isSubscribedToGauge(id)) {
        const gauge = findGauge(gauges, id)
        if (gauge) {
          notifyAlertEscalation({ gauge, fromLevel: prev, toLevel: level }).catch(() => {})
        }
      }
    })
    previousLevels.current = next
    initializedRef.current = true
  }, [gaugesData, gauges, enabled])

  const alertsArray = normalizeAlerts(nwsAlerts)

  useEffect(() => {
    if (!enabled || !isSupported() || !alertsArray || !isNwsAlertsEnabled()) return

    const subscribed = (gauges || []).filter((g) => isSubscribedToGauge(g.id))
    if (!subscribed.length) return

    alertsArray.forEach((alert) => {
      const id = alert?.id || alert?.identifier
      if (!id || seenAlertIds.current.has(id)) return
      seenAlertIds.current.add(id)

      const matched = subscribed.find((g) => alertsTouchGauge(alert, g))
      if (!matched) return
      notifyNwsAlert({ gauge: matched, alert }).catch(() => {})
    })

    if (seenAlertIds.current.size > 200) {
      const arr = Array.from(seenAlertIds.current)
      seenAlertIds.current = new Set(arr.slice(-100))
    }
  }, [alertsArray, gauges, enabled])
}

export default useAlertNotifier
