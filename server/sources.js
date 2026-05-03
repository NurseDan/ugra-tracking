// Server-side fetchers for upstream public APIs.
// These are deliberately decoupled from the browser-side modules so the
// scheduler can run with no DOM/IndexedDB dependencies.

const USGS_STAGE = '00065'
const USGS_FLOW = '00060'
const INVALID_VALUE_FLOOR = -900000

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > INVALID_VALUE_FLOOR ? n : null
}

function sortByTime(values) {
  return [...values].sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// USGS Instantaneous Values for the past 6h, parsed into per-gauge records
// with full history arrays so the alert engine can compute rise rates.
export async function fetchUSGSCurrent(siteIds) {
  const result = {}
  const chunks = chunk([...new Set(siteIds.filter(Boolean))], 8)
  for (const chunkIds of chunks) {
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${chunkIds.join(',')}&parameterCd=${USGS_STAGE},${USGS_FLOW}&period=PT6H&siteStatus=all`
    let json
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`[usgs] ${res.status} for ${chunkIds.join(',')}`)
        continue
      }
      json = await res.json()
    } catch (err) {
      console.warn(`[usgs] fetch error: ${err?.message || err}`)
      continue
    }
    const series = json?.value?.timeSeries || []
    for (const ts of series) {
      const site = ts?.sourceInfo?.siteCode?.[0]?.value
      const param = ts?.variable?.variableCode?.[0]?.value
      const raw = ts?.values?.[0]?.value || []
      if (!site || !param) continue
      const values = sortByTime(raw)
        .map(v => ({ time: v.dateTime, numeric: num(v.value) }))
        .filter(v => v.numeric !== null)
      if (!values.length) continue
      const latest = values[values.length - 1]
      if (!result[site]) {
        result[site] = { site, history: [], flowHistory: [] }
      }
      if (param === USGS_STAGE) {
        result[site].height = latest.numeric
        result[site].heightTime = latest.time
        result[site].history = values.map(v => ({ time: v.time, height: v.numeric }))
      }
      if (param === USGS_FLOW) {
        result[site].flow = latest.numeric
        result[site].flowTime = latest.time
        result[site].flowHistory = values.map(v => ({ time: v.time, flow: v.numeric }))
      }
      const candidates = [result[site].heightTime, result[site].flowTime].filter(Boolean)
      result[site].time = candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
    }
  }
  return result
}

export async function fetchOpenMeteoForecast(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,precipitation_probability&timezone=America/Chicago&forecast_days=4&past_days=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`open-meteo ${res.status}`)
  const json = await res.json()
  const now = Date.now()
  const past24Start = now - 24 * 3600 * 1000
  const next72End = now + 72 * 3600 * 1000
  const next24End = now + 24 * 3600 * 1000
  const times = json?.hourly?.time || []
  const precip = json?.hourly?.precipitation || []
  const prob = json?.hourly?.precipitation_probability || []
  let past24h = 0
  let total24 = 0
  let max24 = 0
  let maxProb = 0
  let hours24 = 0
  const hourly72 = []
  const hourly24 = []
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime()
    const inches = Number(precip[i] || 0) * 0.0393701
    const p = Number(prob[i] || 0)
    if (t >= past24Start && t <= now) past24h += inches
    if (t > now && t <= next72End) hourly72.push({ time: times[i], inches, probability: p })
    if (t > now && t <= next24End) {
      hourly24.push({ time: times[i], inches, probability: p })
      if (inches > 0) { total24 += inches; hours24 += 1 }
      if (inches > max24) max24 = inches
      if (p > maxProb) maxProb = p
    }
  }
  return {
    totalInches: total24,
    maxHourlyInches: max24,
    hoursWithRain: hours24,
    maxProbability: maxProb,
    hourly: hourly24,
    hourly72,
    past24hInches: past24h
  }
}

// NWS active alerts for TX (covers the basin). Returns array of normalized alerts.
export async function fetchNwsAlerts() {
  const url = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&area=TX'
  const res = await fetch(url, {
    headers: {
      Accept: 'application/geo+json',
      'User-Agent': '(guadalupe-sentinel, ops@guadalupe-sentinel.local)'
    }
  })
  if (!res.ok) throw new Error(`nws ${res.status}`)
  const json = await res.json()
  return (json?.features || []).map(f => {
    const p = f?.properties || {}
    const geo = p.geocode || {}
    return {
      id: p.id || f?.id,
      event: p.event || 'Alert',
      severity: p.severity || 'Unknown',
      certainty: p.certainty || 'Unknown',
      urgency: p.urgency || 'Unknown',
      headline: p.headline || p.event || 'Weather Alert',
      description: p.description || '',
      instruction: p.instruction || '',
      sender: p.senderName || '',
      effective: p.effective || p.sent || null,
      onset: p.onset || null,
      expires: p.expires || p.ends || null,
      areaDesc: p.areaDesc || '',
      ugcCodes: Array.isArray(geo.UGC) ? geo.UGC : [],
      sameCodes: Array.isArray(geo.SAME) ? geo.SAME : [],
      geometry: f?.geometry || null
    }
  })
}

const NWPS_BASE = 'https://api.water.noaa.gov/nwps/v1'

function pickStage(point) {
  const stage = num(point?.primary)
  if (stage === null || !point?.validTime) return null
  return { t: point.validTime, stage }
}

function extractData(payload, key) {
  if (!payload) return []
  if (Array.isArray(payload.data)) return payload.data
  if (key && payload[key]?.data) return payload[key].data
  return payload?.observed?.data || payload?.forecast?.data || []
}

export async function fetchAhps(lid) {
  if (!lid) return null
  const enc = encodeURIComponent(lid)
  let meta
  try {
    const res = await fetch(`${NWPS_BASE}/gauges/${enc}`, { headers: { Accept: 'application/json' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`ahps meta ${res.status}`)
    meta = await res.json()
  } catch (err) {
    console.warn(`[ahps] ${lid}: ${err.message}`)
    return null
  }
  const [obs, fcst] = await Promise.allSettled([
    fetch(`${NWPS_BASE}/gauges/${enc}/stageflow`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${NWPS_BASE}/gauges/${enc}/stageflow/forecast`).then(r => r.ok ? r.json() : null).catch(() => null)
  ])
  const observed = extractData(obs.status === 'fulfilled' ? obs.value : null, 'observed')
    .map(pickStage).filter(Boolean)
  const forecast = extractData(fcst.status === 'fulfilled' ? fcst.value : null, 'forecast')
    .map(pickStage).filter(Boolean)
  const cats = meta?.flood?.categories || {}
  return {
    lid,
    name: meta?.name || null,
    observed,
    forecast,
    floodCategories: {
      action: num(cats.action?.stage),
      minor: num(cats.minor?.stage),
      moderate: num(cats.moderate?.stage),
      major: num(cats.major?.stage)
    },
    currentFloodCategory: meta?.status?.observed?.floodCategory || null,
    forecastFloodCategory: meta?.status?.forecast?.floodCategory || null
  }
}

