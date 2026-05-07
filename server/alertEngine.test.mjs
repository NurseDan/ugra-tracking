import assert from 'node:assert/strict'
import { ALERT_LEVELS, calculateRates, getAlertLevel } from './alertEngine.js'

// ── ALERT_LEVELS structure ──────────────────────────────────────────────────
// Verifies the server-side module stays in sync with the client-side version.

assert.equal(ALERT_LEVELS.GREEN.priority, 0)
assert.equal(ALERT_LEVELS.YELLOW.priority, 1)
assert.equal(ALERT_LEVELS.ORANGE.priority, 2)
assert.equal(ALERT_LEVELS.RED.priority, 3)
assert.equal(ALERT_LEVELS.BLACK.priority, 4)

for (const level of ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'BLACK']) {
  assert.ok(typeof ALERT_LEVELS[level].label === 'string', `${level} should have a label`)
}

// ── calculateRates (parity with client module) ──────────────────────────────

// Empty history → zeros
assert.deepEqual(
  calculateRates([], { time: new Date().toISOString(), height: 5 }),
  { rise5m: 0, rise15m: 0, rise60m: 0 }
)

// Missing current.time → zeros (server version guards for this)
assert.deepEqual(
  calculateRates([{ time: new Date().toISOString(), height: 3 }], { height: 5 }),
  { rise5m: 0, rise15m: 0, rise60m: 0 }
)

// All three windows computed correctly (history must be oldest-first; calculateRates reverses it)
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

// Non-numeric heights return zero
{
  const now = Date.now()
  const history = [{ time: new Date(now - 10 * 60_000).toISOString(), height: 'n/a' }]
  const current = { time: new Date(now).toISOString(), height: 5 }
  assert.equal(calculateRates(history, current).rise5m, 0)
}

// ── getAlertLevel (parity with client module) ───────────────────────────────

assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0 }), 'GREEN')
assert.equal(getAlertLevel({ rise5m: 0.2, rise15m: 0, rise60m: 0 }), 'YELLOW')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0.4, rise60m: 0 }), 'YELLOW')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 0.75 }), 'YELLOW')
assert.equal(getAlertLevel({ rise5m: 0.5, rise15m: 0, rise60m: 0 }), 'ORANGE')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 1, rise60m: 0 }), 'ORANGE')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 2 }), 'ORANGE')
assert.equal(getAlertLevel({ rise5m: 1, rise15m: 0, rise60m: 0 }), 'RED')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 2, rise60m: 0 }), 'RED')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 4 }), 'RED')
assert.equal(getAlertLevel({ rise5m: 2, rise15m: 0, rise60m: 0 }), 'BLACK')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 4, rise60m: 0 }), 'BLACK')
assert.equal(getAlertLevel({ rise5m: 0, rise15m: 0, rise60m: 8 }), 'BLACK')

// Stale + upstream RED or BLACK → BLACK
assert.equal(getAlertLevel({}, { isStale: true, upstreamAlert: 'RED' }), 'BLACK')
assert.equal(getAlertLevel({}, { isStale: true, upstreamAlert: 'BLACK' }), 'BLACK')

// Stale + upstream ORANGE (priority 2, threshold is ≥3) → NOT BLACK
assert.notEqual(getAlertLevel({}, { isStale: true, upstreamAlert: 'ORANGE' }), 'BLACK')

// Null / undefined rates → GREEN
assert.equal(getAlertLevel(null), 'GREEN')
assert.equal(getAlertLevel(undefined), 'GREEN')
assert.equal(getAlertLevel({}), 'GREEN')

console.log('alertEngine (server): all tests passed')
