import { ALERT_LEVELS } from './alertEngine'

const DEFAULT_MODEL = 'gpt-4o-mini'
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export const RISK_LEVELS = ['low', 'watch', 'warning', 'critical']

const GAUGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['riskLevel', 'headline', 'summary', 'keyFactors', 'confidence'],
  properties: {
    riskLevel: { type: 'string', enum: RISK_LEVELS },
    headline: { type: 'string', maxLength: 140 },
    summary: { type: 'string' },
    keyFactors: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 6
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
}

const BASIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['riskLevel', 'headline', 'summary', 'keyFactors', 'confidence'],
  properties: {
    riskLevel: { type: 'string', enum: RISK_LEVELS },
    headline: { type: 'string', maxLength: 140 },
    summary: { type: 'string', maxLength: 320 },
    keyFactors: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
}

export const GAUGE_SYSTEM_PROMPT = `You are a hydrology briefing assistant for the Guadalupe River basin in Texas.
You write short, plain-English flood risk briefings for non-experts, based ONLY on the structured data provided.

Rules:
- NEVER invent numbers, gauges, alerts, or forecasts that are not in the input.
- If data is missing or stale, say so plainly and lower confidence.
- Use cautious language; do not give evacuation orders or contradict NWS.
- Riverine response is delayed; rainfall now -> rises hours later. Acknowledge that when rain is forecast.
- Output MUST be valid JSON matching the requested schema, no prose outside JSON.`

export const BASIN_SYSTEM_PROMPT = `You are a hydrology briefing assistant for the Guadalupe River basin in Texas.
You write a 1-2 sentence basin-wide situational summary for a dashboard header, based ONLY on the per-gauge briefings and alerts provided.

Rules:
- Mention the most elevated gauges by name when risk > low.
- Never invent gauges, numbers, or alerts not in the input.
- Keep summary <= 320 characters; headline <= 80 characters.
- Output MUST be valid JSON matching the requested schema.`

function unavailable(reason = 'AI briefing unavailable — add OPENAI_API_KEY to server secrets') {
  return {
    riskLevel: 'low',
    headline: 'AI briefing unavailable',
    summary: reason,
    keyFactors: [],
    confidence: 0,
    generatedAt: new Date().toISOString(),
    unavailable: true,
    reason
  }
}

export function createProxyProvider(options = {}) {
  const {
    endpoint = '/api/chat',
    model = DEFAULT_MODEL,
    fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  } = options

  return {
    name: 'proxy',
    hasKey: true,
    async chatJson({ system, user, schema, schemaName = 'briefing', signal }) {
      if (!fetchImpl) {
        throw new Error('No fetch implementation available')
      }
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system, user, schema, schemaName, model }),
        signal
      })
      if (res.status === 503) {
        const err = new Error('OpenAI API key not configured on server')
        err.code = 'missing_key'
        throw err
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(`Proxy request failed: ${res.status} ${text.slice(0, 200)}`)
        err.code = 'provider_error'
        err.status = res.status
        throw err
      }
      const json = await res.json()
      const content = json?.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from proxy')
      }
      try {
        return JSON.parse(content)
      } catch (e) {
        const err = new Error('Proxy returned invalid JSON')
        err.code = 'parse_error'
        err.raw = content
        throw err
      }
    }
  }
}

export function createOpenAiProvider(options = {}) {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    endpoint = OPENAI_ENDPOINT,
    fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  } = options

  return {
    name: 'openai',
    hasKey: Boolean(apiKey),
    async chatJson({ system, user, schema, schemaName = 'briefing', signal }) {
      if (!apiKey) {
        const err = new Error('Missing OpenAI API key')
        err.code = 'missing_key'
        throw err
      }
      if (!fetchImpl) {
        throw new Error('No fetch implementation available')
      }
      const body = {
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            schema,
            strict: true
          }
        }
      }
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(`OpenAI request failed: ${res.status} ${text.slice(0, 200)}`)
        err.code = 'provider_error'
        err.status = res.status
        throw err
      }
      const json = await res.json()
      const content = json?.choices?.[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from OpenAI')
      }
      try {
        return JSON.parse(content)
      } catch (e) {
        const err = new Error('OpenAI returned invalid JSON')
        err.code = 'parse_error'
        err.raw = content
        throw err
      }
    }
  }
}

let defaultProvider = null
export function getDefaultProvider() {
  if (!defaultProvider) defaultProvider = createProxyProvider()
  return defaultProvider
}
export function setDefaultProvider(provider) {
  defaultProvider = provider
}

function num(v, digits = 2) {
  return typeof v === 'number' && !Number.isNaN(v) ? Number(v.toFixed(digits)) : null
}

