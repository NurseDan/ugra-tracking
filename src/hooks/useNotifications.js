import { useEffect, useRef, useCallback } from 'react'
import { ALERT_LEVELS } from '../lib/alertEngine'

const NOTIFY_LEVELS = Object.keys(ALERT_LEVELS).filter(k => ALERT_LEVELS[k].priority >= 3)

// Rate limit: do not re-notify the same gauge+level within this window
const RATE_LIMIT_MS = 10 * 60 * 1000 // 10 minutes

// Storage key for persisted dedup state
const STORAGE_KEY = 'sentinel_notif_sent'

function loadSentMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveSentMap(map) {
  try {
    // Prune entries older than 24h to prevent unbounded growth
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const pruned = Object.fromEntries(
      Object.entries(map).filter(([, ts]) => ts > cutoff)
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
  } catch {}
}

function dedupKey(gaugeId, level) {
  return `${gaugeId}__${level}`
}

export function useNotifications(gaugesData) {
  const permissionRef = useRef(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )
  const sentMapRef = useRef(loadSentMap())
  const prevAlertsRef = useRef({})

  // Request permission once on mount
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        permissionRef.current = p
      })
    }
  }, [])

  const fireNotification = useCallback((gaugeId, gaugeName, level, height, rise60m) => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return

    const key = dedupKey(gaugeId, level)
    const lastSent = sentMapRef.current[key] || 0
    if (Date.now() - lastSent < RATE_LIMIT_MS) return // rate limited

    const label = ALERT_LEVELS[level]?.label || level
    const heightStr = typeof height === 'number' ? ` | ${height.toFixed(2)} ft` : ''
    const riseStr = typeof rise60m === 'number' && rise60m > 0
      ? ` | +${rise60m.toFixed(2)} ft/hr`
      : ''

    const title = level === 'BLACK'
      ? `CRITICAL ALERT - ${gaugeName}`
      : `DANGER ALERT - ${gaugeName}`

    const body = [
      label + heightStr + riseStr,
      'Follow official guidance. Never enter flooded crossings.',
      'Call 911 for emergencies.'
    ].join('\n')

    try {
      const notif = new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: key, // collapses duplicate browser notifications
        requireInteraction: level === 'BLACK', // BLACK stays until dismissed
        silent: false
      })
      notif.onclick = () => {
        window.focus()
        notif.close()
      }
    } catch (err) {
      console.warn('[Sentinel] Notification failed:', err)
      return
    }

    sentMapRef.current[key] = Date.now()
    saveSentMap(sentMapRef.current)
  }, [])

  useEffect(() => {
    if (!gaugesData || typeof gaugesData !== 'object') return

    for (const [gaugeId, d] of Object.entries(gaugesData)) {
      const level = d?.alert
      if (!level) continue
      if (!NOTIFY_LEVELS.includes(level)) {
        // Track level so we know when it escalates next time
        prevAlertsRef.current[gaugeId] = level
        continue
      }

      const prevLevel = prevAlertsRef.current[gaugeId]
      // Only notify on escalation OR on first load if already RED/BLACK
      const isEscalation = prevLevel !== level
      if (isEscalation || prevLevel === undefined) {
        fireNotification(
          gaugeId,
          d.name || gaugeId,
          level,
          d.height,
          d.rates?.rise60m
        )
      }

      prevAlertsRef.current[gaugeId] = level
    }
  }, [gaugesData, fireNotification])
}

/**
 * NotificationToggle component
 * Small UI button to let users enable/disable browser notifications.
 */
export function useNotificationPermission() {
  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported'
    if (Notification.permission === 'granted') return 'granted'
    const result = await Notification.requestPermission()
    return result
  }, [])

  const permission = typeof Notification !== 'undefined'
    ? Notification.permission
    : 'unsupported'

  return { permission, request }
}
