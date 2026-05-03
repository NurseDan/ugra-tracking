const USGS_STAGE_PARAMETER = '00065'
const USGS_FLOW_PARAMETER = '00060'
const INVALID_VALUE_FLOOR = -900000
const CHUNK_SIZE = 8

function numericValue(reading) {
  const value = Number(reading?.value)
  return Number.isFinite(value) && value > INVALID_VALUE_FLOOR ? value : null
}

function sortByTime(values) {
  return [...values].sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
}

function latestReading(values) {
  const sorted = sortByTime(values)
  return sorted[sorted.length - 1]
}

function chunkIds(ids) {
  const unique = [...new Set(ids)].filter(Boolean)
  const chunks = []
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

function mergeGaugeData(target, source) {
  for (const [site, data] of Object.entries(source)) {
    target[site] = { ...(target[site] || {}), ...data }
  }
  return target
}

async function fetchUSGSChunk(ids) {
  const siteList = ids.join(',')
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteList}&parameterCd=${USGS_STAGE_PARAMETER},${USGS_FLOW_PARAMETER}&period=PT6H&siteStatus=all`

  let res
  try {
    res = await fetch(url)
  } catch (err) {
    console.warn(`USGS request failed (offline?) for sites ${siteList}: ${err?.message || err}`)
    return {}
  }

  if (!res.ok) {
    console.warn(`USGS request failed with ${res.status} for sites ${siteList}`)
    return {}
  }

  let json
  try {
    json = await res.json()
  } catch {
    return {}
  }
  const timeSeries = json?.value?.timeSeries || []
  const result = {}

  timeSeries.forEach(ts => {
    const site = ts?.sourceInfo?.siteCode?.[0]?.value
    const siteName = ts?.sourceInfo?.siteName
    const param = ts?.variable?.variableCode?.[0]?.value
    const rawValues = ts?.values?.[0]?.value || []

    if (!site || !param || rawValues.length === 0) return

    const values = sortByTime(rawValues)
      .map(v => ({ ...v, numeric: numericValue(v) }))
      .filter(v => v.numeric !== null)

    if (values.length === 0) return

    const latest = latestReading(values)

    if (!result[site]) {
      result[site] = {
        site,
        siteName,
        history: [],
        flowHistory: [],
        parameterTimes: {},
        source: 'USGS Instantaneous Values'
      }
    }

    result[site].parameterTimes[param] = latest.dateTime

    if (param === USGS_STAGE_PARAMETER) {
      result[site].height = latest.numeric
      result[site].heightTime = latest.dateTime
      result[site].history = values.map(v => ({
        time: v.dateTime,
        height: v.numeric
      }))
    }

    if (param === USGS_FLOW_PARAMETER) {
      result[site].flow = latest.numeric
      result[site].flowTime = latest.dateTime
      result[site].flowHistory = values.map(v => ({
        time: v.dateTime,
        flow: v.numeric
      }))
    }

    const candidateTimes = [result[site].heightTime, result[site].flowTime].filter(Boolean)
    result[site].time = candidateTimes.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
  })

  return result
}

// Server-first: hit our own /api/gauges/current (which the 24/7 poller
// keeps fresh every 5 minutes). Fall back to direct USGS only if the
// server is unreachable or returned no data for the requested ids.
async function fetchFromServer(ids) {
  try {
    const res = await fetch('/api/gauges/current', { credentials: 'same-origin' })
    if (!res.ok) return null
    const json = await res.json()
    const out = {}
    let any = false
    for (const id of ids) {
      const d = json[id]
      if (!d || !d.time) continue
      out[id] = {
        site: id,
        siteName: d.siteName,
        height: d.height ?? null,
        flow: d.flow ?? null,
        heightTime: d.heightTime || d.time,
        flowTime: d.flowTime || d.time,
        time: d.time,
        history: Array.isArray(d.history) ? d.history : [],
        flowHistory: Array.isArray(d.flowHistory) ? d.flowHistory : [],
        parameterTimes: { '00065': d.heightTime || d.time, '00060': d.flowTime || d.time },
        source: 'Server (USGS via 24/7 poller)'
      }
      any = true
    }
    return any ? out : null
  } catch { return null }
}

export async function fetchUSGSGauges(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return {}

  const fromServer = await fetchFromServer(ids)
  if (fromServer && Object.keys(fromServer).length === [...new Set(ids)].length) {
    return fromServer
  }

  const result = fromServer || {}
  const missing = ids.filter(id => !result[id])
  const chunks = chunkIds(missing)
  const responses = await Promise.all(chunks.map(fetchUSGSChunk))
  responses.forEach(response => mergeGaugeData(result, response))
  return result
}

function parseIVTimeSeries(timeSeries) {
  const stagePoints = []
  const flowPoints = []

  timeSeries.forEach(ts => {
    const param = ts?.variable?.variableCode?.[0]?.value
    const rawValues = ts?.values?.[0]?.value || []

    const values = sortByTime(rawValues)
      .map(v => ({ ...v, numeric: numericValue(v) }))
      .filter(v => v.numeric !== null)

    if (param === USGS_STAGE_PARAMETER) {
      values.forEach(v => stagePoints.push({ time: v.dateTime, height: v.numeric }))
    }
    if (param === USGS_FLOW_PARAMETER) {
      values.forEach(v => flowPoints.push({ time: v.dateTime, flow: v.numeric }))
    }
  })

  return { stagePoints, flowPoints }
}

async function fetchIVChunk(siteId, startDT, endDT) {
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteId}&parameterCd=${USGS_STAGE_PARAMETER},${USGS_FLOW_PARAMETER}&startDT=${startDT}&endDT=${endDT}&siteStatus=all`
  try {
    const res = await fetch(url)
    if (!res.ok) return { stagePoints: [], flowPoints: [] }
    const json = await res.json()
    return parseIVTimeSeries(json?.value?.timeSeries || [])
  } catch {
    return { stagePoints: [], flowPoints: [] }
  }
}

