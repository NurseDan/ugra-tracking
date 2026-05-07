import assert from 'node:assert/strict'
import { floodCategory, getPeak24h } from './riseForecast.js'

// ── floodCategory ───────────────────────────────────────────────────────────

// No flood stage defined → always 'Unknown'
assert.equal(floodCategory(20, null), 'Unknown')
assert.equal(floodCategory(20, undefined), 'Unknown')
assert.equal(floodCategory(0, null), 'Unknown')

// With floodStageFt = 10:
// Major Flood: stageFt >= floodStageFt * 1.5 = 15
assert.equal(floodCategory(15, 10), 'Major Flood', 'at exact major boundary')
assert.equal(floodCategory(20, 10), 'Major Flood', 'above major')
assert.equal(floodCategory(14.9, 10), 'Moderate Flood', 'just below major boundary')

// Moderate Flood: stageFt >= floodStageFt * 1.2 = 12
assert.equal(floodCategory(12, 10), 'Moderate Flood', 'at exact moderate boundary')
assert.equal(floodCategory(13, 10), 'Moderate Flood', 'within moderate range')
assert.equal(floodCategory(11.9, 10), 'Minor Flood', 'just below moderate boundary')

// Minor Flood: stageFt >= floodStageFt = 10
assert.equal(floodCategory(10, 10), 'Minor Flood', 'at exact flood stage')
assert.equal(floodCategory(11, 10), 'Minor Flood', 'within minor range')
assert.equal(floodCategory(9.9, 10), 'Action Stage', 'just below flood stage')

// Action Stage: stageFt >= floodStageFt - 2 = 8
assert.equal(floodCategory(8, 10), 'Action Stage', 'at exact action boundary')
assert.equal(floodCategory(9, 10), 'Action Stage', 'within action range')
assert.equal(floodCategory(7.9, 10), 'Normal', 'just below action stage')

// Normal: below action stage
assert.equal(floodCategory(5, 10), 'Normal')
assert.equal(floodCategory(0, 10), 'Normal')

// Boundary at a different flood stage (floodStageFt = 20)
assert.equal(floodCategory(30, 20), 'Major Flood')    // 30 >= 20*1.5=30
assert.equal(floodCategory(29.9, 20), 'Moderate Flood')
assert.equal(floodCategory(24, 20), 'Moderate Flood') // 24 >= 20*1.2=24
assert.equal(floodCategory(23.9, 20), 'Minor Flood')
assert.equal(floodCategory(20, 20), 'Minor Flood')
assert.equal(floodCategory(19.9, 20), 'Action Stage')
assert.equal(floodCategory(18, 20), 'Action Stage')   // 18 >= 20-2=18
assert.equal(floodCategory(17.9, 20), 'Normal')

// ── getPeak24h ──────────────────────────────────────────────────────────────

// Null / missing input → null
assert.equal(getPeak24h(null), null)
assert.equal(getPeak24h(undefined), null)
assert.equal(getPeak24h({}), null)
assert.equal(getPeak24h({ points: null }), null)
assert.equal(getPeak24h({ points: [] }), null)

// All points within 24h window — returns the highest stageFt point
{
  const now = Date.now()
  const points = [
    { t: new Date(now + 1 * 3600_000).toISOString(), stageFt: 5 },
    { t: new Date(now + 4 * 3600_000).toISOString(), stageFt: 8 },
    { t: new Date(now + 8 * 3600_000).toISOString(), stageFt: 6 }
  ]
  const peak = getPeak24h({ points })
  assert.ok(peak, 'should find a peak')
  assert.equal(peak.stageFt, 8, 'should return the highest point')
}

// Point past the 24h cutoff is excluded (function breaks at first point exceeding cutoff)
{
  const now = Date.now()
  const points = [
    { t: new Date(now + 2 * 3600_000).toISOString(), stageFt: 5 },
    { t: new Date(now + 12 * 3600_000).toISOString(), stageFt: 7 },
    { t: new Date(now + 25 * 3600_000).toISOString(), stageFt: 50 }
  ]
  const peak = getPeak24h({ points })
  assert.ok(peak)
  assert.equal(peak.stageFt, 7, 'should not consider point past 24h cutoff')
}

// All points past 24h cutoff → null
{
  const now = Date.now()
  const points = [
    { t: new Date(now + 25 * 3600_000).toISOString(), stageFt: 10 },
    { t: new Date(now + 48 * 3600_000).toISOString(), stageFt: 15 }
  ]
  assert.equal(getPeak24h({ points }), null, 'all points outside 24h window')
}

// Single point within 24h → returned as peak
{
  const now = Date.now()
  const points = [
    { t: new Date(now + 3 * 3600_000).toISOString(), stageFt: 12.5 }
  ]
  const peak = getPeak24h({ points })
  assert.ok(peak)
  assert.equal(peak.stageFt, 12.5)
}

console.log('riseForecast: all tests passed')
