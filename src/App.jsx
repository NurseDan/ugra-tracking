import React, { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { GAUGES, REFRESH_MS, FAST_FLOW_MPH, FLOOD_FLOW_MPH, STALE_AFTER_MINUTES } from './config/gauges'
import { fetchUSGSGauges } from './lib/usgs'
import { fetchPrecipitationForecast } from './lib/weatherApi'
import { calculateRates, getAlertLevel, getHighestAlert, ALERT_LEVELS } from './lib/alertEngine'
import { detectSurges } from './lib/surgeEngine'
import { logIncident } from './lib/incidentLog'
import { formatCDT } from './lib/formatTime'
import { mergeHistory, loadForecastCache, isForecastStale } from './lib/gaugeHistory'
import { generateAllForecasts } from './lib/riseForecast'
import { WifiOff } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Dashboard from './pages/Dashboard'
import GaugeDetail from './pages/GaugeDetail'
import Incidents from './pages/Incidents'
import MyAlerts from './pages/MyAlerts'
import PublicDashboard from './pages/PublicDashboard'
import { useNotifications } from './hooks/useNotifications'
import Exports from './pages/Exports'
import AccountSettings from './pages/AccountSettings'
import Pricing from './pages/Pricing'
import PlanDetail from './pages/PlanDetail'
import AppHeader from './components/AppHeader'
import UpgradeModal from './components/UpgradeModal'
import { SentinelProvider } from './contexts/SentinelContext'
import Landing from './pages/Landing'
import Admin from './pages/Admin'
import { usePlan } from './hooks/usePlan'

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

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
    rise5m * 30 + rise15m * 18 + rise60m * 10 + flow / 160 +
    rainfall * 22 + rainfallIntensity * 45 + probability / 5,
    0, 100
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

function isStaleData(timeStr) {
  if (!timeStr) return true
  const ageMinutes = (Date.now() - new Date(timeStr).getTime()) / 60000
  return ageMinutes > STALE_AFTER_MINUTES
}

function loadAllCachedForecasts({ allowStale = false } = {}) {
  const result = {}
  for (const g of GAUGES) {
    const fc = loadForecastCache(g.id, { allowStale })
    if (fc) result[g.id] = fc
  }
  return result
}

function getOnlineState() {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

const forecastGenerating = new Set()
async function backgroundGenerateForecasts(setCachedForecasts) {
  const staleSiteIds = GAUGES.map(g => g.id).filter(id => isForecastStale(id) && !forecastGenerating.has(id))
  if (staleSiteIds.length === 0) return
  for (const siteId of staleSiteIds) {
    forecastGenerating.add(siteId)
    try { await generateAllForecasts([siteId]) } catch {}
    finally { forecastGenerating.delete(siteId) }
  }
  setCachedForecasts(loadAllCachedForecasts())
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}

function AppRoutes() {
  const { session } = useAuth()

  if (session === undefined) {
    return (
      <div className="loading-screen" style={{ minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    )
  }

  if (!session) {
    return <Landing />
  }

  return <AuthenticatedApp />
}

function GatedRoute({ requiredPlan, featureName, children }) {
  const { canAlert, canExport, loading } = usePlan()
  const [showModal, setShowModal] = useState(false)

  const allowed =
    requiredPlan === 'member'   ? canAlert :
    requiredPlan === 'pro_plus' ? canExport :
    true

  useEffect(() => {
    if (!loading && !allowed) setShowModal(true)
  }, [loading, allowed])

  if (loading) return null
  if (!allowed) {
    return (
      <>
        {showModal && (
          <UpgradeModal
            requiredPlan={requiredPlan}
            featureName={featureName}
            onClose={() => setShowModal(false)}
          />
        )}
        <div style={{ filter: 'blur(4px)', pointerEvents: 'none', userSelect: 'none' }}>
          {children}
        </div>
      </>
    )
  }
  return children
}

function AuthenticatedApp() {
  const [data, setData] = useState({})
  const [surgeEvents, setSurgeEvents] = useState([])
  const [lastUpdate, setLastUpdate] = useState(null)
  const [fetchError, setFetchError] = useState(false)
  const [isOffline, setIsOffline] = useState(() => !getOnlineState())
  useNotifications(data)
  const [cachedForecasts, setCachedForecasts] = useState(() =>
    loadAllCachedForecasts({ allowStale: !getOnlineState() })
  )
  const prevAlertsRef = useRef({})

  useEffect(() => {
    fetchData()
    const i = setInterval(fetchData, REFRESH_MS)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => { setIsOffline(false); fetchData() }
    const handleOffline = () => {
      setIsOffline(true)
      setCachedForecasts(loadAllCachedForecasts({ allowStale: true }))
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        fetchData()
        backgroundGenerateForecasts(setCachedForecasts)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  async function fetchData() {
    try {
      const ids = GAUGES.map(g => g.id)
      const [usgsResult, ...weatherResults] = await Promise.allSettled([
        fetchUSGSGauges(ids),
        ...GAUGES.map(g =>
          fetchPrecipitationForecast(g.lat, g.lng).catch(() => null)
        )
      ])
      const usgsData = usgsResult.status === 'fulfilled' ? (usgsResult.value || {}) : {}
      const usgsHasData = Object.keys(usgsData).length > 0
      const forecastByGauge = {}
      GAUGES.forEach((g, i) => {
        const r = weatherResults[i]
        forecastByGauge[g.id] = r && r.status === 'fulfilled' ? r.value : null
      })
      const processed = {}
      for (const g of GAUGES) {
        const d = usgsData[g.id]
        if (!d) continue
        const stale = isStaleData(d.time)
        const rates = calculateRates(d.history || [], d)
        const alert = getAlertLevel(rates, { isStale: stale })
        const forecast = forecastByGauge[g.id]
        const base = { ...d, alert, rates, forecast, isStale: stale }
        const sentinelScore = getSentinelScore(base)
        processed[g.id] = {
          ...base,
          sentinelScore,
          sentinelLevel: getSentinelLevel(sentinelScore),
          etaHours: estimateArrivalHours(g, base)
        }
        const prevAlert = prevAlertsRef.current[g.id]
        const prevPriority = ALERT_LEVELS[prevAlert]?.priority ?? -1
        const newPriority = ALERT_LEVELS[alert]?.priority ?? 0
        if (prevAlert !== undefined && newPriority > prevPriority) {
          logIncident({
            gaugeId: g.id, gaugeName: g.name,
            fromAlert: prevAlert, toAlert: alert,
            height: d.height, flow: d.flow,
            time: new Date().toISOString()
          })
        }
        prevAlertsRef.current[g.id] = alert
        if (d.history && d.history.length > 0) {
          mergeHistory(g.id, d.history).catch(() => {})
        }
      }
      const surges = detectSurges(processed)
      const networkOffline = !getOnlineState()
      const useStaleForecasts = networkOffline || !usgsHasData
      if (usgsHasData) {
        setData(processed)
        setSurgeEvents(surges)
        setLastUpdate(new Date())
      }
      setFetchError(!usgsHasData)
      setIsOffline(networkOffline)
      setCachedForecasts(loadAllCachedForecasts({ allowStale: useStaleForecasts }))
      if (!useStaleForecasts) backgroundGenerateForecasts(setCachedForecasts)
    } catch (err) {
      console.warn('Failed to fetch data, falling back to cached values:', err)
      setFetchError(true)
      setIsOffline(true)
      setCachedForecasts(loadAllCachedForecasts({ allowStale: true }))
    }
  }

  const alertsArray = Object.values(data).map(d => d.alert)
  const highestAlert = alertsArray.length > 0 ? getHighestAlert(alertsArray) : 'GREEN'

  return (
    <SentinelProvider data={data} surgeEvents={surgeEvents} cachedForecasts={cachedForecasts}>
      <BrowserRouter>
        <AppHeader highestAlert={highestAlert} lastUpdate={lastUpdate} />
        {(isOffline || fetchError) && (
          <div className="error-banner">
            <WifiOff size={16} />
            {isOffline ? 'Offline — showing last cached river data' : 'Data refresh failed — displaying last known values'}
            {lastUpdate && <span style={{ marginLeft: 8, opacity: 0.7 }}>from {formatCDT(lastUpdate)}</span>}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard data={data} lastUpdate={lastUpdate} />} />
          <Route path="/gauge/:id" element={<GaugeDetail data={data} />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/my-alerts" element={<GatedRoute requiredPlan="member" featureName="Alert Subscriptions"><MyAlerts data={data} /></GatedRoute>} />
          <Route path="/exports" element={<GatedRoute requiredPlan="pro_plus" featureName="Data Exports"><Exports data={data} /></GatedRoute>} />
          <Route path="/account" element={<AccountSettings />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/plans/:tier" element={<PlanDetail />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </BrowserRouter>
    </SentinelProvider>
  )
}
