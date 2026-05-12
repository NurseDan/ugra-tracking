import React, { useMemo, useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { GAUGES } from '../config/gauges'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { formatCDT } from '../lib/formatTime'
import Sparkline from '../components/Sparkline'
import NwsAlertsBanner from '../components/NwsAlertsBanner'
import GaugeBriefingCard from '../components/GaugeBriefingCard'
import AhpsForecastChart from '../components/AhpsForecastChart'
import StreamflowForecastChart from '../components/StreamflowForecastChart'
import HistoryChart from '../components/HistoryChart'
import RiseForecastPanel from '../components/RiseForecastPanel'
import { useSentinel } from '../contexts/SentinelContext'
import { useGaugeBriefing } from '../hooks/useGaugeBriefing'
import { useGaugeHistory } from '../hooks/useGaugeHistory'
import { useAhpsForecast } from '../hooks/useAhpsForecast'
import { useStreamflowForecast } from '../hooks/useStreamflowForecast'
import { buildGaugeContext } from '../lib/aiBriefing'
import {
  isSubscribedToGauge, subscribeToGauge, unsubscribeFromGauge,
  isSupported as notifSupported, getPermissionState, requestPermission, ensureServiceWorker
} from '../lib/notifications'
import { ArrowLeft, AlertTriangle, Activity, Cpu, Clock, Database, Bell, BellOff } from 'lucide-react'

function NotificationToggle({ gaugeId }) {
  const supported = notifSupported()
  const [permission, setPermission] = useState(() => (supported ? getPermissionState() : 'unsupported'))
  const [subscribed, setSubscribed] = useState(() => (supported ? isSubscribedToGauge(gaugeId) : false))

  useEffect(() => {
    setSubscribed(supported ? isSubscribedToGauge(gaugeId) : false)
  }, [gaugeId, supported])

  if (!supported) {
    return <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Notifications not supported in this browser.</div>
  }

  const enable = async () => {
    if (permission !== 'granted') {
      const result = await requestPermission()
      setPermission(result)
      if (result !== 'granted') return
      ensureServiceWorker()
    }
    subscribeToGauge(gaugeId)
    setSubscribed(true)
  }

  const disable = () => {
    unsubscribeFromGauge(gaugeId)
    setSubscribed(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {subscribed ? (
        <button
          type="button"
          onClick={disable}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.45)',
            color: '#10b981', cursor: 'pointer', fontSize: '0.85rem'
          }}
        >
          <Bell size={14} /> Notifications on — click to disable
        </button>
      ) : (
        <button
          type="button"
          onClick={enable}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#cbd5e1', cursor: 'pointer', fontSize: '0.85rem'
          }}
        >
          <BellOff size={14} /> Notify me about this gauge
        </button>
      )}
      {permission === 'denied' && (
        <span style={{ fontSize: '0.75rem', color: '#fca5a5' }}>Browser blocked notifications</span>
      )}
    </div>
  )
}

