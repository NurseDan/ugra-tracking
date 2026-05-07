import assert from 'node:assert/strict'
import { ALERT_COLORS, alertColor } from './alertColors.js'

// Each valid level returns its defined color
assert.equal(alertColor('GREEN'), ALERT_COLORS.GREEN)
assert.equal(alertColor('YELLOW'), ALERT_COLORS.YELLOW)
assert.equal(alertColor('ORANGE'), ALERT_COLORS.ORANGE)
assert.equal(alertColor('RED'), ALERT_COLORS.RED)
assert.equal(alertColor('BLACK'), ALERT_COLORS.BLACK)

// Unknown level falls back to GREEN
assert.equal(alertColor('PURPLE'), ALERT_COLORS.GREEN)
assert.equal(alertColor('UNKNOWN'), ALERT_COLORS.GREEN)
assert.equal(alertColor(''), ALERT_COLORS.GREEN)

// Default parameter ('GREEN') applies when called with no argument
assert.equal(alertColor(), ALERT_COLORS.GREEN)

// Spot-check actual hex values stay stable
assert.equal(ALERT_COLORS.GREEN, '#16a34a')
assert.equal(ALERT_COLORS.YELLOW, '#eab308')
assert.equal(ALERT_COLORS.ORANGE, '#f97316')
assert.equal(ALERT_COLORS.RED, '#dc2626')
assert.equal(ALERT_COLORS.BLACK, '#111827')

// All color values are valid hex strings
for (const [level, hex] of Object.entries(ALERT_COLORS)) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `ALERT_COLORS.${level} should be a 6-digit hex color`)
}

console.log('alertColors: all tests passed')
