import { WMSTileLayer } from 'react-leaflet'
import { NEXRAD_WMS_URL, NEXRAD_LAYER } from '../lib/radarLayers.js'

/**
 * Static NEXRAD radar overlay using NOAA IEM WMS.
 *
 * Drop into a <MapContainer>:
 *   <NexradRadarLayer opacity={0.6} />
 *
 * Renders the active composite radar frame.
 */
export default function NexradRadarLayer({
  opacity = 0.6,
  zIndex = 400
}) {
  return (
    <WMSTileLayer
      url={NEXRAD_WMS_URL}
      layers={NEXRAD_LAYER}
      format="image/png"
      transparent={true}
      opacity={opacity}
      zIndex={zIndex}
      attribution='Radar &copy; NOAA / Iowa Environmental Mesonet'
    />
  )
}