async function fetchDVChunk(siteId, startDT, endDT) {
  const url = `https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${siteId}&parameterCd=${USGS_STAGE_PARAMETER},${USGS_FLOW_PARAMETER}&startDT=${startDT}&endDT=${endDT}&siteStatus=all`
  try {
    const res = await fetch(url)
    if (!res.ok) return { stagePoints: [], flowPoints: [] }
    const json = await res.json()
    const stagePoints = []
    const flowPoints = []
    const timeSeries = json?.value?.timeSeries || []
    timeSeries.forEach(ts => {
      const param = ts?.variable?.variableCode?.[0]?.value
      const rawValues = ts?.values?.[0]?.value || []
      rawValues.forEach(v => {
        const numeric = numericValue(v)
        if (numeric === null) return
        if (param === USGS_STAGE_PARAMETER) stagePoints.push({ time: v.dateTime, height: numeric })
        if (param === USGS_FLOW_PARAMETER) flowPoints.push({ time: v.dateTime, flow: numeric })
      })
    })
    return { stagePoints, flowPoints }
  } catch {
    return { stagePoints: [], flowPoints: [] }
  }
}

export async function fetchUSGS14DayHistory(siteId) {
  if (!siteId) return []

  const now = new Date()
  const endDT = now.toISOString().split('T')[0]
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const sevenDTStr = sevenDaysAgo.toISOString().split('T')[0]
  const fourteenDTStr = fourteenDaysAgo.toISOString().split('T')[0]

  const [ivResult, dvResult] = await Promise.all([
    fetchIVChunk(siteId, sevenDTStr, endDT),
    fetchDVChunk(siteId, fourteenDTStr, sevenDTStr)
  ])

  const flowMap = new Map()
  dvResult.flowPoints.forEach(p => flowMap.set(p.time.split('T')[0], p.flow))
  ivResult.flowPoints.forEach(p => flowMap.set(p.time, p.flow))

  const stageMap = new Map()
  dvResult.stagePoints.forEach(p => stageMap.set(p.time.split('T')[0], p.height))
  ivResult.stagePoints.forEach(p => stageMap.set(p.time, p.height))

  const allTimes = new Set([...stageMap.keys()])
  const points = []

  allTimes.forEach(t => {
    const height = stageMap.get(t)
    const dateKey = t.split('T')[0]
    const flow = flowMap.get(t) ?? flowMap.get(dateKey) ?? null
    if (height !== undefined && height !== null) {
      points.push({ time: t, height, flow })
    }
  })

  return points.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
}
