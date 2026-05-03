const DB_NAME = 'sentinel_gauge_db'
const DB_VERSION = 1
const STORE_NAME = 'gauge_history'
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const FORECAST_TTL_MS = 15 * 60 * 1000

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = e => resolve(e.target.result)
    req.onerror = () => resolve(null)
  })
  return dbPromise
}

async function idbGet(key) {
  const db = await openDb()
  if (!db) return null
  return new Promise(resolve => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => resolve(null)
  })
}

async function idbSet(key, value) {
  const db = await openDb()
  if (!db) return false
  return new Promise(resolve => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const req = tx.objectStore(STORE_NAME).put(value, key)
    req.onsuccess = () => resolve(true)
    req.onerror = () => resolve(false)
  })
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function lsSet(key, value) {
  try {
    const str = JSON.stringify(value)
    if (str.length < 500_000) {
      localStorage.setItem(key, str)
    }
  } catch {}
}

async function readHistory(siteId) {
  const key = `history_${siteId}`
  const idb = await idbGet(key)
  if (idb) return idb
  return lsGet(`sentinel_${key}`) || []
}

async function writeHistory(siteId, data) {
  const key = `history_${siteId}`
  await idbSet(key, data)
  lsSet(`sentinel_${key}`, data)
}

function dedupeAndTrim(points) {
  if (!Array.isArray(points)) return []
  const now = Date.now()
  const cutoff = now - MAX_AGE_MS
  const seen = new Map()
  for (const p of points) {
    const ts = new Date(p.time).getTime()
    if (!Number.isFinite(ts) || ts < cutoff) continue
    if (!seen.has(ts)) {
      seen.set(ts, { ...p })
    } else {
      const existing = seen.get(ts)
      seen.set(ts, {
        ...existing,
        ...p,
        height: (p.height !== null && p.height !== undefined) ? p.height : existing.height,
        flow: (p.flow !== null && p.flow !== undefined) ? p.flow : existing.flow
      })
    }
  }
  return [...seen.values()].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
}

export async function mergeHistory(siteId, newPoints) {
  if (!siteId || !Array.isArray(newPoints) || newPoints.length === 0) return
  const existing = await readHistory(siteId)
  const merged = dedupeAndTrim([...existing, ...newPoints])
  await writeHistory(siteId, merged)
}

export async function getHistory(siteId) {
  if (!siteId) return []
  return await readHistory(siteId)
}

export async function clearHistory(siteId) {
  await writeHistory(siteId, [])
}

export function saveForecastCache(siteId, forecast) {
  try {
    const key = `sentinel_forecast_${siteId}`
    localStorage.setItem(key, JSON.stringify({ forecast, savedAt: Date.now() }))
  } catch {}
}

export function loadForecastCache(siteId) {
  try {
    const key = `sentinel_forecast_${siteId}`
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { forecast, savedAt } = JSON.parse(raw)
    if (Date.now() - savedAt > FORECAST_TTL_MS) return null
    return forecast
  } catch {
    return null
  }
}

export function isForecastStale(siteId) {
  try {
    const key = `sentinel_forecast_${siteId}`
    const raw = localStorage.getItem(key)
    if (!raw) return true
    const { savedAt } = JSON.parse(raw)
    return Date.now() - savedAt > FORECAST_TTL_MS
  } catch {
    return true
  }
}
