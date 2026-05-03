// USGS site number -> NHDPlus reach ID mapping for the National Water
// Model (NWM). reachIds were verified by querying NWPS gauge metadata
// (api.water.noaa.gov/nwps/v1/gauges/{LID}) which exposes the reachId
// associated with each forecast point.
//
// Gauges without a known reachId are mapped to null. The hook will fall
// back to the Open-Meteo Flood API for those (which is parameterized by
// lat/lon, so it works for any gauge in config/gauges.js).
//
// IMPORTANT: This is a sidecar to src/config/gauges.js — that file is
// intentionally NOT mutated by this task.

export const NWM_REACHES = Object.freeze({
  '08165500': '3586192', // Guadalupe at Hunt
  '08166200': '3585724', // Guadalupe at Kerrville
  '08168500': '1620031', // Guadalupe above Comal at New Braunfels

  // No verified reachId yet — Open-Meteo will be used by lat/lon
  '08165300': null, // North Fork near Hunt
  '08166000': null, // Johnson Creek
  '08166140': null, // Above Bear Creek
  '08166250': null, // Center Point
  '08167000': null, // Comfort
  '08167500': null, // Spring Branch
  '08167800': null, // Canyon Lake (reservoir, no streamflow)
  '08178800': null, // Medina at Bandera
  '08195000': null, // Frio at Concan
  '08198000': null, // Sabinal River
  '08189500': null  // Nueces at Laguna
})

export function getNwmReachId(gaugeOrId) {
  if (!gaugeOrId) return null
  const id = typeof gaugeOrId === 'string' ? gaugeOrId : gaugeOrId.id
  if (!id) return null
  return NWM_REACHES[id] || null
}
