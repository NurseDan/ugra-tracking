import { WMSTileLayer } from 'react-leaflet'
import { getMrmsQpeLayer, DEFAULT_MRMS_WINDOW } from '../lib/radarLayers.js'
import './AnimatedRadarLayer.css'

const SCALE_TICKS = ['0', '0.25', '1', '2', '4', '6', '8+']

/**
 * NOAA MRMS Quantitative Precipitation Estimate overlay (1h / 24h /
 * 48h / 72h windows). Renders nothing if the window isn't recognized.
 *
 * Pair with <MrmsQpeLegend /> to show the color scale.
 */
export default function MrmsQpeLayer({
  window = DEFAULT_MRMS_WINDOW,
  opacity = 0.55,
  zIndex = 350
}) {
  const cfg = getMrmsQpeLayer(window)
  if (!cfg) return null

  return (
    <WMSTileLayer
      key={cfg.layer}
      url={cfg.url}
      layers={cfg.layer}
      format="image/png"
      transparent={true}
      opacity={opacity}
      zIndex={zIndex}
      attribution={cfg.attribution}
    />
  )
}

export function MrmsQpeLegend({
  window = DEFAULT_MRMS_WINDOW,
  position = 'bottomright',
  className = ''
}) {
  const cfg = getMrmsQpeLayer(window)
  if (!cfg) return null

  return (
    <div
      className={`mrms-legend mrms-legend--${position} ${className}`.trim()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="mrms-legend__title">{cfg.label} (in)</div>
      <div className="mrms-legend__bar" aria-hidden="true" />
      <div className="mrms-legend__scale">
        {SCALE_TICKS.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  )
}

export { MrmsQpeLayer }
