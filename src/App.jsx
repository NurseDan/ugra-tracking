import React, { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { GAUGES, REFRESH_MS, FAST_FLOW_MPH, FLOOD_FLOW_MPH } from './config/gauges'
import { fetchUSGSGauges } from './lib/usgs'
import { calculateRates, getAlertLevel, getHighestAlert, ALERT_LEVELS } from './lib/alertEngine'
import { Activity, AlertTriangle, Clock } from 'lucide-react'

import Dashboard from './pages/Dashboard'
import GaugeDetail from './pages/GaugeDetail'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getSentinelScore(d) {
  if (!d) return 0
  const rise5m = d.rates?.rise5m || 0
  const rise15m = d.rates?.rise15m || 0
  const rise60m = d.rates?.rise60m || 0
  const flow = d.flow || 0
  const rainfall = d.forecast?.totalInches || 0
  const rainfallIntensity = d.forecast?.maxHourlyInches || 0
  const probability = d.forecast?.maxProbability || 0

  return Math.round(clamp(
    rise5m * 30 +
    rise15m * 18 +
    rise60m * 10 +
    flow / 160 +
    rainfall * 22 +
    rainfallIntensity * 45 +
    probability / 5,
    0,
    100
  ))
}

function getSentinelLevel(score) {
  if (score >= 80) return 'EXTREME'
  if (score >= 60) return 'HIGH'
  if (score >= 35) return 'WATCH'
  if (score >= 15) return 'EARLY SIGNAL'
  return 'LOW'
}

function estimateArrivalHours(gauge, d) {
  if (!gauge?.downstreamMiles) return null
  const rise60m = d?.rates?.rise60m || 0
  const flow = d?.flow || 0
  let speed = 2
  if (flow > 5000 || rise60m > 3) speed = FLOOD_FLOW_MPH
  else if (flow > 1500 || rise60m > 1) speed = FAST_FLOW_MPH
  return gauge.downstreamMiles / speed
}

export default function App() {
  const [data, setData] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    fetchData()
    const i = setInterval(fetchData, REFRESH_MS)
    return () => clearInterval(i)
  }, [])

  async function fetchData() {
    try {
      const ids = GAUGES.map(g => g.id)
      const usgsData = await fetchUSGSGauges(ids)

      const processed = {}

      for (const g of GAUGES) {
        const d = usgsData[g.id]
        if (!d) continue

        const rates = calculateRates(d.history || [], d)
        const alert = getAlertLevel(rates)
        const base = { ...d, alert, rates }
        const sentinelScore = getSentinelScore(base)

        processed[g.id] = {
          ...base,
          sentinelScore,
          sentinelLevel: getSentinelLevel(sentinelScore),
          etaHours: estimateArrivalHours(g, base)
        }
      }

      setData(processed)
      setLastUpdate(new Date())
    } catch (err) {
      console.error("Failed to fetch data:", err)
    }
  }

  const formatCDT = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    })
  }

  const alertsArray = Object.values(data).map(d => d.alert)
  const highestAlert = alertsArray.length > 0 ? getHighestAlert(alertsArray) : 'GREEN'

  return (
    <BrowserRouter>
      <div className="dashboard-container">
        <header className="header">
          <div className="header-title">
            <Activity size={32} color="#60a5fa" />
            Guadalupe Sentinel
          </div>
          <div className="header-meta">
            <div className={`alert-badge ${highestAlert}`}>
              <AlertTriangle size={16} /> 
              System Status: {ALERT_LEVELS[highestAlert]?.label || 'Normal'}
            </div>
            <div className="header-time" style={{ marginTop: '8px', fontWeight: '500' }}>
              <Clock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              Dashboard Refreshed: {lastUpdate ? formatCDT(lastUpdate) : 'Loading...'}
            </div>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard data={data} formatCDT={formatCDT} highestAlert={highestAlert} lastUpdate={lastUpdate} />} />
          <Route path="/gauge/:id" element={<GaugeDetail data={data} formatCDT={formatCDT} />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
