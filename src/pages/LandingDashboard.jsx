import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { GAUGES } from '../config/gauges'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { alertColor } from '../lib/alertColors'
import { formatCDT } from '../lib/formatTime'
import RiverMap from '../components/RiverMap'
import Sparkline from '../components/Sparkline'
import NwsAlertsBanner from '../components/NwsAlertsBanner'
import BasinBriefingHeader from '../components/BasinBriefingHeader'
import ReservoirCard from '../components/ReservoirCard'
import AhpsForecastSummary from '../components/AhpsForecastSummary'
import RiverAnimation from '../components/RiverAnimation'
import SafeZoneManager from '../components/SafeZoneManager'
import { useSentinel } from '../contexts/SentinelContext'
import { AlertTriangle, Clock, ShieldAlert, TrendingUp, Shield, Activity, MapPin } from 'lucide-react'

// --- Hero & Landing Sections ---

function Hero() {
  const navigate = useNavigate()
  return (
    <div className="landing-root" style={{ minHeight: 'auto', paddingBottom: 0 }}>
      <section className="landing-hero">
        <div className="landing-hero__badge"><Shield size={13} /> Free for the Hill Country</div>
        <h1 className="landing-hero__title">
          Eyes on the river,<br />from <span className="landing-gradient-text">Hunt to Comfort</span>
        </h1>
        <p className="landing-hero__sub">
          A neighborly flood-awareness dashboard for the upper Guadalupe. Live USGS readings,
          plain-language alerts, and trend charts — refreshed every minute and free for everyone
          who calls the Hill Country home.
        </p>
        <div className="landing-hero__cta">
          <button className="landing-btn landing-btn--primary landing-btn--lg" onClick={() => navigate('/register')}>
            Get Started Free
          </button>
          <span className="landing-hero__cta-sub">Sign in for push alerts and AI briefings</span>
        </div>
      </section>
    </div>
  )
}

function flowWidth(cfs) {
  if (!cfs || cfs < 50) return 3
  if (cfs < 300) return 5
  if (cfs < 1000) return 8
  if (cfs < 3000) return 11
  return 14
}

function RiverCorridor({ gauges }) {
  const sorted = [...GAUGES].filter(g => g.type === 'river').sort((a, b) => a.order - b.order)
  const W = 800, H = 100
  const padX = 72
  const step = sorted.length > 1 ? (W - padX * 2) / (sorted.length - 1) : 0
  const midY = 46

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
      {sorted.slice(0, -1).map((g, i) => {
        const x1 = padX + i * step
        const x2 = padX + (i + 1) * step
        const d = gauges[g.id]
        const color = alertColor(d?.alert)
        const w = flowWidth(d?.flow)
        return (
          <g key={g.id}>
            <line x1={x1} y1={midY} x2={x2} y2={midY} stroke={color} strokeWidth={w + 10} opacity={0.13} strokeLinecap="round" />
            <line x1={x1} y1={midY} x2={x2} y2={midY} stroke={color} strokeWidth={w} opacity={0.88} strokeLinecap="round" />
            <line x1={x1} y1={midY} x2={x2} y2={midY} stroke="rgba(0,0,0,0.15)" strokeWidth={1.5} strokeDasharray="5 13" />
          </g>
        )
      })}
      {sorted.map((g, i) => {
        const x = padX + i * step
        const d = gauges[g.id]
        const color = alertColor(d?.alert)
        const ht = d?.height
        const rate = d?.rates?.rise60m ?? 0
        const rateStr = rate > 0.05 ? `↑ +${rate.toFixed(1)}'` : rate < -0.05 ? `↓ ${rate.toFixed(1)}'` : '→ stable'
        const isStaggered = i % 2 !== 0
        return (
          <g key={g.id}>
            <circle cx={x} cy={midY} r={14} fill={color} opacity={0.18} />
            <circle cx={x} cy={midY} r={10} fill={color} />
            <circle cx={x} cy={midY} r={10} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
            <text x={x} y={midY - 22} fill="var(--text-main)" fontSize={12} textAnchor="middle" fontWeight="700" fontFamily="Inter,sans-serif">
              {ht != null ? ht.toFixed(1) + "'" : '—'}
            </text>
            <text x={x} y={midY - 10} fill={rate === 0 ? 'var(--text-muted)' : color} fontSize={9} textAnchor="middle" fontFamily="Inter,sans-serif" fontWeight={rate !== 0 ? "700" : "500"}>
              {rateStr}
            </text>
            <text 
              x={x} 
              y={midY + 25 + (isStaggered ? 12 : 0)} 
              fill="var(--text-muted)" 
              fontSize={9} 
              textAnchor="middle" 
              fontFamily="Inter,sans-serif"
              fontWeight="600"
            >
              {g.shortName}
            </text>
          </g>
        )
      })}
      <text x={6} y={midY + 4} fill="var(--text-muted)" fontSize={9} fontFamily="Inter,sans-serif">↑ upstream</text>
      <text x={W - 6} y={midY + 4} fill="var(--text-muted)" fontSize={9} textAnchor="end" fontFamily="Inter,sans-serif">downstream ↓</text>
    </svg>
  )
}

