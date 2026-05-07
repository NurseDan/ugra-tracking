import assert from 'node:assert/strict'
import { fetchUSGSCurrent, fetchOpenMeteoForecast } from './sources.js'

// ── fetchUSGSCurrent ────────────────────────────────────────────────────────

// Parses stage and flow series from a realistic USGS IV JSON response.
// The USGS sentinel value -999999 must be filtered by the num() floor guard.
{
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        value: {
          timeSeries: [
            {
              sourceInfo: { siteCode: [{ value: '08165500' }] },
              variable: { variableCode: [{ value: '00065' }] },
              values: [{
                value: [
                  { dateTime: '2024-01-01T00:00:00.000', value: '5.2' },
                  { dateTime: '2024-01-01T01:00:00.000', value: '5.5' },
                  { dateTime: '2024-01-01T02:00:00.000', value: '-999999' }
                ]
              }]
            },
            {
              sourceInfo: { siteCode: [{ value: '08165500' }] },
              variable: { variableCode: [{ value: '00060' }] },
              values: [{
                value: [
                  { dateTime: '2024-01-01T00:30:00.000', value: '120' }
                ]
              }]
            }
          ]
        }
      }
    }
  })
  try {
    const result = await fetchUSGSCurrent(['08165500'])
    assert.ok(result['08165500'], 'should have entry for site')
    assert.equal(result['08165500'].height, 5.5, 'latest valid stage reading')
    assert.equal(result['08165500'].flow, 120, 'flow reading')
    assert.equal(result['08165500'].history.length, 2, 'USGS sentinel -999999 should be filtered')
    assert.equal(result['08165500'].history[0].height, 5.2)
    assert.equal(result['08165500'].history[1].height, 5.5)
    assert.equal(result['08165500'].flowHistory.length, 1)
    assert.equal(result['08165500'].flowHistory[0].flow, 120)
    // time field is the latest of heightTime and flowTime
    assert.equal(result['08165500'].time, '2024-01-01T01:00:00.000', 'time should be the latest timestamp')
  } finally {
    globalThis.fetch = origFetch
  }
}

// Deduplication: same site ID listed twice yields one entry
{
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        value: {
          timeSeries: [{
            sourceInfo: { siteCode: [{ value: '08165500' }] },
            variable: { variableCode: [{ value: '00065' }] },
            values: [{ value: [{ dateTime: '2024-01-01T00:00:00.000', value: '5.0' }] }]
          }]
        }
      }
    }
  })
  try {
    // Dedup happens at the Set level inside fetchUSGSCurrent
    const fetchCalls = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url) => { fetchCalls.push(url); return realFetch(url) }
    await fetchUSGSCurrent(['08165500', '08165500', '08165500'])
    assert.equal(fetchCalls.length, 1, 'duplicate site IDs should be deduped into a single fetch')
  } finally {
    globalThis.fetch = origFetch
  }
}

// Non-ok HTTP response → returns empty result without throwing
{
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 503 })
  try {
    const result = await fetchUSGSCurrent(['08165500'])
    assert.deepEqual(result, {}, 'non-ok response should yield empty result')
  } finally {
    globalThis.fetch = origFetch
  }
}

// Network error → returns empty result without throwing
{
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network failure') }
  try {
    const result = await fetchUSGSCurrent(['08165500'])
    assert.deepEqual(result, {}, 'network error should yield empty result')
  } finally {
    globalThis.fetch = origFetch
  }
}

// Empty siteIds array → no fetch calls, empty result
{
  const origFetch = globalThis.fetch
  let fetchCalled = false
  globalThis.fetch = async () => { fetchCalled = true }
  try {
    const result = await fetchUSGSCurrent([])
    assert.deepEqual(result, {})
    assert.equal(fetchCalled, false)
  } finally {
    globalThis.fetch = origFetch
  }
}

// Values with no numeric content → site not included
{
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        value: {
          timeSeries: [{
            sourceInfo: { siteCode: [{ value: '08165500' }] },
            variable: { variableCode: [{ value: '00065' }] },
            values: [{ value: [] }]
          }]
        }
      }
    }
  })
  try {
    const result = await fetchUSGSCurrent(['08165500'])
    assert.equal(result['08165500'], undefined, 'site with no values should not appear in result')
  } finally {
    globalThis.fetch = origFetch
  }
}

// ── fetchOpenMeteoForecast ──────────────────────────────────────────────────

// Verifies mm-to-inches conversion and time-window bucketing.
// All times are constructed relative to "now" with wide margins to avoid flakiness.
{
  const origFetch = globalThis.fetch
  const now = new Date()

  // past12h: within the past-24h window
  const past12h = new Date(now - 12 * 3600_000).toISOString().slice(0, 16)
  // future12h: within both next-24h and next-72h windows
  const future12h = new Date(now.getTime() + 12 * 3600_000).toISOString().slice(0, 16)
  // future80h: beyond the 72h window — must be excluded
  const future80h = new Date(now.getTime() + 80 * 3600_000).toISOString().slice(0, 16)

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        hourly: {
          time: [past12h, future12h, future80h],
          // 25.4 mm = exactly 1 inch (0.0393701 * 25.4 ≈ 1.000)
          precipitation: [25.4, 25.4, 25.4],
          precipitation_probability: [0, 80, 60]
        }
      }
    }
  })
  try {
    const result = await fetchOpenMeteoForecast(30.0, -99.0)

    // past24hInches should include the past-12h entry (~1 inch)
    assert.ok(result.past24hInches > 0.99 && result.past24hInches < 1.01,
      `past24hInches should be ~1 inch, got ${result.past24hInches}`)

    // hourly72 should include only the future-12h entry (future-80h is out of range)
    assert.equal(result.hourly72.length, 1, 'hourly72 should exclude points beyond 72h')
    assert.ok(result.hourly72[0].inches > 0.99 && result.hourly72[0].inches < 1.01,
      `hourly72 inches should be ~1, got ${result.hourly72[0].inches}`)
    assert.equal(result.hourly72[0].probability, 80)

    // hourly (= next 24h) should also have the future-12h entry
    assert.equal(result.hourly.length, 1, 'hourly (next 24h) should include future-12h point')
    assert.ok(result.hourly[0].inches > 0.99 && result.hourly[0].inches < 1.01)

    // Aggregated 24h stats
    assert.ok(result.totalInches > 0.99 && result.totalInches < 1.01,
      `totalInches should be ~1, got ${result.totalInches}`)
    assert.equal(result.hoursWithRain, 1)
    assert.equal(result.maxProbability, 80)
  } finally {
    globalThis.fetch = origFetch
  }
}

// Non-ok response → throws
{
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 429 })
  try {
    await assert.rejects(
      fetchOpenMeteoForecast(30.0, -99.0),
      /open-meteo 429/
    )
  } finally {
    globalThis.fetch = origFetch
  }
}

console.log('sources: all tests passed')
