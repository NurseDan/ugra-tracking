import assert from 'node:assert/strict'
import { ALERT_LEVELS, calculateRates, getAlertLevel, getHighestAlert } from './alertEngine.js'

// ── ALERT_LEVELS priority order ─────────────────────────────────────────────

assert.equal(ALERT_LEVELS.GREEN.priority, 0)
assert.equal(ALERT_LEVELS.YELLOW.priority, 1)
assert.equal(ALERT_LEVELS.ORANGE.priority, 2)
assert.equal(ALERT_LEVELS.RED.priority, 3)
assert.equal(ALERT_LEVELS.BLACK.priority, 4)

// ── calculateRates ──────────────────────────────────────────────────────────

// Empty history → all zeros
{
  const rates = calculateRates([], { time: new Date().toISOString(), height: 5 })
  assert.deepEqual(rates, { rise5m: 0, rise15m: 0, rise60m: 0 })
}

// No point old enough for any window → zeros
{
  const now = Date.now()
  const history = [{ time: new Date(now - 2 * 60_000).toISOString(), height: 4.5 }]
  const current = { time: new Date(now).toISOString(), height: 5 }
  assert.deepEqual(calculateRates(history, current), { rise5m: 0, rise15m: 0, rise60m: 0 })
}

// Point ≥5m but <15m ago: only rise5m is set
{
  const now = Date.now()
  const history = [{ time: new Date(now - 7 * 60_000).toISOString(), height: 3 }]
  const current = { time: new Date(now).toISOString(), height: 5 }
  const rates = calculateRates(history, current)
  assert.equal(rates.rise5m, 2)
  assert.equal(rates.rise15m, 0)
  assert.equal(rates.rise60m, 0)
}

// Points covering all three windows (history must be oldest-first; calculateRates reverses it)
{
  const now = Date.now()
  const history = [
    { time: new Date(now - 65 * 60_000).toISOString(), height: 1 },
    { time: new Date(now - 20 * 60_000).toISOString(), height: 3 },
    { time: new Date(now - 6 * 60_000).toISOString(), height: 4 }
  ]
  const current = { time: new Date(now).toISOString(), height: 5 }
  const rates = calculateRates(history, current)
  assert.equal(rates.rise5m, 1)
  assert.equal(rates.rise15m, 2)
  assert.equal(rates.rise60m, 4)
}

// Non-numeric past height → zero for that window
{
  const now = Date.now()
  const history = [{ time: new Date(now - 10 * 60_000).toISOString(), height: null }]
  const current = { time: new Date(now).toISOString(), height: 5 }
  assert.equal(calculateRates(history, current).rise5m, 0)
}

// Non-numeric current height → zero
{
  const now = Date.now()
  const history = [{ time: new Date(now - 10 * 60_000).toISOString(), height: 3 }]
  const current = { time: new Date(now).toISOString(), height: null }
  assert.equal(calculateRates(history, current).rise5m, 0)
}

// ── getAlertLevel ───────────────────────────────────────────────────────────

// GREEN: all rates below thresholds
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0 }), 'GREEN')
assert.equal(getAlertLevel({ rise5m: 0.1, rise15m: 0.3, rise60m: 0.7 }), 'GREEN')

// YELLOW thresholds (each dimension independently)
assert.equal(getAlertLevel({ rise5m: 0.2, rise15m: 0, rise60m: 0 }), 'YELLOW')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0.4, rise60m: 0 }), 'YELLOW')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0.75 }), 'YELLOW')
// just below YELLOW
assert.equal(getAlertLevel({ rise5m: 0.19, rise15m: 0.39, rise60m: 0.74 }), 'GREEN')

// ORANGE thresholds
assert.equal(getAlertLevel({ rise5m: 0.5, rise15m: 0, rise60m: 0 }), 'ORANGE')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 1, rise60m: 0 }), 'ORANGE')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 2 }), 'ORANGE')

// RED thresholds
assert.equal(getAlertLevel({ rise5m: 1, rise15m: 0, rise60m: 0 }), 'RED')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 2, rise60m: 0 }), 'RED')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 4 }), 'RED')

// BLACK thresholds
assert.equal(getAlertLevel({ rise5m: 2, rise15m: 0, rise60m: 0 }), 'BLACK')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 4, rise60m: 0 }), 'BLACK')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 8 }), 'BLACK')

// Highest dimension wins
assert.equal(getAlertLevel({ rise5m: 0.49, rise15m: 1, rise60m: 0 }), 'ORANGE')
assert.equal(getAlertLevel({ rise5m: 0.1, rise15m: 0.1, rise60m: 4 }), 'RED')

// Stale + upstream priority ≥ 3 → BLACK
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0 }, { isStale: true, upstreamAlert: 'RED' }), 'BLACK')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0 }, { isStale: true, upstreamAlert: 'BLACK' }), 'BLACK')

// Stale + upstream priority < 3 → NOT forced to BLACK
assert.notEqual(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0 }, { isStale: true, upstreamAlert: 'ORANGE' }), 'BLACK')
assert.notEqual(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0 }, { isStale: true, upstreamAlert: 'GREEN' }), 'BLACK')

// Nullish / missing rates → treat as zero
assert.equal(getAlertLevel(null), 'GREEN')
assert.equal(getAlertLevel(undefined), 'GREEN')
assert.equal(getAlertLevel({}), 'GREEN')

// ── getHighestAlert ─────────────────────────────────────────────────────────

assert.equal(getHighestAlert(['GREEN']), 'GREEN')
assert.equal(getHighestAlert(['GREEN', 'YELLOW']), 'YELLOW')
assert.equal(getHighestAlert(['GREEN', 'YELLOW', 'ORANGE']), 'ORANGE')
assert.equal(getHighestAlert(['RED', 'BLACK', 'ORANGE']), 'BLACK')
assert.equal(getHighestAlert(['GREEN', 'GREEN']), 'GREEN')
assert.equal(getHighestAlert(['ORANGE', 'RED']), 'RED')
// Starts from GREEN baseline — single BLACK wins
assert.equal(getHighestAlert(['BLACK']), 'BLACK')

console.log('alertEngine (client): all tests passed')
