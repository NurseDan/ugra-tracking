const STORAGE_KEY = 'sentinel_incidents'
const MAX_INCIDENTS = 500
const subscribers = new Set()

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Normalizes the multiple historical incident shapes into a single read-model.
// Existing callers persist `fromAlert`/`toAlert`; older entries may use
// `fromLevel`/`toLevel`/`severity`/`heightFt`/`flowCfs`. We never mutate the
// stored entry — we only enrich the in-memory copy.
export function normalizeIncident(inc) {
  if (!inc || typeof inc !== 'object') return inc
  const fromLevel = inc.fromLevel ?? inc.fromAlert ?? null
  const toLevel = inc.toLevel ?? inc.toAlert ?? inc.severity ?? null
  return {
    ...inc,
    fromLevel,
    toLevel,
    severity: inc.severity ?? toLevel,
    height: inc.height ?? inc.heightFt ?? null,
    flow: inc.flow ?? inc.flowCfs ?? null
  }
}

function writeRaw(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_INCIDENTS)))
  } catch {}
  notify()
}

function notify() {
  subscribers.forEach((cb) => {
    try { cb() } catch {}
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) notify()
  })
}

export function logIncident(entry) {
  if (!entry) return
  const stamped = {
    id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: entry.time || new Date().toISOString(),
    ...entry
  }
  const existing = readRaw()
  existing.unshift(stamped)
  writeRaw(existing)
}

export function getIncidents() {
  return readRaw().map(normalizeIncident)
}

// Treat YYYY-MM-DD `to` as the END of that calendar day so same-day filters
// include incidents logged later in the day. Other date formats fall through
// to Date parsing as-is.
function parseToBound(value) {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = new Date(`${value}T00:00:00`).getTime()
    return Number.isFinite(t) ? t + 24 * 60 * 60 * 1000 - 1 : null
  }
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

export function listIncidents(options = {}) {
  const {
    gaugeIds = null,
    severities = null,
    from = null,
    to = null,
    search = '',
    limit = null
  } = options

  const fromMs = from ? new Date(from).getTime() : null
  const toMs = parseToBound(to)
  const q = (search || '').trim().toLowerCase()

  let result = readRaw().map(normalizeIncident).filter((inc) => {
    if (gaugeIds && gaugeIds.length && !gaugeIds.includes(inc.gaugeId)) return false
    if (severities && severities.length) {
      if (!severities.includes(inc.toLevel)) return false
    }
    if (fromMs != null) {
      const t = new Date(inc.time).getTime()
      if (Number.isFinite(t) && t < fromMs) return false
    }
    if (toMs != null) {
      const t = new Date(inc.time).getTime()
      if (Number.isFinite(t) && t > toMs) return false
    }
    if (q) {
      const hay = [
        inc.gaugeName, inc.gaugeId, inc.message,
        inc.fromLevel, inc.toLevel, inc.severity, inc.notes
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  if (limit) result = result.slice(0, limit)
  return result
}

export function clearIncidents() {
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
  notify()
}

export function subscribe(cb) {
  if (typeof cb !== 'function') return () => {}
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

export const __test__ = { STORAGE_KEY, MAX_INCIDENTS }
