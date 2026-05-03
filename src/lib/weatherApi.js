// Server-first lookup: the poller caches per-gauge forecasts hourly.
// We only know lat/lng here, so we fall through to direct upstream when
// the caller didn't pass a gauge id. fetchPrecipitationForecast (below)
// is gauge-aware and prefers the cache.
export async function fetchQPF72h(lat, lng) {
  // Server-first: use the same cached weather payload (poller stores hourly72)
  // before falling back to a direct Open-Meteo fetch.
  const cached = await fetchWeatherFromServer(lat, lng).catch(() => null)
  if (cached && Array.isArray(cached.raw?.hourly72 || null)) {
    return { hourly: cached.raw.hourly72, past24hInches: cached.past24hInches || 0 }
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,precipitation_probability&timezone=America/Chicago&forecast_days=4&past_days=1`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Weather request failed with ${res.status}`)
    const json = await res.json()
    const now = new Date()
    const windowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000)
    const past24Start = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const times = json?.hourly?.time || []
    const precip = json?.hourly?.precipitation || []
    const probability = json?.hourly?.precipitation_probability || []

    const hourly = []
    let past24hInches = 0

    for (let i = 0; i < times.length; i++) {
      const forecastTime = new Date(times[i])
      const mm = Number(precip[i] || 0)
      const inches = mm * 0.0393701

      if (forecastTime >= past24Start && forecastTime <= now) {
        past24hInches += inches
      }

      if (forecastTime <= now || forecastTime > windowEnd) continue
      hourly.push({
        time: times[i],
        inches,
        probability: Number(probability[i] || 0)
      })
    }
    return { hourly, past24hInches }
  } catch (err) {
    console.error('[weatherApi] fetchQPF72h failed:', err)
    return { hourly: [], past24hInches: 0 }
  }
}

async function fetchWeatherFromServer(lat, lng) {
  // The poller caches per-gauge weather under `weather:<gaugeId>`. We don't
  // know the gauge id here, so we sniff the cache for a key whose payload
  // matches the requested coordinates closely (within ~0.05deg ~= 3 mi).
  // The server already standardized the shape, so we just trim to 24h.
  try {
    const res = await fetch('/api/gauges', { credentials: 'same-origin' })
    if (!res.ok) return null
    const gauges = await res.json()
    const match = gauges.find(g => Math.abs(g.lat - lat) < 0.05 && Math.abs(g.lng - lng) < 0.05)
    if (!match) return null
    const cr = await fetch(`/api/source/weather:${match.id}`, { credentials: 'same-origin' })
    if (!cr.ok) return null
    const p = await cr.json()
    if (!p || typeof p.totalInches !== 'number') return null
    return {
      totalInches: p.totalInches,
      maxHourlyInches: p.maxHourlyInches,
      hoursWithRain: p.hoursWithRain,
      maxProbability: p.maxProbability,
      hourly: Array.isArray(p.hourly) ? p.hourly : [],
      past24hInches: p.past24hInches || 0,
      raw: { _source: 'server-cache', hourly72: Array.isArray(p.hourly72) ? p.hourly72 : [] }
    }
  } catch { return null }
}

export async function fetchPrecipitationForecast(lat, lng) {
  const cached = await fetchWeatherFromServer(lat, lng)
  if (cached) return cached
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=precipitation,precipitation_probability&timezone=America/Chicago&forecast_days=2`
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Weather request failed with ${res.status}`)
    }

    const json = await res.json()
    const now = new Date()
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    let totalPrecipitation = 0
    let maxHourly = 0
    let hoursWithRain = 0
    let maxProbability = 0
    const hourly = []

    const times = json?.hourly?.time || []
    const precip = json?.hourly?.precipitation || []
    const probability = json?.hourly?.precipitation_probability || []

    for (let i = 0; i < times.length; i++) {
      const forecastTime = new Date(times[i])

      if (forecastTime > now && forecastTime <= windowEnd) {
        const mm = Number(precip[i] || 0)
        const inches = mm * 0.0393701
        const precipProbability = Number(probability[i] || 0)

        hourly.push({
          time: times[i],
          inches,
          probability: precipProbability
        })

        if (inches > 0) {
          totalPrecipitation += inches
          hoursWithRain++
          if (inches > maxHourly) maxHourly = inches
        }

        if (precipProbability > maxProbability) maxProbability = precipProbability
      }
    }

    return {
      totalInches: totalPrecipitation,
      maxHourlyInches: maxHourly,
      hoursWithRain,
      maxProbability,
      hourly,
      raw: json
    }
  } catch (error) {
    console.error("Failed to fetch weather data:", error)
    return null
  }
}