function categoryColor(cat) {
  if (!cat) return '#64748b'
  if (cat.includes('Major')) return '#991b1b'
  if (cat.includes('Moderate')) return '#ef4444'
  if (cat.includes('Minor')) return '#f97316'
  if (cat.includes('Action')) return '#f59e0b'
  return '#10b981'
}

function Peak24hBadge({ forecast }) {
  if (!forecast) return null
  const now = Date.now()
  const cutoff = now + 24 * 60 * 60 * 1000

  let peak = null
  for (const p of (forecast.points || [])) {
    if (new Date(p.t).getTime() > cutoff) break
    if (!peak || p.stageFt > peak.stageFt) peak = p
  }

  if (!peak) return null

  const color = categoryColor(forecast.peak?.category)
  const delta = peak.stageFt - (forecast.points[0]?.stageFt ?? peak.stageFt)
  const sign = delta >= 0 ? '+' : ''

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 6,
      background: `${color}22`, border: `1px solid ${color}66`,
      fontSize: '0.7rem', fontWeight: 600, color, marginTop: 4
    }}>
      <TrendingUp size={10} />
      Next 24h: {sign}{delta.toFixed(1)} ft → {forecast.peak?.category || '—'}
    </div>
  )
}

export default function LandingDashboard({ forecasts = {} }) {
  const { session } = useAuth()
  const { gaugesData: data, surgeEvents, nwsAlerts, basinBriefing, alertsForGauge } = useSentinel()
  const [addingProperty, setAddingProperty] = React.useState(false)

  return (
    <>
      {!session && (
        <div>
          <Hero />
        </div>
      )}

      {/* Warnings are public */}
      <NwsAlertsBanner alerts={nwsAlerts} showAllClear />

      {/* AI stuff is behind auth */}
      {session && (
        <div style={{ marginBottom: 24 }}>
          <BasinBriefingHeader
            briefing={basinBriefing.briefing}
            loading={basinBriefing.loading}
            error={basinBriefing.error}
            onRegenerate={basinBriefing.regenerate}
          />
        </div>
      )}

      {surgeEvents?.length > 0 && (
        <div className="surge-banner" style={{ marginBottom: 24 }}>
          <AlertTriangle size={16} />
          <strong>Upstream Surge Alert:</strong>
          {surgeEvents.map((e, i) => (
            <span key={i}> {e.message}</span>
          ))}
        </div>
      )}
      
      <div>
        <RiverAnimation data={data} />

        {session && (
          <SafeZoneManager 
            gaugesData={data} 
            onAddClick={() => setAddingProperty(true)} 
          />
        )}

        {addingProperty && (
          <div className="glass-panel" style={{ marginBottom: 24, borderColor: 'var(--apple-blue)', background: 'rgba(10, 132, 255, 0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-main)' }}>
              <MapPin color="var(--apple-blue)" />
              <div>
                <strong>Adding Safe Zone</strong>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Click anywhere on the map below to drop your property pin.</div>
              </div>
              <button onClick={() => setAddingProperty(false)} style={{ marginLeft: 'auto', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '4px 12px', borderRadius: 20, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}

        <div className="glass-panel map-container-wrapper" style={{ padding: 0, marginBottom: 24 }}>
          <RiverMap 
            gauges={data} 
            addingProperty={addingProperty}
            onPropertyAdded={() => setAddingProperty(false)}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <ReservoirCard />
        </div>

        <div className="dashboard-grid">
          {GAUGES.map(g => {
            const d = data[g.id]
            const alertClass = d?.alert || 'GREEN'
            const alertLabel = ALERT_LEVELS[alertClass]?.label || 'Normal'
            const surgeEvent = surgeEvents?.find(e => e.downstreamGaugeId === g.id)
            const gaugeAlerts = alertsForGauge(g.id)
            const gaugeForecast = forecasts[g.id] || null
            const rate60 = d?.rates?.rise60m ?? 0
            const rateColor = rate60 > 0.3 ? 'var(--alert-orange)' : rate60 < -0.1 ? 'var(--alert-green)' : 'var(--text-main)'
            const floodPct = g.floodStageFt && d?.height != null
              ? Math.min((d.height / g.floodStageFt) * 100, 110)
              : null

            const historyHeights = d?.history
              ? d.history.map(h => h.height).filter(h => typeof h === 'number' && !isNaN(h))
              : []

            const sparklineColor = `var(--alert-${alertClass.toLowerCase()})`

            return (
              <Link to={`/gauge/${g.id}`} key={g.id} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div
                  className="glass-panel gauge-card"
                  style={{ '--card-color': `var(--alert-${alertClass.toLowerCase()})` }}
                >
                  {d?.isStale && (
                    <div className="stale-indicator">
                      <Clock size={11} /> Stale data
                    </div>
                  )}

                  <div className="gauge-header">
                    <div className="gauge-name">{g.name}</div>
                    <div className={`alert-badge ${alertClass}`}>{alertLabel}</div>
                  </div>

                  <div style={{ margin: '16px 0 24px 0', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span className="metric-value" style={{ fontSize: '3.5rem', lineHeight: 1, letterSpacing: '-0.04em' }}>{d?.height !== undefined ? d.height.toFixed(2) : '—'}</span>
                    <span style={{ fontSize: '1.25rem', color: 'var(--text-muted)', fontWeight: 500 }}>ft</span>
                  </div>

                  {gaugeAlerts.length > 0 && (
                    <div
                      className="surge-warning"
                      title={gaugeAlerts.map((a) => a.event).join(', ')}
                      style={{ marginBottom: 12 }}
                    >
                      <ShieldAlert size={12} />
                      NWS: {gaugeAlerts[0].event}{gaugeAlerts.length > 1 ? ` +${gaugeAlerts.length - 1} more` : ''}
                    </div>
                  )}

                  {surgeEvent && (
                    <div className="surge-warning" style={{ marginBottom: 12 }}>
                      <AlertTriangle size={12} />
                      Upstream surge from {surgeEvent.sourceName}
                    </div>
                  )}

                  <div className="gauge-metrics">
                    <div className="metric">
                      <div className="metric-label">Flow Rate</div>
                      <div style={{ marginTop: 4 }}>
                        <span className="metric-value" style={{ fontSize: '1.5rem' }}>{d?.flow !== undefined ? d.flow.toLocaleString() : '—'}</span>
                        <span className="metric-unit"> cfs</span>
                      </div>
                    </div>
                    <div className="metric">
                      <div className="metric-label">1Hr Trend</div>
                      <div style={{ marginTop: 4 }}>
                        <span className="metric-value" style={{ fontSize: '1.5rem', color: rateColor }}>
                          {rate60 >= 0 ? '+' : ''}{rate60.toFixed(2)}
                        </span>
                        <span className="metric-unit"> ft</span>
                      </div>
                    </div>
                  </div>

                  <div className="gauge-footer">
                    <div style={{ color: '#e2e8f0', fontWeight: 500 }}>
                      Updated: <span style={{ color: '#94a3b8' }}>{d?.time ? formatCDT(d.time) : '—'}</span>
                    </div>
                    <div style={{ color: '#60a5fa', fontWeight: 600 }}>View Details →</div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
      
      {!session && (
        <footer className="landing-footer">
          <div className="landing-footer-links">
            <span>© {new Date().getFullYear()} Track the Guad</span>
            <span style={{ margin: '0 0.5rem', opacity: 0.5 }}>•</span>
            <a className="landing-footer-link" href="/privacy">Privacy Policy</a>
            <span style={{ margin: '0 0.5rem', opacity: 0.5 }}>•</span>
            <a className="landing-footer-link" href="/terms">Terms of Service</a>
          </div>
          <span>Data sourced from <a className="landing-footer-link" href="https://waterdata.usgs.gov" target="_blank" rel="noreferrer">USGS National Water Information System</a></span>
        </footer>
      )}
    </>
  )
}
