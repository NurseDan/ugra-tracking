// Mapping from USGS site number (matches `id` in src/config/gauges.js) to
// the NWS / NWPS LID (location identifier) for the corresponding river
// forecast point.
//
// LIDs verified against api.water.noaa.gov/nwps/v1/gauges/{LID} during
// implementation. Gauges without an active NWS forecast point (most
// tributaries, reservoirs, and headwater gauges) map to null and the UI
// renders a clear empty state.
//
// NOTE: gauges.js previously stored a `noaaSlug` field with some LID
// guesses, several of which (e.g. "KRVT2" for Kerrville) were stale.
// This file is the authoritative source for AHPS lookups going forward.

export const AHPS_LIDS = Object.freeze({
  // Verified — return data from NWPS
  '08165500': 'HNTT2', // Guadalupe River at Hunt
  '08166200': 'KRRT2', // Guadalupe River at Kerrville (was incorrectly KRVT2)
  '08168500': 'NBRT2', // Guadalupe River above Comal River at New Braunfels

  // Likely-correct legacy slugs from gauges.js. The fetch layer will
  // gracefully degrade to a "no AHPS data" state if NWPS rejects them.
  '08166250': 'CNPT2', // Center Point
  '08167000': 'CMFT2', // Comfort

  // Known to have no NWS forecast point
  '08165300': null, // North Fork near Hunt (headwater)
  '08166000': null, // Johnson Creek near Ingram (tributary)
  '08166140': null, // Above Bear Creek at Kerrville
  '08167500': null, // Spring Branch
  '08167800': null, // Canyon Lake (reservoir)
  '08178800': null, // Medina at Bandera
  '08195000': null, // Frio at Concan
  '08198000': null, // Sabinal River
  '08189500': null  // Nueces at Laguna
})

export function getAhpsLidForGauge(gauge) {
  if (!gauge) return null
  const id = typeof gauge === 'string' ? gauge : gauge.id
  if (!id) return null
  if (Object.prototype.hasOwnProperty.call(AHPS_LIDS, id)) {
    return AHPS_LIDS[id]
  }
  // Fall back to legacy gauges.js noaaSlug if a new gauge is added
  // without updating this file.
  if (typeof gauge === 'object' && gauge.noaaSlug) return gauge.noaaSlug
  return null
}
