import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import { GAUGES } from '../config/gauges'
import { alertColor } from '../lib/alertColors'

export default function RiverMap({ gauges }) {
  const sorted = [...GAUGES].sort((a, b) => a.order - b.order)

  const flowLine = sorted.map(g => [g.lat, g.lng])

  return (
    <MapContainer center={[30.05, -99.15]} zoom={10} style={{ height: 400, width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      <Polyline positions={flowLine} pathOptions={{ color: '#2563eb', weight: 3 }} />

      {sorted.map(g => {
        const d = gauges[g.id]
        const color = alertColor(d?.alert)

        return (
          <CircleMarker key={g.id} center={[g.lat, g.lng]} radius={10} pathOptions={{ color, fillColor: color, fillOpacity: 0.8 }}>
            <Tooltip>
              <div>
                <strong>{g.shortName}</strong>
                <div>Level: {d?.height ?? '—'} ft</div>
                <div>Alert: {d?.alert ?? '—'}</div>
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