export default function GaugeDetail() {
  const { id } = useParams()
  const { gaugesData, alertsForGauge } = useSentinel()
  const gaugeConfig = GAUGES.find(g => g.id === id)
  const d = gaugesData[id]
  const gaugeAlerts = alertsForGauge(id)

  const { history, loading: historyLoading } = useGaugeHistory(id)
  const { forecast: ahpsFcArray, floodCategories: ahpsFloodCategories } = useAhpsForecast(gaugeConfig)
  const { series: nwmSeries, source: nwmSource } = useStreamflowForecast(gaugeConfig)

  const briefingContext = useMemo(() => {
    if (!gaugeConfig || !d) return null
    return buildGaugeContext({
      gauge: gaugeConfig,
      reading: d,
      alerts: gaugeAlerts,
      rainfall: d.forecast
        ? {
            next24hInches: d.forecast.totalInches,
            maxHourlyInches: d.forecast.maxHourlyInches,
            maxProbability: d.forecast.maxProbability
          }
        : null
    })
  }, [gaugeConfig, d, gaugeAlerts])

  const briefing = useGaugeBriefing(gaugeConfig, briefingContext, { enabled: Boolean(briefingContext) })


  const ahpsForecastForEngine = useMemo(() => {
    if (!ahpsFcArray || ahpsFcArray.length === 0) return undefined
    const peakPoint = ahpsFcArray.reduce((best, p) =>
      (!best || (p.stage ?? 0) > (best.stage ?? 0)) ? p : best, null)
    if (!peakPoint || peakPoint.stage == null) return undefined
    return { peakFt: peakPoint.stage, peakAt: peakPoint.t }
  }, [ahpsFcArray])

  const streamflowForecastForEngine = useMemo(() => {
    if (!nwmSeries || nwmSeries.length === 0) return undefined
    const peakPoint = nwmSeries.reduce((best, p) => {
      const v = p.flow ?? p.primary ?? 0
      const bv = best ? (best.flow ?? best.primary ?? 0) : 0
      return v > bv ? p : best
    }, null)
    if (!peakPoint) return undefined
    const peakCfs = peakPoint.flow ?? peakPoint.primary
    const peakAt = peakPoint.t ?? peakPoint.validTime
    if (!Number.isFinite(peakCfs) || !peakAt) return undefined
    return { peakCfs, peakAt, source: nwmSource }
  }, [nwmSeries, nwmSource])

  if (!gaugeConfig) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', marginTop: 40, padding: 48 }}>
        <h2 style={{ marginBottom: 12 }}>Gauge Not Found</h2>
        <p style={{ color: '#94a3b8', marginBottom: 16 }}>
          No gauge with ID <code>{id}</code> is configured.
        </p>
        <Link to="/" style={{ color: '#60a5fa', textDecoration: 'none' }}>&larr; Return to Dashboard</Link>
      </div>
    )
  }

  if (!d) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', marginTop: 40, padding: 48 }}>
        <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ marginBottom: 12 }}>Loading Gauge Data…</h2>
        <Link to="/" style={{ color: '#60a5fa', textDecoration: 'none' }}>&larr; Return to Dashboard</Link>
      </div>
    )
  }

  const alertClass = d.alert || 'GREEN'
  const alertLabel = ALERT_LEVELS[alertClass]?.label || 'Normal'
  const floodStage = gaugeConfig.floodStageFt || 20

  const height = d.height || 0
  const maxVisual = Math.max(floodStage * 1.2, height * 1.1, 10)
  const fillPercent = Math.min((height / maxVisual) * 100, 100)
  const floodLinePercent = Math.min((floodStage / maxVisual) * 100, 100)

  const historyHeights = d.history
    ? d.history.map(h => h.height).filter(h => typeof h === 'number' && !isNaN(h))
    : []

  const flow = d.flow || 0
  let flowMessage = 'No flow data available.'
  let flowColor = '#94a3b8'
  if (d.flow !== undefined) {
    if (flow > 5000) { flowMessage = 'Severe / Flood Flow: Extremely dangerous, life-threatening currents.'; flowColor = '#ef4444' }
    else if (flow > 2000) { flowMessage = 'Dangerous Flow: Very swift, powerful currents.'; flowColor = '#f97316' }
    else if (flow > 500) { flowMessage = 'Fast Flow: Swift currents, hazardous for casual recreation.'; flowColor = '#f59e0b' }
    else if (flow > 100) { flowMessage = 'Normal Flow: Typical recreational conditions.'; flowColor = '#10b981' }
    else { flowMessage = 'Low Flow: Water moving very slowly.'; flowColor = '#60a5fa' }
  }

  const rate5 = d.rates?.rise5m ?? 0
  const rate15 = d.rates?.rise15m ?? 0
  const rate60 = d.rates?.rise60m ?? 0
  const rateColor = r => r > 0.15 ? 'var(--alert-orange)' : r < -0.08 ? 'var(--alert-green)' : '#94a3b8'

  return (
    <div className="gauge-detail-container">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> Back to Dashboard
      </Link>

      <div className="glass-panel" style={{ marginBottom: 24 }}>
        {d.isStale && (
          <div className="stale-banner">Data may be stale — last reading was over 20 minutes ago.</div>
        )}

        <div className="detail-header-row">
          <div>
            <h1 className="detail-title">{gaugeConfig.name}</h1>
            <div className={`alert-badge ${alertClass}`} style={{ marginBottom: 10 }}>
              <AlertTriangle size={14} /> {alertLabel}
            </div>
            <div style={{ color: '#64748b', fontSize: '0.78rem', marginBottom: 14 }}>
              USGS #{gaugeConfig.id} &nbsp;·&nbsp; {gaugeConfig.lat}°N, {Math.abs(gaugeConfig.lng)}°W
            </div>
            <NotificationToggle gaugeId={id} />
          </div>

          <div className="detail-metrics-row">
            <div className="metric">
              <div className="metric-label">Current Level</div>
              <div><span className="metric-value">{height.toFixed(2)}</span><span className="metric-unit"> ft</span></div>
            </div>
            <div className="metric">
              <div className="metric-label">Flow Rate</div>
              <div>
                <span className="metric-value">{d.flow !== undefined && d.flow !== null ? d.flow.toLocaleString() : '—'}</span>
                <span className="metric-unit"> cfs</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">1hr Change</div>
              <div>
                <span className="metric-value" style={{ color: rateColor(rate60) }}>
                  {rate60 >= 0 ? '+' : ''}{rate60.toFixed(2)}
                </span>
                <span className="metric-unit"> ft/hr</span>
              </div>
            </div>
            {gaugeConfig.floodStageFt && (
              <div className="metric">
                <div className="metric-label">To Flood</div>
                <div>
                  <span className="metric-value" style={{ color: (height / gaugeConfig.floodStageFt) > 0.85 ? 'var(--alert-red)' : (height / gaugeConfig.floodStageFt) > 0.65 ? 'var(--alert-orange)' : 'var(--text-main)' }}>
                    {Math.max(0, gaugeConfig.floodStageFt - height).toFixed(2)}
                  </span>
                  <span className="metric-unit"> ft</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rate-bar">
          {[['5 min', rate5], ['15 min', rate15], ['60 min', rate60]].map(([label, r]) => (
            <div key={label} className="rate-chip">
              <span className="rate-chip-label">{label}</span>
              <span style={{ fontWeight: 700, color: rateColor(r) }}>
                {r >= 0 ? '+' : ''}{r.toFixed(2)} ft
              </span>
            </div>
          ))}
        </div>
      </div>

      {gaugeAlerts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <NwsAlertsBanner alerts={gaugeAlerts} />
        </div>
      )}

      <div className="gauge-detail-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <GaugeBriefingCard
            briefing={briefing.briefing}
            loading={briefing.loading}
            error={briefing.error}
            context={briefingContext}
            onRegenerate={briefing.regenerate}
            fetchedAt={briefing.fetchedAt}
          />

          <div className="glass-panel">
            <h3 style={{ marginBottom: 16, color: '#f8fafc' }}>AHPS Observed vs Forecast</h3>
            <AhpsForecastChart gauge={gaugeConfig} />
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: 16, color: '#f8fafc' }}>Streamflow Forecast (NOAA NWM / Open-Meteo)</h3>
            <StreamflowForecastChart
              gauge={gaugeConfig}
              observedFlow={d.flow}
              observedTime={d.time}
            />
          </div>

          <RiseForecastPanel
            siteId={id}
            history={history.length > 0 ? history : null}
            floodStageFt={gaugeConfig.floodStageFt}
            floodCategories={ahpsFloodCategories}
            ahpsForecast={ahpsForecastForEngine}
            ahpsForecastSeries={ahpsFcArray}
            streamflowForecast={streamflowForecastForEngine}
            initialForecast={null}
          />

          <div className="glass-panel" style={{ borderLeft: `4px solid ${flowColor}` }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#f8fafc' }}>
              <Activity size={20} color={flowColor} />
              Flow Assessment
            </h3>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: flowColor, marginBottom: 8 }}>
              {flow.toLocaleString()} cfs
            </div>
            <p style={{ fontSize: '1rem', lineHeight: 1.5, color: '#e2e8f0' }}>
              {flowMessage}
            </p>
          </div>

          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Database size={18} color="#60a5fa" />
                14-Day History
                {historyLoading && <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 }}>Loading...</span>}
              </h3>
              {history.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  {history.length.toLocaleString()} readings
                </span>
              )}
            </div>
            {history.length >= 2 ? (
              <HistoryChart
                history={history}
                floodStageFt={gaugeConfig.floodStageFt}
                floodCategories={ahpsFloodCategories}
                height={280}
              />
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>
                  <div className="metric-label" style={{ marginBottom: 4 }}>Recent 6-Hour Window</div>
                  <Sparkline data={historyHeights} color={`var(--alert-${alertClass.toLowerCase()})`} height={100} width={800} />
                </div>
                {historyLoading && (
                  <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 8 }}>Fetching 14-day history...</div>
                )}
              </>
            )}
            <div style={{ marginTop: 16, textAlign: 'right', fontSize: '0.875rem', color: '#94a3b8' }}>
              Last Reading: {formatCDT(d.time)}
            </div>
          </div>
        </div>

        <div className="glass-panel flood-meter-panel">
          <h3 style={{ textAlign: 'center', color: '#f8fafc', margin: '0 0 20px', fontSize: '1rem' }}>
            Flood Stage Monitor
          </h3>

          <div className="thermometer-wrap">
            <div className="thermometer">
              <div
                className="thermometer-fill"
                style={{
                  height: `${fillPercent}%`,
                  background: `var(--alert-${alertClass.toLowerCase()})`,
                  boxShadow: `0 0 28px var(--alert-${alertClass.toLowerCase()})`
                }}
              />
              {gaugeConfig.floodStageFt && (
                <div className="flood-marker" style={{ bottom: `${floodLinePercent}%` }}>
                  <div className="flood-marker-label">FLOOD</div>
                </div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <div style={{ fontSize: '2.4rem', fontWeight: 800, color: `var(--alert-${alertClass.toLowerCase()})`, lineHeight: 1 }}>
              {height.toFixed(1)}'
            </div>
            {gaugeConfig.floodStageFt ? (
              <>
                <div style={{ color: '#64748b', fontSize: '0.8rem', margin: '6px 0 10px' }}>
                  Flood Stage: {gaugeConfig.floodStageFt}'
                </div>
                <div className="progress-bar-track" style={{ width: 150, margin: '0 auto 6px' }}>
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${Math.min((height / gaugeConfig.floodStageFt) * 100, 100)}%`,
                      background: (height / gaugeConfig.floodStageFt) > 0.9 ? 'var(--alert-red)' : (height / gaugeConfig.floodStageFt) > 0.65 ? 'var(--alert-orange)' : 'var(--alert-green)'
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.78rem', color: (height / gaugeConfig.floodStageFt) > 0.8 ? '#fca5a5' : '#64748b', marginBottom: 10 }}>
                  {((height / gaugeConfig.floodStageFt) * 100).toFixed(0)}% of flood stage
                </div>
                <div className="flood-countdown">
                  {Math.max(0, gaugeConfig.floodStageFt - height).toFixed(2)} ft until flood
                </div>
              </>
            ) : (
              <div style={{ color: '#475569', fontSize: '0.8rem', marginTop: 8 }}>Flood stage not defined</div>
            )}
          </div>

          <div className="rate-summary">
            <div className="rate-summary-title">Rise Rates</div>
            {[['5 min', rate5], ['15 min', rate15], ['60 min', rate60]].map(([label, r]) => (
              <div key={label} className="rate-summary-row">
                <span style={{ color: '#64748b', fontSize: '0.78rem' }}>{label}</span>
                <span style={{ fontWeight: 700, fontSize: '0.78rem', color: rateColor(r) }}>
                  {r >= 0 ? '+' : ''}{r.toFixed(2)} ft
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
