// Radar + MRMS QPE tile layer sources for the river basin map.
//
// Two data sources:
//
// 1. NOAA NEXRAD Base Reflectivity via Iowa Environmental Mesonet WMS
//    - Endpoint: https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi
//    - Layer: nexrad-n0q-900913
//    - Extremely reliable, updates every ~5 mins.
//
// 2. NOAA MRMS QPE via Iowa Environmental Mesonet WMS
//    - Endpoint: https://mesonet.agron.iastate.edu/cgi-bin/wms/us/mrms.cgi
//    - Layers (verified live during build):
//        mrms_p1h   (NMQ Q3 1 Hour Precipitation)
//        mrms_p24h  (NMQ Q3 24 Hour Precipitation)
//        mrms_p48h  (NMQ Q3 48 Hour Precipitation)
//        mrms_p72h  (NMQ Q3 72 Hour Precipitation)
//    - DEVIATION FROM SPEC: spec listed `6h` as a window. IEM does NOT
//      publish a mrms_p6h layer (only 1h, 24h, 48h, 72h). The window
//      enum exposes what's actually available; the controls fall back
//      gracefully so a future agent can swap in a different MRMS
//      provider without touching call sites.

const MRMS_WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/us/mrms.cgi'
export const NEXRAD_WMS_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi'
export const NEXRAD_LAYER = 'nexrad-n0q-900913'

export const MRMS_WINDOWS = Object.freeze({
  '1h':  { layer: 'mrms_p1h',  label: '1-hr Rainfall',  hours: 1 },
  '24h': { layer: 'mrms_p24h', label: '24-hr Rainfall', hours: 24 },
  '48h': { layer: 'mrms_p48h', label: '48-hr Rainfall', hours: 48 },
  '72h': { layer: 'mrms_p72h', label: '72-hr Rainfall', hours: 72 }
})

export const DEFAULT_MRMS_WINDOW = '24h'

/**
 * Get WMS configuration for an MRMS QPE accumulation window. Returns
 * null for unknown windows so callers can render a clear empty state.
 */
export function getMrmsQpeLayer(window = DEFAULT_MRMS_WINDOW) {
  const cfg = MRMS_WINDOWS[window]
  if (!cfg) return null
  return {
    url: MRMS_WMS_URL,
    layer: cfg.layer,
    label: cfg.label,
    hours: cfg.hours,
    attribution: 'MRMS QPE &copy; Iowa Environmental Mesonet / NOAA'
  }
}

/**
 * Backwards-compat helper that returns just the WMS URL the caller
 * should hit (the WMS layer name is then provided to react-leaflet's
 * <WMSTileLayer layers="..." />). Spec referred to this as
 * `getMrmsQpeLayerUrl(window)`.
 */
export function getMrmsQpeLayerUrl(window = DEFAULT_MRMS_WINDOW) {
  const cfg = getMrmsQpeLayer(window)
  return cfg?.url || null
}

