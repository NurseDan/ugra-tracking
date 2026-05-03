const NWS_API_BASE = 'https://api.weather.gov'
const USER_AGENT = '(guadalupe-sentinel, contact@guadalupe-sentinel.local)'

const FLOOD_EVENT_PATTERNS = [
  /flash flood/i,
  /flood warning/i,
  /flood watch/i,
  /flood advisory/i,
  /flood statement/i,
  /areal flood/i,
  /coastal flood/i,
  /river flood/i,
  /hydrologic/i
]

const RAINFALL_KEYWORDS = /(rain|rainfall|downpour|torrential|heavy precipitation|inches of rain|flooding)/i

export const NWS_SEVERITY_RANK = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0
}

export function isFloodRelevantEvent(event = '', description = '') {
  if (!event) return false
  if (FLOOD_EVENT_PATTERNS.some((re) => re.test(event))) return true
  if (/severe thunderstorm/i.test(event) && RAINFALL_KEYWORDS.test(description || '')) {
    return true
  }
  return false
}

export function normalizeAlert(feature) {
  const props = feature?.properties || {}
  const ugcCodes = []
  const sameCodes = []

  const geocode = props.geocode || {}
  if (Array.isArray(geocode.UGC)) ugcCodes.push(...geocode.UGC)
  if (Array.isArray(geocode.SAME)) sameCodes.push(...geocode.SAME)

  return {
    id: props.id || feature?.id || null,
    event: props.event || 'Alert',
    severity: props.severity || 'Unknown',
    certainty: props.certainty || 'Unknown',
    urgency: props.urgency || 'Unknown',
    headline: props.headline || props.event || 'Weather Alert',
    description: props.description || '',
    instruction: props.instruction || '',
    sender: props.senderName || '',
    effective: props.effective || props.sent || null,
    onset: props.onset || null,
    expires: props.expires || props.ends || null,
    areaDesc: props.areaDesc || '',
    ugcCodes,
    sameCodes,
    geometry: feature?.geometry || null,
    raw: props
  }
}

export function bboxFromGauges(gauges = [], padDeg = 0.25) {
  const lats = gauges.map((g) => g.lat).filter(Number.isFinite)
  const lngs = gauges.map((g) => g.lng).filter(Number.isFinite)
  if (lats.length === 0 || lngs.length === 0) return null
  return {
    minLat: Math.min(...lats) - padDeg,
    maxLat: Math.max(...lats) + padDeg,
    minLng: Math.min(...lngs) - padDeg,
    maxLng: Math.max(...lngs) + padDeg
  }
}

function statesForBbox(bbox) {
  if (!bbox) return []
  const states = new Set()
  const candidates = [
    { code: 'TX', minLat: 25.8, maxLat: 36.6, minLng: -106.7, maxLng: -93.5 },
    { code: 'NM', minLat: 31.3, maxLat: 37.0, minLng: -109.1, maxLng: -103.0 },
    { code: 'OK', minLat: 33.6, maxLat: 37.0, minLng: -103.0, maxLng: -94.4 },
    { code: 'AR', minLat: 33.0, maxLat: 36.5, minLng: -94.6, maxLng: -89.6 },
    { code: 'LA', minLat: 28.9, maxLat: 33.0, minLng: -94.0, maxLng: -88.8 }
  ]
  for (const s of candidates) {
    if (!(bbox.maxLat < s.minLat || bbox.minLat > s.maxLat || bbox.maxLng < s.minLng || bbox.minLng > s.maxLng)) {
      states.add(s.code)
    }
  }
  return [...states]
}

// The NWS /alerts/active endpoint does not support an arbitrary bbox query
// parameter. We narrow server-side using the `area` (state) param derived from
// the bbox, then post-filter the returned alert polygons against the bbox.
async function fetchActiveAlertsFromServer(signal) {
  try {
    const res = await fetch('/api/source/nws_alerts', { credentials: 'same-origin', signal })
    if (!res.ok) return null
    const json = await res.json()
    const alerts = Array.isArray(json?.alerts) ? json.alerts : null
    if (!alerts) return null
    return alerts.filter((a) => isFloodRelevantEvent(a.event, a.description))
  } catch { return null }
}

export async function fetchActiveAlerts({ bbox, signal, gaugeUgcs = null } = {}) {
  const cached = await fetchActiveAlertsFromServer(signal)
  if (cached) {
    const ugcAllowList = Array.isArray(gaugeUgcs) && gaugeUgcs.length > 0 ? gaugeUgcs : null
    return cached.filter((a) => {
      const polygons = extractPolygons(a.geometry)
      if (polygons.length > 0) return bbox ? alertIntersectsBbox(a, bbox) : true
      if (!ugcAllowList) return !bbox
      return Array.isArray(a.ugcCodes) && a.ugcCodes.some((u) => ugcAllowList.includes(u))
    })
  }
  const params = new URLSearchParams({ status: 'actual', message_type: 'alert,update' })
  const states = statesForBbox(bbox)
  if (states.length > 0) {
    params.set('area', states.join(','))
  }
  const url = `${NWS_API_BASE}/alerts/active?${params.toString()}`

  const res = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/geo+json',
      'User-Agent': USER_AGENT
    }
  })

  if (!res.ok) {
    throw new Error(`NWS alerts request failed with ${res.status}`)
  }

  const json = await res.json()
  const features = Array.isArray(json?.features) ? json.features : []
  const normalized = features.map(normalizeAlert)
  const filtered = normalized.filter((a) => isFloodRelevantEvent(a.event, a.description))

  const ugcAllowList = Array.isArray(gaugeUgcs) && gaugeUgcs.length > 0 ? gaugeUgcs : null

  return filtered.filter((a) => {
    const polygons = extractPolygons(a.geometry)
    if (polygons.length > 0) {
      return bbox ? alertIntersectsBbox(a, bbox) : true
    }
    // No geometry: only keep if any of its UGCs overlap the gauges' counties.
    if (!ugcAllowList) return !bbox
    return Array.isArray(a.ugcCodes) && a.ugcCodes.some((u) => ugcAllowList.includes(u))
  })
}

