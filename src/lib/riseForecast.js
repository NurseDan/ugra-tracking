import { getDefaultProvider } from './aiBriefing'
import { saveForecastCache, loadForecastCache, getHistory } from './gaugeHistory'
import { fetchQPF72h } from './weatherApi'
import { GAUGES } from '../config/gauges'

const RAINFALL_RISE_FACTOR = 0.6
const PAST_RAINFALL_RISE_FACTOR = 0.3
const DECAY_HALF_LIFE_HOURS = 12
const FORECAST_HOURS = 72
const CONFIDENCE_BASE = 0.55

const inFlight = new Set()

export function getGaugeConfig(siteId) {
  return GAUGES.find(g => g.id === siteId) || null
}

export function floodCategory(stageFt, floodStageFt) {
  if (!floodStageFt) return 'Unknown'
  if (stageFt >= floodStageFt * 1.5) return 'Major Flood'
  if (stageFt >= floodStageFt * 1.2) return 'Moderate Flood'
  if (stageFt >= floodStageFt) return 'Minor Flood'
  if (stageFt >= floodStageFt - 2) return 'Action Stage'
  return 'Normal'
}

function computeRecentRiseRate(history, windowHours = 6) {
  if (!history || history.length < 2) return 0
  const now = Date.now()
  const cutoff = now - windowHours * 60 * 60 * 1000

  const recent = history
    .filter(p => p.height !== null && p.height !== undefined)
    .filter(p => new Date(p.time).getTime() >= cutoff)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  if (recent.length < 2) return 0
  const oldest = recent[0]
  const newest = recent[recent.length - 1]
  const dtHours = (new Date(newest.time).getTime() - new Date(oldest.time).getTime()) / 3_600_000
  if (dtHours < 0.1) return 0
  return (newest.height - oldest.height) / dtHours
}

function deterministicForecast({ currentStage, riseRateFtPerHr, qpf, floodStageFt, past24hInches, llmPeak }) {
  const now = Date.now()
  const points = []

  const pastRainfallBoost = (past24hInches || 0) * PAST_RAINFALL_RISE_FACTOR

  for (let h = 0; h < FORECAST_HOURS; h++) {
    const t = new Date(now + h * 3_600_000).toISOString()

    const decayFactor = Math.pow(0.5, h / DECAY_HALF_LIFE_HOURS)
    const trendRise = riseRateFtPerHr * decayFactor

    const rainfallBucket = qpf && qpf[h] ? qpf[h].inches : 0
    const rainfallRise = rainfallBucket * RAINFALL_RISE_FACTOR

    const pastBoostDecay = pastRainfallBoost * Math.pow(0.5, h / 8)
    const pastBoostHourly = h === 0 ? pastBoostDecay : 0

    const deltaH = trendRise + rainfallRise + pastBoostHourly
    const prevStage = h === 0 ? currentStage : points[h - 1].stageFt
    const stageFt = Math.max(0, prevStage + deltaH)

    const uncertainty = Math.max(0.05, 0.15 * h / 24)
    const low = Math.max(0, stageFt - uncertainty)
    const high = stageFt + uncertainty

    points.push({ t, stageFt, low, high })
  }

  let peak = { stageFt: currentStage, time: new Date(now).toISOString(), category: floodCategory(currentStage, floodStageFt) }
  for (const p of points) {
    if (p.stageFt > peak.stageFt) {
      peak = { stageFt: p.stageFt, time: p.t, category: floodCategory(p.stageFt, floodStageFt) }
    }
  }

  if (llmPeak && llmPeak.stageFt > currentStage && llmPeak.stageFt !== peak.stageFt) {
    const scale = llmPeak.stageFt / Math.max(0.01, peak.stageFt)
    const adjPoints = points.map(p => {
      const adj = currentStage + (p.stageFt - currentStage) * scale
      const s = Math.max(0, adj)
      const u = Math.max(0.05, 0.15 * (points.indexOf(p) / 24))
      return { ...p, stageFt: s, low: Math.max(0, s - u), high: s + u }
    })
    let adjPeak = { stageFt: currentStage, time: new Date(now).toISOString(), category: floodCategory(currentStage, floodStageFt) }
    for (const p of adjPoints) {
      if (p.stageFt > adjPeak.stageFt) {
        adjPeak = { stageFt: p.stageFt, time: p.t, category: floodCategory(p.stageFt, floodStageFt) }
      }
    }
    return { points: adjPoints, peak: adjPeak }
  }

  return { points, peak }
}

