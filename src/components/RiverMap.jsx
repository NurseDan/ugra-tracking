import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import { GAUGES } from '../config/gauges'
import { alertColor } from '../lib/alertColors'
import AnimatedRadarLayer from './AnimatedRadarLayer'
import MrmsQpeLayer, { MrmsQpeLegend } from './MrmsQpeLayer'
import MapLayerControls, { useMapLayerPrefs } from './MapLayerControls'
import L from 'leaflet'

const getArrow = (rate) => {
  if (rate > 0.1) return '↑'
  if (rate < -0.1) return '↓'
  return '—'
}

const GUADALUPE_STEM_ORDERS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])

function BoundsController() {
  const map = useMap()
  useEffect(() => {
    const coords = GAUGES.map(g => [g.lat, g.lng])
    if (coords.length > 0) {
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] })
    }
  }, [map])
  return null
}

export default function RiverMap({ gauges }) {
  const sorted = [...GAUGES].sort((a, b) => a.order - b.order)
  const navigate = useNavigate()
  const prefs = useMapLayerPrefs()

  const guadalupeStem = sorted
    .filter(g => GUADALUPE_STEM_ORDERS.has(g.order))
    .map(g => [g.lat, g.lng])

  return (
    <MapContainer center={[29.9, -99.1]} zoom={8} style={{ height: 480, width: '100%', zIndex: 0 }}>
      <BoundsController />

      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
      />

      {prefs.radar && <AnimatedRadarLayer opacity={0.6} />}
      {prefs.qpe && <MrmsQpeLayer window={prefs.qpeWindow} opacity={0.55} />}

      <Polyline positions={guadalupeStem} pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.8 }} />

      {sorted.map(g => {
        const d = gauges[g.id]
        const color = alertColor(d?.alert)
        const rate = d?.rates?.rise60m || 0
        const arrow = getArrow(rate)

        const iconHtml = `<div style="background-color: ${color}; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px; border: 2px solid white; box-shadow: 0 0 10px ${color}; cursor: pointer;">${arrow}</div>`
        const customIcon = new L.DivIcon({
          html: iconHtml,
          className: 'custom-gauge-icon',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })

        return (
          <Marker
            key={g.id}
            position={[g.lat, g.lng]}
            icon={customIcon}
            eventHandlers={{ click: () => navigate(`/gauge/${g.id}`) }}
          >
            <Tooltip>
              <div>
                <strong>{g.shortName}</strong>
                <div>Level: {d?.height ?? '—'} ft</div>
                <div>Flow: {d?.flow ?? '—'} cfs</div>
                <div>1hr Trend: {rate > 0 ? '+' : ''}{rate.toFixed(2)} ft</div>
                <div>Alert: {d?.alert ?? '—'}</div>
                <div style={{ marginTop: 8, color: '#60a5fa', fontWeight: 'bold' }}>Click for Details</div>
              </div>
            </Tooltip>
          </Marker>
        )
      })}

      <MapLayerControls prefs={prefs} position="topright" />
      {prefs.qpe && <MrmsQpeLegend window={prefs.qpeWindow} position="bottomright" />}
    </MapContainer>
  )
}
