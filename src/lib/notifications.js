import { ALERT_LEVELS } from './alertEngine'

const STORAGE_KEY = 'gs:notifications:v1'
const DEDUPE_WINDOW_MS = 30 * 60 * 1000
const SW_PATH = '/sw.js'

const NOTIFY_LEVELS = ['ORANGE', 'RED', 'BLACK']

const dedupeMap = new Map()
let swRegistration = null
let swRegistrationPromise = null

function isBrowser() {
  return typeof window !== 'undefined'
}

export function isSupported() {
  return isBrowser() && typeof window.Notification !== 'undefined'
}

export function isServiceWorkerSupported() {
  return isBrowser() && 'serviceWorker' in navigator && 'Notification' in window
}

export function getPermissionState() {
  if (!isSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestPermission() {
  if (!isSupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const result = await Notification.requestPermission()
    return result
  } catch {
    return 'denied'
  }
}

function readStore() {
  if (!isBrowser()) return defaultStore()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
      return defaultStore()
    }
    return {
      version: 1,
      gauges: Array.isArray(parsed.gauges) ? parsed.gauges.filter((g) => typeof g === 'string') : [],
      nwsAlertsEnabled: Boolean(parsed.nwsAlertsEnabled)
    }
  } catch {
    return defaultStore()
  }
}

function writeStore(store) {
  if (!isBrowser()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {}
}

function defaultStore() {
  return { version: 1, gauges: [], nwsAlertsEnabled: false }
}

export function getSubscribedGauges() {
  return readStore().gauges
}

export function isSubscribedToGauge(gaugeId) {
  return readStore().gauges.includes(gaugeId)
}

export function subscribeToGauge(gaugeId) {
  if (!gaugeId) return
  const store = readStore()
  if (!store.gauges.includes(gaugeId)) {
    store.gauges.push(gaugeId)
    writeStore(store)
  }
}

export function unsubscribeFromGauge(gaugeId) {
  const store = readStore()
  const next = store.gauges.filter((id) => id !== gaugeId)
  if (next.length !== store.gauges.length) {
    writeStore({ ...store, gauges: next })
  }
}

export function isNwsAlertsEnabled() {
  return readStore().nwsAlertsEnabled
}

export function setNwsAlertsEnabled(enabled) {
  const store = readStore()
  writeStore({ ...store, nwsAlertsEnabled: Boolean(enabled) })
}

export function clearAllSubscriptions() {
  if (!isBrowser()) return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export function clearDedupe() {
  dedupeMap.clear()
}

function dedupeKey(scope, key) {
  return `${scope}:${key}`
}

function shouldFire(scope, key, now = Date.now()) {
  const k = dedupeKey(scope, key)
  const last = dedupeMap.get(k) || 0
  if (now - last < DEDUPE_WINDOW_MS) return false
  dedupeMap.set(k, now)
  return true
}

export async function ensureServiceWorker() {
  if (!isServiceWorkerSupported()) return null
  if (swRegistration) return swRegistration
  if (swRegistrationPromise) return swRegistrationPromise
  swRegistrationPromise = navigator.serviceWorker
    .register(SW_PATH)
    .then((reg) => {
      swRegistration = reg
      return reg
    })
    .catch((err) => {
      console.warn('Service worker registration failed:', err)
      swRegistrationPromise = null
      return null
    })
  return swRegistrationPromise
}

async function fireNotification({ title, body, tag, url, requireInteraction = false }) {
  if (!isSupported()) return false
  if (Notification.permission !== 'granted') return false

  const data = { url: url || '/', timestamp: Date.now() }
  const options = {
    body,
    tag,
    data,
    requireInteraction,
    icon: '/favicon.ico',
    badge: '/favicon.ico'
  }

  if (isServiceWorkerSupported()) {
    try {
      const reg = await ensureServiceWorker()
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options)
        return true
      }
    } catch (err) {
      console.warn('SW notification failed, falling back:', err)
    }
  }

  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      if (typeof window !== 'undefined') {
        window.focus()
        if (data.url) window.location.href = data.url
      }
      n.close()
    }
    return true
  } catch (err) {
    console.warn('Notification failed:', err)
    return false
  }
}

export async function notifyAlertEscalation({ gauge, fromLevel, toLevel } = {}) {
  if (!gauge?.id || !toLevel) return false
  if (!NOTIFY_LEVELS.includes(toLevel)) return false
  if (!isSubscribedToGauge(gauge.id)) return false
  if (!shouldFire('alert', `${gauge.id}:${toLevel}`)) return false

  const label = ALERT_LEVELS[toLevel]?.label || toLevel
  const fromLabel = fromLevel ? ALERT_LEVELS[fromLevel]?.label || fromLevel : 'normal'
  return fireNotification({
    title: `${gauge.shortName || gauge.name || gauge.id}: ${label}`,
    body: `Alert escalated from ${fromLabel} to ${label}.`,
    tag: `alert-${gauge.id}`,
    url: `/gauge/${gauge.id}`,
    requireInteraction: toLevel === 'BLACK' || toLevel === 'RED'
  })
}

export async function notifyNwsAlert({ gauge, alert } = {}) {
  if (!alert) return false
  if (!isNwsAlertsEnabled()) return false
  const alertId = alert.id || alert.identifier || `${alert.event || 'alert'}:${alert.sent || alert.effective || ''}`
  if (!alertId) return false
  if (!shouldFire('nws', alertId)) return false

  const where = gauge?.shortName || gauge?.name || 'watched gauge'
  const event = alert.event || alert.headline || 'NWS Alert'
  const headline = alert.headline || alert.description?.slice(0, 140) || ''

  return fireNotification({
    title: `${event} — ${where}`,
    body: headline,
    tag: `nws-${alertId}`,
    url: gauge?.id ? `/gauge/${gauge.id}` : '/',
    requireInteraction: /flash flood warning|flood warning/i.test(event)
  })
}

export async function sendTestNotification() {
  if (!isSupported()) return { ok: false, reason: 'Notifications are not supported in this browser.' }
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: 'Permission has not been granted.' }
  }
  const fired = await fireNotification({
    title: 'Guadalupe Sentinel — Test',
    body: 'Notifications are working. You will receive alerts for watched gauges.',
    tag: `test-${Date.now()}`,
    url: '/'
  })
  return { ok: fired, reason: fired ? null : 'Notification call failed.' }
}

export const __test__ = {
  STORAGE_KEY,
  DEDUPE_WINDOW_MS,
  NOTIFY_LEVELS,
  defaultStore,
  readStore,
  writeStore,
  shouldFire,
  dedupeMap
}