function buildNarrative({ currentStage, riseRateFtPerHr, totalQPF, past24hInches, peak, floodStageFt }) {
  const direction = riseRateFtPerHr > 0.05 ? 'rising' : riseRateFtPerHr < -0.05 ? 'falling' : 'holding steady'
  const pastPart = past24hInches > 0.05 ? ` ${past24hInches.toFixed(2)}" of rain fell in the past 24 hours.` : ''
  const rainPart = totalQPF > 0.1 ? ` ${totalQPF.toFixed(2)}" of precipitation is forecast over the next 72 hours.` : ''
  const peakPart = peak.stageFt > currentStage
    ? ` Peak stage of ${peak.stageFt.toFixed(1)} ft expected around ${new Date(peak.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}.`
    : ' No significant rise above current stage is expected.'
  const categoryPart = floodStageFt ? ` Forecast peak reaches ${peak.category}.` : ''
  return `Stage is currently ${currentStage.toFixed(1)} ft and ${direction}.${pastPart}${rainPart}${peakPart}${categoryPart}`
}

const FORECAST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative', 'confidence', 'peakStageFt', 'peakCategory'],
  properties: {
    narrative: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    peakStageFt: { type: 'number' },
    peakCategory: { type: 'string' }
  }
}

async function llmForecast({ currentStage, riseRateFtPerHr, qpf, past24hInches, floodStageFt, gaugeName, deterministicResult, ahpsForecast, streamflowForecast }) {
  const provider = getDefaultProvider()
  if (!provider.hasKey) return null

  const totalQPF = qpf ? qpf.reduce((s, h) => s + h.inches, 0) : 0
  const next24QPF = qpf ? qpf.slice(0, 24).reduce((s, h) => s + h.inches, 0) : 0

  const context = {
    gauge: gaugeName,
    currentStageFt: currentStage,
    riseRateFtPerHr: Number(riseRateFtPerHr.toFixed(3)),
    floodStageFt: floodStageFt ?? null,
    past24hRainfallInches: Number((past24hInches || 0).toFixed(2)),
    qpfNext24hInches: Number(next24QPF.toFixed(2)),
    qpfTotal72hInches: Number(totalQPF.toFixed(2)),
    deterministicPeakFt: Number(deterministicResult.peak.stageFt.toFixed(2)),
    deterministicPeakCategory: deterministicResult.peak.category,
    officialAhpsForecast: ahpsForecast
      ? {
          peakFt: ahpsForecast.peakFt ?? ahpsForecast.crestFt ?? null,
          peakAt: ahpsForecast.peakAt ?? ahpsForecast.crestAt ?? null,
          floodCategory: ahpsForecast.floodCategory ?? null
        }
      : null,
    officialNwmForecast: streamflowForecast
      ? {
          peakCfs: streamflowForecast.peakCfs ?? null,
          peakAt: streamflowForecast.peakAt ?? null
        }
      : null
  }

  const system = `You are a hydrologist producing a short flood stage forecast narrative for the Guadalupe River basin in Texas.
Base your forecast only on the data provided. When official AHPS or NWM forecasts are present, weight them heavily in your peak estimate.
Be concise (2-3 sentences max). Do not invent data. 
Output MUST be valid JSON matching the requested schema.`

  const user = `Produce a river rise forecast narrative and confidence estimate based on this data:

DATA:
${JSON.stringify(context, null, 2)}

Return JSON with:
- narrative: 2-3 sentence plain-English forecast (include current stage, trend, rainfall impact, expected peak; mention official forecasts if available)
- confidence: float 0-1 (higher when official AHPS/NWM data is present; lower when only trend+QPF)
- peakStageFt: best estimate of 72h peak in feet (bias toward official AHPS peak if present)
- peakCategory: flood category label for that peak`

  try {
    const result = await provider.chatJson({
      system,
      user,
      schema: FORECAST_SCHEMA,
      schemaName: 'rise_forecast'
    })
    return result
  } catch (err) {
    console.warn('[riseForecast] LLM call failed, using deterministic result:', err?.message)
    return null
  }
}