export async function fetchNwm(reachId, range = 'medium_range') {
  if (!reachId) return null
  try {
    const url = `${NWPS_BASE}/reaches/${encodeURIComponent(reachId)}/streamflow?series=${range}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    const flat = Array.isArray(json?.data) ? json.data : Array.isArray(json?.series) ? json.series : []
    const series = flat.map(p => {
      const t = p?.validTime || p?.time
      const q = num(p?.primary ?? p?.q ?? p?.value)
      if (!t || q === null) return null
      return { t, q }
    }).filter(Boolean).sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
    if (!series.length) return null
    return { reachId, range, series, updated: json?.issuedTime || null }
  } catch {
    return null
  }
}

export async function fetchCanyonLake() {
  // Lightweight: USGS inflow + release stations. TWDB CSV reservoir levels.
  const USGS = (id) => `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${id}&parameterCd=00060&period=PT6H&siteStatus=all`
  async function getFlow(id) {
    try {
      const r = await fetch(USGS(id))
      if (!r.ok) return null
      const j = await r.json()
      const vals = j?.value?.timeSeries?.[0]?.values?.[0]?.value || []
      if (!vals.length) return null
      const latest = vals.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime)).at(-1)
      const n = num(latest?.value)
      return n === null ? null : { cfs: n, time: latest.dateTime }
    } catch { return null }
  }
  async function getTwdb() {
    try {
      const r = await fetch('https://www.waterdatafortexas.org/reservoirs/individual/canyon.csv')
      if (!r.ok) return null
      const text = await r.text()
      const lines = text.split(/\r?\n/).filter(l => l && !l.startsWith('#'))
      if (lines.length < 2) return null
      const header = lines[0].split(',').map(s => s.trim())
      const last = lines.at(-1).split(',')
      const row = {}
      header.forEach((h, i) => { row[h] = last[i] })
      return {
        timestamp: row.date || row.timestamp || null,
        elevationFt: num(row.water_level) ?? num(row.elevation),
        volumeAcreFt: num(row.reservoir_storage) ?? num(row.volume),
        percentFull: num(row.percent_full)
      }
    } catch { return null }
  }
  const [release, inflow, twdb] = await Promise.all([
    getFlow('08167900'),
    getFlow('08167500'),
    getTwdb()
  ])
  return {
    name: 'Canyon Lake',
    poolElevationFt: twdb?.elevationFt ?? null,
    percentFull: twdb?.percentFull ?? null,
    volumeAcreFt: twdb?.volumeAcreFt ?? null,
    conservationPoolElevationFt: 909,
    floodPoolElevationFt: 943,
    releaseCfs: release?.cfs ?? null,
    releaseTime: release?.time ?? null,
    inflowCfs: inflow?.cfs ?? null,
    inflowTime: inflow?.time ?? null,
    updated: new Date().toISOString()
  }
}
