import { useEffect, useMemo, useRef, useState } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import { useRainViewerFrames } from '../lib/radarLayers.js'
import './AnimatedRadarLayer.css'

/**
 * Animated NEXRAD radar overlay using RainViewer tiles.
 *
 * Drop into a <MapContainer>:
 *   <AnimatedRadarLayer opacity={0.6} />
 *
 * Renders the active frame as a normal Leaflet TileLayer plus a UI
 * pane with play/pause and a frame slider. The slider is positioned
 * with leaflet-control-style absolute positioning so it overlays the
 * map without breaking the tile layer.
 *
 * Two adjacent <TileLayer>s are mounted (active + preload-next) to
 * avoid flicker on frame change — the next frame is decoded in the
 * background while the previous one is still painted.
 */
export default function AnimatedRadarLayer({
  opacity = 0.6,
  intervalMs = 500,
  includeNowcast = true,
  showControls = true,
  controlPosition = 'bottomleft'
}) {
  const map = useMap()
  const [playing, setPlaying] = useState(true)
  const {
    frames,
    index,
    setIndex,
    loading,
    error
  } = useRainViewerFrames({
    intervalMs,
    includeNowcast,
    playing
  })

  const current = frames[index] || null
  const nextIdx = frames.length > 0 ? (index + 1) % frames.length : 0
  const next = frames[nextIdx] || null

  // Preload the next frame's tiles without disrupting the visible layer.
  // We mount it at opacity 0 so Leaflet/browsers fetch+decode tiles.
  const preloadKey = next?.url || 'none'

  // Disable map drag during slider drag for better mobile UX.
  const sliderInteracting = useRef(false)
  const onSliderDown = () => {
    sliderInteracting.current = true
    map?.dragging?.disable()
  }
  const onSliderUp = () => {
    sliderInteracting.current = false
    map?.dragging?.enable()
  }

  useEffect(() => {
    return () => {
      // Always re-enable dragging on unmount.
      map?.dragging?.enable()
    }
  }, [map])

  const formattedTime = useMemo(() => {
    if (!current) return ''
    const d = new Date(current.time * 1000)
    return d.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      month: 'short',
      day: 'numeric'
    })
  }, [current])

  return (
    <>
      {current?.url ? (
        <TileLayer
          key={current.url}
          url={current.url}
          opacity={opacity}
          attribution='Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
          zIndex={400}
        />
      ) : null}

      {/* Invisible preload layer to prefetch next frame tiles */}
      {next?.url && next.url !== current?.url ? (
        <TileLayer
          key={`preload-${preloadKey}`}
          url={next.url}
          opacity={0}
          zIndex={399}
        />
      ) : null}

      {showControls ? (
        <div
          className={`radar-controls radar-controls--${controlPosition}`}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="radar-controls__btn"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause radar' : 'Play radar'}
            disabled={loading || frames.length < 2}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            className="radar-controls__slider"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={index}
            disabled={frames.length < 2}
            onChange={(e) => setIndex(Number(e.target.value))}
            onMouseDown={onSliderDown}
            onMouseUp={onSliderUp}
            onTouchStart={onSliderDown}
            onTouchEnd={onSliderUp}
            aria-label="Radar frame"
          />
          <span className="radar-controls__time">
            {error ? 'Radar offline' : loading ? 'Loading…' : formattedTime}
            {current?.kind === 'nowcast' ? (
              <span className="radar-controls__nowcast"> · forecast</span>
            ) : null}
          </span>
        </div>
      ) : null}
    </>
  )
}

export { AnimatedRadarLayer }