export async function generateRiseForecast(siteId, history, options = {}) {
  const historyToUse = history && history.length > 0 ? history : await getHistory(siteId)
  if (!siteId || !historyToUse || historyToUse.length === 0) return null

  const cached = loadForecastCache(siteId)
  if (cached && !options.forceRefresh) return cached

  const gauge = getGaugeConfig(siteId)
  const sortedHistory = [...historyToUse]
    .filter(p => p.height !== null && p.height !== undefined)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

  if (sortedHistory.length === 0) return null

  const currentStage = sortedHistory[sortedHistory.length - 1].height
  const riseRateFtPerHr = computeRecentRiseRate(sortedHistory, 6)
  const floodStageFt = gauge?.floodStageFt ?? null

  let qpf = []
  let past24hInches = 0
  if (gauge?.lat && gauge?.lng) {
    try {
      const result = await fetchQPF72h(gauge.lat, gauge.lng)
      qpf = result.hourly || []
      past24hInches = result.past24hInches || 0
    } catch {
      qpf = []
    }
  }

  const ahpsForecast = options.ahpsForecast || null
  const streamflowForecast = options.streamflowForecast || null

  const det = deterministicForecast({ currentStage, riseRateFtPerHr, qpf, floodStageFt, past24hInches, llmPeak: null })

  let llmResult = null
  try {
    llmResult = await llmForecast({
      currentStage,
      riseRateFtPerHr,
      qpf,
      past24hInches,
      floodStageFt,
      gaugeName: gauge?.name || siteId,
      deterministicResult: det,
      ahpsForecast,
      streamflowForecast
    })
  } catch {}

  let finalPoints = det.points
  let finalPeak = det.peak

  if (llmResult && llmResult.peakStageFt) {
    const adj = deterministicForecast({
      currentStage,
      riseRateFtPerHr,
      qpf,
      floodStageFt,
      past24hInches,
      llmPeak: { stageFt: llmResult.peakStageFt }
    })
    finalPoints = adj.points
    finalPeak = {
      stageFt: llmResult.peakStageFt,
      time: adj.peak.time,
      category: llmResult.peakCategory || floodCategory(llmResult.peakStageFt, floodStageFt)
    }
  }

  const totalQPF = qpf.reduce((s, h) => s + h.inches, 0)
  const narrative = llmResult?.narrative || buildNarrative({
    currentStage, riseRateFtPerHr, totalQPF, past24hInches, peak: finalPeak, floodStageFt
  })

  const sources = ['USGS observed trend', 'Open-Meteo QPF (72h)']
  if (past24hInches > 0.01) sources.push('Open-Meteo past 24h rainfall')
  if (ahpsForecast) sources.push('AHPS official forecast')
  if (streamflowForecast) sources.push('NWM streamflow forecast')
  if (llmResult) sources.push('AI narrative (OpenAI)')

  const forecast = {
    points: finalPoints,
    peak: finalPeak,
    narrative,
    generatedAt: new Date().toISOString(),
    sources,
    confidence: llmResult?.confidence ?? Math.max(0.2, CONFIDENCE_BASE - 0.005 * FORECAST_HOURS),
    provider: llmResult ? 'llm' : 'deterministic'
  }

  saveForecastCache(siteId, forecast)
  return forecast
}

export async function generateAllForecasts(options = {}) {
  const results = {}
  for (const gauge of GAUGES) {
    if (inFlight.has(gauge.id)) continue
    inFlight.add(gauge.id)
    try {
      const fc = await generateRiseForecast(gauge.id, null, options)
      if (fc) results[gauge.id] = fc
    } catch (err) {
      console.warn(`[riseForecast] Background generation failed for ${gauge.id}:`, err?.message)
    } finally {
      inFlight.delete(gauge.id)
    }
  }
  return results
}

export function getPeak24h(forecast) {
  if (!forecast?.points) return null
  const now = Date.now()
  const cutoff = now + 24 * 60 * 60 * 1000
  let peak = null
  for (const p of forecast.points) {
    if (new Date(p.t).getTime() > cutoff) break
    if (!peak || p.stageFt > peak.stageFt) peak = p
  }
  return peak
}
