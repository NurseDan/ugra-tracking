import assert from 'node:assert/strict'
import { formatCDT } from './formatTime.js'

// Falsy inputs → em dash
assert.equal(formatCDT(null), '—')
assert.equal(formatCDT(undefined), '—')
assert.equal(formatCDT(''), '—')

// Known UTC timestamp in CDT (UTC-5 during DST): 2024-07-04T18:00:00Z = 1:00 PM CDT
const summerResult = formatCDT('2024-07-04T18:00:00.000Z')
assert.ok(typeof summerResult === 'string', 'should return a string')
assert.ok(summerResult.includes('Jul'), `expected "Jul" in "${summerResult}"`)
assert.ok(summerResult.includes('4'), `expected day "4" in "${summerResult}"`)
assert.ok(summerResult.includes('1:00'), `expected "1:00" in "${summerResult}"`)
assert.ok(
  summerResult.includes('CDT') || summerResult.includes('CT'),
  `expected timezone label in "${summerResult}"`
)

// Winter CST (UTC-6): 2024-01-15T12:00:00Z = 6:00 AM CST
const winterResult = formatCDT('2024-01-15T12:00:00.000Z')
assert.ok(typeof winterResult === 'string')
assert.ok(winterResult.includes('Jan'), `expected "Jan" in "${winterResult}"`)
assert.ok(winterResult.includes('15'), `expected day "15" in "${winterResult}"`)
assert.ok(
  winterResult.includes('CST') || winterResult.includes('CT'),
  `expected timezone label in "${winterResult}"`
)

// Numeric timestamp (milliseconds) is also accepted by new Date()
const tsResult = formatCDT(new Date('2024-07-04T18:00:00.000Z').toISOString())
assert.ok(tsResult.includes('Jul'), 'numeric-origin ISO string should format correctly')

console.log('formatTime: all tests passed')