function alertIntersectsBbox(alert, bbox) {
  const polygons = extractPolygons(alert.geometry)
  if (polygons.length === 0) return true
  return polygons.some((ring) => {
    const lats = ring.map((p) => p[1])
    const lngs = ring.map((p) => p[0])
    const aMinLat = Math.min(...lats)
    const aMaxLat = Math.max(...lats)
    const aMinLng = Math.min(...lngs)
    const aMaxLng = Math.max(...lngs)
    return !(aMaxLat < bbox.minLat || aMinLat > bbox.maxLat || aMaxLng < bbox.minLng || aMinLng > bbox.maxLng)
  })
}

function extractPolygons(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') {
    return geometry.coordinates?.[0] ? [geometry.coordinates[0]] : []
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).map((poly) => poly?.[0]).filter(Boolean)
  }
  return []
}

export function pointInPolygon(lat, lng, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function alertContainsPoint(alert, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  const polygons = extractPolygons(alert.geometry)
  if (polygons.length > 0) {
    return polygons.some((ring) => pointInPolygon(lat, lng, ring))
  }
  return false
}

// Approximate bounding boxes for the TX counties our gauges sit in. Used to
// resolve a gauge lat/lng to one or more candidate UGC codes when an alert
// has no polygon geometry (a common case for headline-only flood statements).
const TX_COUNTY_UGC_BBOXES = [
  { ugc: 'TXC265', name: 'Kerr',    minLat: 29.90, maxLat: 30.30, minLng: -99.62, maxLng: -98.92 },
  { ugc: 'TXC259', name: 'Kendall', minLat: 29.78, maxLat: 30.10, minLng: -98.99, maxLng: -98.55 },
  { ugc: 'TXC091', name: 'Comal',   minLat: 29.60, maxLat: 29.99, minLng: -98.55, maxLng: -98.04 },
  { ugc: 'TXC019', name: 'Bandera', minLat: 29.55, maxLat: 29.93, minLng: -99.62, maxLng: -98.93 },
  { ugc: 'TXC463', name: 'Uvalde',  minLat: 29.08, maxLat: 29.78, minLng: -100.10, maxLng: -99.40 }
]

const TX_COUNTY_UGC_BY_NAME = TX_COUNTY_UGC_BBOXES.reduce((acc, c) => {
  acc[c.name] = c.ugc
  return acc
}, {})

export function ugcForCounty(countyName) {
  return TX_COUNTY_UGC_BY_NAME[countyName] || null
}

export function ugcCodesForPoint(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
  return TX_COUNTY_UGC_BBOXES
    .filter((c) => lat >= c.minLat && lat <= c.maxLat && lng >= c.minLng && lng <= c.maxLng)
    .map((c) => c.ugc)
}

export function alertMatchesUgcs(alert, ugcs) {
  if (!Array.isArray(alert.ugcCodes) || alert.ugcCodes.length === 0) return false
  if (!Array.isArray(ugcs) || ugcs.length === 0) return false
  return ugcs.some((u) => alert.ugcCodes.includes(u))
}

export function alertsForGauge(gaugeLat, gaugeLng, alerts = []) {
  if (!Array.isArray(alerts) || alerts.length === 0) return []
  const candidateUgcs = ugcCodesForPoint(gaugeLat, gaugeLng)
  return alerts.filter((alert) => {
    if (alertContainsPoint(alert, gaugeLat, gaugeLng)) return true
    if (candidateUgcs.length > 0 && alertMatchesUgcs(alert, candidateUgcs)) return true
    return false
  })
}

export function severityRank(severity) {
  return NWS_SEVERITY_RANK[severity] ?? 0
}

export function sortAlertsBySeverity(alerts = []) {
  return [...alerts].sort((a, b) => {
    const diff = severityRank(b.severity) - severityRank(a.severity)
    if (diff !== 0) return diff
    const aExp = a.expires ? new Date(a.expires).getTime() : 0
    const bExp = b.expires ? new Date(b.expires).getTime() : 0
    return bExp - aExp
  })
}

export const MOCK_ALERT = {
  id: 'mock-alert-1',
  event: 'Flash Flood Warning',
  severity: 'Severe',
  certainty: 'Observed',
  urgency: 'Immediate',
  headline: 'Flash Flood Warning issued for Kerr County until 9:45 PM CDT',
  description: 'At 645 PM CDT, Doppler radar indicated thunderstorms producing heavy rain across the warned area. Between 2 and 4 inches of rain have fallen.',
  instruction: 'Turn around, don\u2019t drown when encountering flooded roads. Most flood deaths occur in vehicles.',
  sender: 'NWS Austin/San Antonio TX',
  effective: new Date().toISOString(),
  onset: new Date().toISOString(),
  expires: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  areaDesc: 'Kerr, TX; Kendall, TX',
  ugcCodes: ['TXC265', 'TXC259'],
  sameCodes: ['048265', '048259'],
  geometry: null,
  raw: {}
}
