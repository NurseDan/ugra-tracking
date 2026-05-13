// Public sensors shown on the river map in addition to the primary
// monitored GAUGES. These are reference points only — the dashboard
// doesn't drive alerts off them, but operators / situational viewers
// benefit from seeing nearby gauges, lake levels, and rainfall stations.
//
// Each entry is a public source link the user can click through to view
// upstream data. No keys, all public endpoints.

export const PUBLIC_SENSORS = [
  // USGS streamgages in the broader Hill Country basin (reference only).
  {
    id: 'usgs:08168500',
    name: 'Guadalupe River above Comal at New Braunfels',
    kind: 'streamgage',
    lat: 29.7058,
    lng: -98.1158,
    source: 'USGS',
    url: 'https://waterdata.usgs.gov/monitoring-location/08168500',
  },
  {
    id: 'usgs:08169000',
    name: 'Comal River at New Braunfels',
    kind: 'streamgage',
    lat: 29.7044,
    lng: -98.1294,
    source: 'USGS',
    url: 'https://waterdata.usgs.gov/monitoring-location/08169000',
  },
  {
    id: 'usgs:08176500',
    name: 'Guadalupe River at Victoria',
    kind: 'streamgage',
    lat: 28.7944,
    lng: -97.0119,
    source: 'USGS',
    url: 'https://waterdata.usgs.gov/monitoring-location/08176500',
  },
  {
    id: 'usgs:08176900',
    name: 'Coleto Creek near Schroeder',
    kind: 'streamgage',
    lat: 28.7619,
    lng: -97.2189,
    source: 'USGS',
    url: 'https://waterdata.usgs.gov/monitoring-location/08176900',
  },
  {
    id: 'usgs:08171000',
    name: 'Blanco River at Wimberley',
    kind: 'streamgage',
    lat: 29.9939,
    lng: -98.0908,
    source: 'USGS',
    url: 'https://waterdata.usgs.gov/monitoring-location/08171000',
  },
  // Reservoir levels published by TWDB / USACE.
  {
    id: 'res:canyon_lake',
    name: 'Canyon Lake (USACE pool elevation)',
    kind: 'reservoir',
    lat: 29.8723,
    lng: -98.1953,
    source: 'USACE',
    url: 'https://www.waterdatafortexas.org/reservoirs/individual/canyon',
  },
  // NWS forecast points (AHPS) not duplicated in GAUGES.
  {
    id: 'ahps:WMBT2',
    name: 'Blanco River at Wimberley (NWS AHPS)',
    kind: 'forecast_point',
    lat: 29.9942,
    lng: -98.0900,
    source: 'NWS',
    url: 'https://water.weather.gov/ahps2/hydrograph.php?gage=wmbt2',
  },
  {
    id: 'ahps:NBRT2',
    name: 'Guadalupe River at New Braunfels (NWS AHPS)',
    kind: 'forecast_point',
    lat: 29.7058,
    lng: -98.1158,
    source: 'NWS',
    url: 'https://water.weather.gov/ahps2/hydrograph.php?gage=nbrt2',
  },
  // Mesonet (Iowa State) cooperator rainfall sites nearby.
  {
    id: 'mesonet:KERV',
    name: 'Kerrville Airport (METAR / rainfall)',
    kind: 'rain_gauge',
    lat: 29.9767,
    lng: -99.0858,
    source: 'NWS METAR',
    url: 'https://mesonet.agron.iastate.edu/sites/site.php?station=KERV&network=TX_ASOS',
  },
  {
    id: 'mesonet:KBAZ',
    name: 'New Braunfels Airport (METAR / rainfall)',
    kind: 'rain_gauge',
    lat: 29.7044,
    lng: -98.0461,
    source: 'NWS METAR',
    url: 'https://mesonet.agron.iastate.edu/sites/site.php?station=KBAZ&network=TX_ASOS',
  },
]

export const SENSOR_KIND_STYLE = {
  streamgage:     { color: '#0ea5e9', emoji: '◉', label: 'USGS streamgage' },
  reservoir:      { color: '#22c55e', emoji: '▣', label: 'Reservoir level' },
  forecast_point: { color: '#a855f7', emoji: '◈', label: 'NWS forecast point' },
  rain_gauge:     { color: '#f59e0b', emoji: '☂', label: 'Rain gauge' },
}