export function buildGaugeContext({
  gauge,
  reading,
  alerts = [],
  ahpsForecast = null,
  streamflowForecast = null,
  rainfall = null,
  upstreamReadings = []
} = {}) {
  if (!gauge) return null
  const r = reading || {}
  return {
    gauge: {
      id: gauge.id,
      name: gauge.name || gauge.shortName || gauge.id,
      shortName: gauge.shortName || gauge.name || gauge.id,
      floodStageFt: gauge.floodStageFt ?? null,
      lat: gauge.lat ?? null,
      lng: gauge.lng ?? null
    },
    current: {
      heightFt: num(r.height),
      flowCfs: num(r.flow, 0),
      observedAt: r.time || null,
      isStale: Boolean(r.isStale),
      alertLevel: r.alert || null,
      alertLabel: ALERT_LEVELS[r.alert]?.label || null,
      rates: {
        rise5m: num(r.rates?.rise5m, 2),
        rise15m: num(r.rates?.rise15m, 2),
        rise60m: num(r.rates?.rise60m, 2)
      }
    },
    nwsAlerts: (alerts || []).slice(0, 6).map((a) => ({
      event: a.event || a.headline || null,
      severity: a.severity || null,
      headline: a.headline || null,
      ends: a.ends || a.expires || null
    })),
    ahpsForecast: ahpsForecast
      ? {
          peakFt: num(ahpsForecast.peakFt ?? ahpsForecast.crestFt),
          peakAt: ahpsForecast.peakAt || ahpsForecast.crestAt || null,
          floodCategory: ahpsForecast.floodCategory || null,
          horizonHours: ahpsForecast.horizonHours ?? null
        }
      : null,
    streamflowForecast: streamflowForecast
      ? {
          peakCfs: num(streamflowForecast.peakCfs, 0),
          peakAt: streamflowForecast.peakAt || null,
          horizonHours: streamflowForecast.horizonHours ?? null,
          source: streamflowForecast.source || null
        }
      : null,
    rainfall: rainfall
      ? {
          past24hInches: num(rainfall.past24hInches),
          next24hInches: num(rainfall.next24hInches ?? rainfall.totalInches),
          maxHourlyInches: num(rainfall.maxHourlyInches),
          maxProbability: num(rainfall.maxProbability, 0)
        }
      : null,
    upstream: (upstreamReadings || []).slice(0, 4).map((u) => ({
      shortName: u.shortName || u.name || u.id,
      heightFt: num(u.height),
      alertLevel: u.alert || null,
      rise60m: num(u.rates?.rise60m)
    }))
  }
}

export function buildBasinContext(gaugeContexts = [], gaugeBriefings = {}) {
  return {
    generatedAt: new Date().toISOString(),
    gauges: gaugeContexts.filter(Boolean).map((ctx) => {
      const briefing = gaugeBriefings[ctx.gauge.id]
      return {
        id: ctx.gauge.id,
        name: ctx.gauge.shortName,
        alertLevel: ctx.current.alertLevel,
        heightFt: ctx.current.heightFt,
        floodStageFt: ctx.gauge.floodStageFt,
        rise60m: ctx.current.rates.rise60m,
        isStale: ctx.current.isStale,
        risk: briefing?.riskLevel || null,
        headline: briefing?.headline || null
      }
    })
  }
}

function compactJson(value) {
  return JSON.stringify(value, null, 2)
}

export async function generateGaugeBriefing(context, options = {}) {
  if (!context) return unavailable('No gauge context provided')
  const provider = options.provider || getDefaultProvider()
  if (!provider.hasKey) return unavailable()

  const userPrompt = `Produce a flood risk briefing for this gauge. Use only the data below.

DATA:
${compactJson(context)}

Return JSON with: riskLevel (low|watch|warning|critical), headline (<=140 chars), summary (1-3 sentences),
keyFactors (1-6 short bullet strings), confidence (0..1).`

  try {
    const result = await provider.chatJson({
      system: GAUGE_SYSTEM_PROMPT,
      user: userPrompt,
      schema: GAUGE_SCHEMA,
      schemaName: 'gauge_briefing',
      signal: options.signal
    })
    return {
      ...result,
      generatedAt: new Date().toISOString(),
      gaugeId: context.gauge?.id || null
    }
  } catch (err) {
    if (err?.code === 'missing_key') return unavailable()
    return {
      riskLevel: 'low',
      headline: 'Briefing failed',
      summary: `AI briefing could not be generated: ${err?.message || 'unknown error'}`,
      keyFactors: [],
      confidence: 0,
      generatedAt: new Date().toISOString(),
      error: err?.message || String(err)
    }
  }
}

export async function generateBasinBriefing(contextOrContexts, options = {}) {
  const provider = options.provider || getDefaultProvider()
  if (!provider.hasKey) return unavailable()

  const basinContext = Array.isArray(contextOrContexts)
    ? buildBasinContext(contextOrContexts, options.briefings || {})
    : contextOrContexts

  if (!basinContext || !basinContext.gauges?.length) {
    return unavailable('No gauge data available for basin summary')
  }

  const userPrompt = `Produce a one-paragraph basin-wide flood situational summary for the dashboard header.

DATA:
${compactJson(basinContext)}

Return JSON with: riskLevel (low|watch|warning|critical), headline (<=80 chars),
summary (<=320 chars, 1-2 sentences), keyFactors (1-5 short bullets), confidence (0..1).`

  try {
    const result = await provider.chatJson({
      system: BASIN_SYSTEM_PROMPT,
      user: userPrompt,
      schema: BASIN_SCHEMA,
      schemaName: 'basin_briefing',
      signal: options.signal
    })
    return { ...result, generatedAt: new Date().toISOString() }
  } catch (err) {
    if (err?.code === 'missing_key') return unavailable()
    return {
      riskLevel: 'low',
      headline: 'Briefing failed',
      summary: `Basin briefing could not be generated: ${err?.message || 'unknown error'}`,
      keyFactors: [],
      confidence: 0,
      generatedAt: new Date().toISOString(),
      error: err?.message || String(err)
    }
  }
}

export const __test__ = {
  GAUGE_SCHEMA,
  BASIN_SCHEMA,
  unavailable,
  OPENAI_ENDPOINT
}
