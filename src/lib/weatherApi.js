export async function fetchPrecipitationForecast(lat, lng) {
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
