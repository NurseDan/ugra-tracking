import assert from 'node:assert/strict'
import {
  alertContainsPoint,
  alertsForGauge,
  bboxFromGauges,
  fetchActiveAlerts,
  isFloodRelevantEvent,
  normalizeAlert,
  pointInPolygon,
  sortAlertsBySeverity,
  ugcCodesForPoint
} from './nwsAlerts.js'

const ring = [
  [-99.5, 30.0],
  [-99.0, 30.0],
  [-99.0, 30.2],
  [-99.5, 30.2],
  [-99.5, 30.0]
]

assert.equal(pointInPolygon(30.1, -99.25, ring), true, 'point inside')
assert.equal(pointInPolygon(31.0, -99.25, ring), false, 'point outside')

const polyAlert = normalizeAlert({
  properties: {
    id: 'p1',
    event: 'Flash Flood Warning',
    severity: 'Severe',
    headline: 'FFW',
    areaDesc: 'Kerr',
    geocode: { UGC: [] },
    expires: new Date(Date.now() + 3600_000).toISOString()
  },
  geometry: { type: 'Polygon', coordinates: [ring] }
})

const ugcAlert = normalizeAlert({
  properties: {
    id: 'u1',
    event: 'Flood Warning',
    severity: 'Moderate',
    headline: 'FW',
    areaDesc: 'Kerr County',
    geocode: { UGC: ['TXC265'] },
    expires: new Date(Date.now() + 3600_000).toISOString()
  },
  geometry: null
})

assert.equal(alertContainsPoint(polyAlert, 30.1, -99.25), true)
assert.equal(alertContainsPoint(polyAlert, 31.0, -99.25), false)

assert.equal(alertsForGauge(30.0691, -99.3153, [polyAlert, ugcAlert]).length, 2, 'Hunt gauge matches both')
assert.equal(alertsForGauge(29.705, -98.116, [ugcAlert]).length, 0, 'Comal gauge does not match Kerr UGC')
assert.deepEqual(ugcCodesForPoint(30.0691, -99.3153), ['TXC265'])

assert.equal(isFloodRelevantEvent('Flash Flood Warning'), true)
assert.equal(isFloodRelevantEvent('Severe Thunderstorm Warning', 'heavy rainfall expected'), true)
assert.equal(isFloodRelevantEvent('Severe Thunderstorm Warning', 'wind only'), false)
assert.equal(isFloodRelevantEvent('Tornado Warning'), false)

const bbox = bboxFromGauges([{ lat: 30, lng: -99 }, { lat: 29, lng: -98 }], 0.25)
assert.deepEqual(bbox, { minLat: 28.75, maxLat: 30.25, minLng: -99.25, maxLng: -97.75 })

const sorted = sortAlertsBySeverity([ugcAlert, polyAlert])
assert.equal(sorted[0].severity, 'Severe')

const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  async json() {
    return {
      features: [
        {
          properties: {
            id: 'far-away',
            event: 'Flood Warning',
            severity: 'Severe',
            headline: 'FW for Harris County',
            areaDesc: 'Harris',
            geocode: { UGC: ['TXC201'] },
            expires: new Date(Date.now() + 3600_000).toISOString()
          },
          geometry: null
        },
        {
          properties: {
            id: 'in-area',
            event: 'Flood Warning',
            severity: 'Severe',
            headline: 'FW for Kerr County',
            areaDesc: 'Kerr',
            geocode: { UGC: ['TXC265'] },
            expires: new Date(Date.now() + 3600_000).toISOString()
          },
          geometry: null
        }
      ]
    }
  }
})
try {
  const filtered = await fetchActiveAlerts({ bbox, gaugeUgcs: ['TXC265', 'TXC259'] })
  assert.equal(filtered.length, 1, 'only in-area no-geom alert should remain')
  assert.equal(filtered[0].id, 'in-area')
} finally {
  globalThis.fetch = originalFetch
}

console.log('nwsAlerts: all tests passed')
