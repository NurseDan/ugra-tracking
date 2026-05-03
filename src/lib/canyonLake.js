// NOTE on data sources: the original task spec called for a TWDB JSON
// endpoint and TWDB release rate. Verified during implementation that
// waterdatafortexas.org publishes only CSV (no JSON) and that the
// reservoir feeds do NOT include release rate — only elevation, volume,
// percent_full, and area. Release rate is therefore sourced from USGS
// site 08167900 (Guadalupe Rv at Sattler, immediately below the dam),
// which is the standard hydrologic proxy for Canyon Lake outflow and
// is already CORS-friendly. Inflow uses USGS 08167500 above the lake.
const TWDB_RECENT_URL =
  'https://www.waterdatafortexas.org/reservoirs/recent-conditions.csv'
const TWDB_INDIVIDUAL_URL =
  'https://www.waterdatafortexas.org/reservoirs/individual/canyon.csv'
const USGS_BELOW_DAM_SITE = '08167900'
const USGS_INFLOW_SITE = '08167500'
const USGS_FLOW_PARAM = '00060'

const CANYON_STATIC = Object.freeze({
  name: 'Canyon Lake',
  conservationPoolElevationFt: 909,
  floodPoolElevationFt: 943,
  conservationCapacityAcreFt: 378852,
  floodCapacityAcreFt: 740900,
  deadPoolElevationFt: 800,
  damSiteId: USGS_BELOW_DAM_SITE,
  inflowSiteId: USGS_INFLOW_SITE,
  damSiteName: 'Guadalupe Rv at Sattler (USGS 08167900)',
  inflowSiteName: 'Guadalupe Rv at Spring Branch (USGS 08167500)'
})

const CSV_PROXIES = [
  (url) => url,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
]

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length && !l.startsWith('#'))
  if (lines.length < 2) return []
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line)
    const row = {}
    header.forEach((h, i) => {
      row[h] = cols[i]
    })
    return row
  })
}

function num(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function fetchCsvWithFallback(url, signal) {
  let lastErr = null
  for (const wrap of CSV_PROXIES) {
    try {
      const res = await fetch(wrap(url), { signal })
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`)
        continue
      }
      const text = await res.text()
      if (text && text.length > 50) return text
      lastErr = new Error('Empty response')
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      lastErr = err
    }
  }
  throw lastErr || new Error('All CSV sources failed')
}

async function fetchTwdbCanyon(signal) {
  try {
    const text = await fetchCsvWithFallback(TWDB_INDIVIDUAL_URL, signal)
    const rows = parseCsv(text)
    if (rows.length > 0) {
      const latest = rows[rows.length - 1]
      return {
        timestamp: latest.date || latest.timestamp || null,
        elevationFt: num(latest.water_level) ?? num(latest.elevation),
        volumeAcreFt: num(latest.reservoir_storage) ?? num(latest.volume),
        percentFull: num(latest.percent_full),
        areaAcres: num(latest.surface_area) ?? num(latest.area),
        source: 'TWDB individual'
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
  }

  const text = await fetchCsvWithFallback(TWDB_RECENT_URL, signal)
  const rows = parseCsv(text)
  const canyon = rows.find(
    (r) =>
      (r.condensed_name || '').toLowerCase() === 'canyon' ||
      (r.short_name || '').toLowerCase() === 'canyon'
  )
  if (!canyon) throw new Error('Canyon Lake row not found in TWDB feed')
  return {
    timestamp: canyon.timestamp || null,
    elevationFt: num(canyon.elevation),
    volumeAcreFt: num(canyon.volume),
    percentFull: num(canyon.percent_full),
    areaAcres: num(canyon.area),
    conservationCapacityAcreFt: num(canyon.conservation_capacity),
    conservationPoolElevationFt: num(canyon.conservation_pool_elevation),
    deadPoolElevationFt: num(canyon.dead_pool_elevation),
    source: 'TWDB recent-conditions'
  }
}

async function fetchUsgsLatestFlow(siteId, signal) {
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteId}&parameterCd=${USGS_FLOW_PARAM}&period=PT6H&siteStatus=all`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`USGS HTTP ${res.status} for ${siteId}`)
  const json = await res.json()
  const ts = json?.value?.timeSeries?.[0]
  const values = ts?.values?.[0]?.value || []
  if (values.length === 0) return null
  const sorted = [...values].sort(
    (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
  )
  const last = sorted[sorted.length - 1]
  const n = Number(last?.value)
  if (!Number.isFinite(n) || n < -900000) return null
  return { cfs: n, time: last.dateTime, siteName: ts?.sourceInfo?.siteName }
}

function safePercentFull(volume, capacity) {
  if (!Number.isFinite(volume) || !Number.isFinite(capacity) || capacity <= 0) return null
  return Math.max(0, Math.min(200, (volume / capacity) * 100))
}

export async function fetchCanyonLakeStatus({ signal } = {}) {
  const errors = []
  const results = await Promise.allSettled([
    fetchTwdbCanyon(signal),
    fetchUsgsLatestFlow(USGS_BELOW_DAM_SITE, signal),
    fetchUsgsLatestFlow(USGS_INFLOW_SITE, signal)
  ])

  const twdb = results[0].status === 'fulfilled' ? results[0].value : null
  const release = results[1].status === 'fulfilled' ? results[1].value : null
  const inflow = results[2].status === 'fulfilled' ? results[2].value : null

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const labels = ['TWDB', 'USGS release', 'USGS inflow']
      errors.push(`${labels[i]}: ${r.reason?.message || r.reason || 'failed'}`)
    }
  })

  if (!twdb && !release && !inflow) {
    const err = new Error(errors.join(' · ') || 'All upstream sources failed')
    err.partial = false
    throw err
  }

  const conservationCapacity =
    twdb?.conservationCapacityAcreFt ?? CANYON_STATIC.conservationCapacityAcreFt
  const conservationPoolElevation =
    twdb?.conservationPoolElevationFt ?? CANYON_STATIC.conservationPoolElevationFt
  const deadPoolElevation =
    twdb?.deadPoolElevationFt ?? CANYON_STATIC.deadPoolElevationFt

  const percentFull =
    twdb?.percentFull ??
    safePercentFull(twdb?.volumeAcreFt, conservationCapacity)

  const updatedCandidates = [twdb?.timestamp, release?.time, inflow?.time].filter(Boolean)
  const updated =
    updatedCandidates
      .map((t) => new Date(t).getTime())
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)[0] || null

  return {
    name: CANYON_STATIC.name,
    poolElevationFt: twdb?.elevationFt ?? null,
    percentFull: percentFull ?? null,
    volumeAcreFt: twdb?.volumeAcreFt ?? null,
    conservationCapacity,
    conservationPoolElevationFt: conservationPoolElevation,
    floodCapacity: CANYON_STATIC.floodCapacityAcreFt,
    floodPoolElevationFt: CANYON_STATIC.floodPoolElevationFt,
    deadPoolElevationFt: deadPoolElevation,
    releaseCfs: release?.cfs ?? null,
    releaseSiteName: release?.siteName ?? CANYON_STATIC.damSiteName,
    releaseTime: release?.time ?? null,
    inflowCfs: inflow?.cfs ?? null,
    inflowSiteName: inflow?.siteName ?? CANYON_STATIC.inflowSiteName,
    inflowTime: inflow?.time ?? null,
    updated: updated ? new Date(updated).toISOString() : null,
    sources: {
      twdb: !!twdb,
      release: !!release,
      inflow: !!inflow
    },
    warnings: errors
  }
}

export const CANYON_LAKE_STATIC = CANYON_STATIC
