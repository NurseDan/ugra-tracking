import assert from 'node:assert/strict'
import { detectSurges, getDownstreamRisk } from './surgeEngine.js'

// ── detectSurges ────────────────────────────────────────────────────────────

// No gauge data → no events
{
  const events = detectSurges({})
  assert.equal(events.length, 0)
}

// Gauge with no data → skipped
{
  const events = detectSurges({ '08165300': null })
  assert.equal(events.length, 0)
}

// Fast rise5m (≥0.5 ft) triggers a surge event pointing to the next-in-order gauge
{
  const events = detectSurges({
    '08165300': { alert: 'ORANGE', rates: { rise5m: 0.5, rise15m: 0, rise60m: 0 } }
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].sourceGaugeId, '08165300')
  // Next in sort order after 08165300 (order 1) is 08165500 (order 2)
  assert.equal(events[0].downstreamGaugeId, '08165500')
  assert.ok(typeof events[0].message === 'string')
  assert.ok(typeof events[0].createdAt === 'string')
}

// Fast rise15m (≥1 ft) also triggers
{
  const events = detectSurges({
    '08165500': { alert: 'YELLOW', rates: { rise5m: 0, rise15m: 1, rise60m: 0 } }
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].sourceGaugeId, '08165500')
}

// High alert priority (ORANGE = priority 2) triggers even with zero rates
{
  const events = detectSurges({
    '08165500': { alert: 'ORANGE', rates: { rise5m: 0, rise15m: 0, rise60m: 0 } }
  })
  assert.equal(events.length, 1)
}

// RED (priority 3) also triggers
{
  const events = detectSurges({
    '08165500': { alert: 'RED', rates: { rise5m: 0, rise15m: 0, rise60m: 0 } }
  })
  assert.equal(events.length, 1)
}

// BLACK (priority 4) triggers
{
  const events = detectSurges({
    '08165500': { alert: 'BLACK', rates: { rise5m: 0, rise15m: 0, rise60m: 0 } }
  })
  assert.equal(events.length, 1)
}

// YELLOW (priority 1) with rates all below threshold → no surge
{
  const events = detectSurges({
    '08165500': { alert: 'YELLOW', rates: { rise5m: 0, rise15m: 0.9, rise60m: 0 } }
  })
  assert.equal(events.length, 0)
}

// GREEN with low rates → no surge
{
  const events = detectSurges({
    '08165300': { alert: 'GREEN', rates: { rise5m: 0.1, rise15m: 0.5, rise60m: 1 } }
  })
  assert.equal(events.length, 0)
}

// Last gauge in sorted order (08189500, order 32) — no downstream index → no event
{
  const events = detectSurges({
    '08189500': { alert: 'BLACK', rates: { rise5m: 5, rise15m: 10, rise60m: 20 } }
  })
  assert.equal(events.length, 0, 'last gauge has no next-in-order downstream')
}

// Multiple gauges fast rising → multiple events
{
  const events = detectSurges({
    '08165300': { alert: 'ORANGE', rates: { rise5m: 0.5, rise15m: 0, rise60m: 0 } },
    '08165500': { alert: 'RED', rates: { rise5m: 0, rise15m: 0, rise60m: 0 } }
  })
  assert.equal(events.length, 2)
}

// Surge event shape
{
  const [evt] = detectSurges({
    '08165300': { alert: 'RED', rates: { rise5m: 1, rise15m: 0, rise60m: 0 } }
  })
  assert.ok('sourceGaugeId' in evt)
  assert.ok('sourceName' in evt)
  assert.ok('downstreamGaugeId' in evt)
  assert.ok('downstreamName' in evt)
  assert.ok('alert' in evt)
  assert.ok('message' in evt)
  assert.ok('createdAt' in evt)
  assert.equal(evt.alert, 'RED')
}

// ── getDownstreamRisk ───────────────────────────────────────────────────────

const mockEvents = [
  {
    sourceGaugeId: '08165300',
    downstreamGaugeId: '08165500',
    alert: 'ORANGE',
    message: 'Upstream surge at North Fork. Watch Hunt next.'
  }
]

// Gauge that IS a downstream target
const risk = getDownstreamRisk('08165500', mockEvents)
assert.ok(risk, 'should find risk for downstream gauge')
assert.equal(risk.sourceGaugeId, '08165300')

// Source gauge — not a downstream target
assert.equal(getDownstreamRisk('08165300', mockEvents), undefined)

// Unrelated gauge
assert.equal(getDownstreamRisk('08167000', mockEvents), undefined)

// Empty event list
assert.equal(getDownstreamRisk('08165500', []), undefined)

console.log('surgeEngine: all tests passed')
