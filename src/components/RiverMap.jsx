import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip, useMap } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import { GAUGES } from '../config/gauges'
import { PUBLIC_SENSORS, SENSOR_KIND_STYLE } from '../config/publicSensors'
import { alertColor } from '../lib/alertColors'
import AnimatedRadarLayer from './AnimatedRadarLayer'
import MrmsQpeLayer, { MrmsQpeLegend } from './MrmsQpeLayer'
import MapLayerControls, { useMapLayerPrefs } from './MapLayerControls'
import L from 'leaflet'

const PRIMARY_GAUGE_IDS = new Set(GAUGES.map(g => g.id))
// Skip any public sensor whose id duplicates a primary gauge (e.g. the
// USGS streamgage we already track via GAUGES.id === '08168500').
const VISIBLE_PUBLIC_SENSORS = PUBLIC_SENSORS.filter(
  s => !PRIMARY_GAUGE_IDS.has(s.id.replace(/^usgs:/, ''))
)

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

      {prefs.publicSensors && VISIBLE_PUBLIC_SENSORS.map(s => {
        const style = SENSOR_KIND_STYLE[s.kind] || { color: '#94a3b8', emoji: '·', label: s.kind }
        const html = `<div style="background:${style.color};width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;border:1.5px solid white;box-shadow:0 0 6px ${style.color}80;opacity:0.92;">${style.emoji}</div>`
        const icon = new L.DivIcon({
          html, className: 'public-sensor-icon', iconSize: [18, 18], iconAnchor: [9, 9]
        })
        return (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={icon}>
            <Popup>
              <div style={{ minWidth: 180 }}>
                <strong>{s.name}</strong>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                  {style.label} · {s.source}
                </div>
                <a href={s.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 6, color: '#2563eb' }}>
                  Open source ↗
                </a>
              </div>
            </Popup>
          </Marker>
        )
      })}

      <MapLayerControls prefs={prefs} position="topright" />
      {prefs.qpe && <MrmsQpeLegend window={prefs.qpeWindow} position="bottomright" />}
    </MapContainer>
  )
}
