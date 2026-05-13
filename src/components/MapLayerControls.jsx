import { useCallback, useEffect, useState } from 'react'
import { MRMS_WINDOWS, DEFAULT_MRMS_WINDOW } from '../lib/radarLayers.js'
import './AnimatedRadarLayer.css'

const STORAGE_KEY = 'gs:mapLayerPrefs:v1'

const DEFAULT_STATE = Object.freeze({
  radar: true,
  qpe: false,
  qpeWindow: DEFAULT_MRMS_WINDOW,
  publicSensors: true,
})

function readStored() {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_STATE,
      ...parsed,
      qpeWindow: MRMS_WINDOWS[parsed?.qpeWindow]
        ? parsed.qpeWindow
        : DEFAULT_MRMS_WINDOW
    }
  } catch {
    return DEFAULT_STATE
  }
}

function writeStored(state) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // swallow quota / privacy-mode errors
  }
}

/**
 * Hook that owns layer-control state with localStorage persistence.
 * Use this in the map parent so the controls and the actual layers
 * stay in sync.
 */
export function useMapLayerPrefs() {
  const [state, setState] = useState(readStored)

  useEffect(() => {
    writeStored(state)
  }, [state])

  const setRadar = useCallback(
    (v) => setState((s) => ({ ...s, radar: !!v })),
    []
  )
  const setQpe = useCallback(
    (v) => setState((s) => ({ ...s, qpe: !!v })),
    []
  )
  const setQpeWindow = useCallback(
    (w) => setState((s) =>
      MRMS_WINDOWS[w] ? { ...s, qpeWindow: w } : s
    ),
    []
  )
  const setPublicSensors = useCallback(
    (v) => setState((s) => ({ ...s, publicSensors: !!v })),
    []
  )

  return { ...state, setRadar, setQpe, setQpeWindow, setPublicSensors }
}

/**
 * Compact toggle panel rendered inside a Leaflet <MapContainer>.
 * If `prefs` is omitted, the component owns its own state via the
 * hook (also persisted to localStorage).
 */
export default function MapLayerControls({
  prefs,
  position = 'topright',
  className = ''
}) {
  const own = useMapLayerPrefs()
  const p = prefs || own

  const windowKeys = Object.keys(MRMS_WINDOWS)

  return (
    <div
      className={`map-layer-controls map-layer-controls--${position} ${className}`.trim()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="map-layer-controls__group">
        <span className="map-layer-controls__title">Map Layers</span>
        <label className="map-layer-controls__toggle">
          <input
            type="checkbox"
            checked={!!p.radar}
            onChange={(e) => p.setRadar(e.target.checked)}
          />
          Animated radar
        </label>
        <label className="map-layer-controls__toggle">
          <input
            type="checkbox"
            checked={!!p.qpe}
            onChange={(e) => p.setQpe(e.target.checked)}
          />
          MRMS rainfall
        </label>
        <label className="map-layer-controls__toggle">
          <input
            type="checkbox"
            checked={!!p.publicSensors}
            onChange={(e) => p.setPublicSensors(e.target.checked)}
          />
          Public sensors
        </label>
      </div>

      {p.qpe ? (
        <div className="map-layer-controls__group">
          <span className="map-layer-controls__title">Accumulation</span>
          <div className="map-layer-controls__windows">
            {windowKeys.map((k) => (
              <button
                type="button"
                key={k}
                className={`map-layer-controls__chip ${
                  p.qpeWindow === k ? 'map-layer-controls__chip--active' : ''
                }`}
                onClick={() => p.setQpeWindow(k)}
                aria-pressed={p.qpeWindow === k}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { MapLayerControls }
