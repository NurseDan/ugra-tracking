import React from 'react'
import { Link } from 'react-router-dom'
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
import { categoryColor } from '../components/RiseForecastPanel'
import { useSentinel } from '../contexts/SentinelContext'
import { AlertTriangle, Clock, ShieldAlert, TrendingUp } from 'lucide-react'

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
            <line x1={x1} y1={midY} x2={x2} y2={midY} stroke="rgba(255,255,255,0.38)" strokeWidth={1.5} strokeDasharray="5 13" />
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
        return (
          <g key={g.id}>
            <circle cx={x} cy={midY} r={14} fill={color} opacity={0.18} />
            <circle cx={x} cy={midY} r={10} fill={color} />
            <circle cx={x} cy={midY} r={10} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
            <text x={x} y={midY - 22} fill="#f8fafc" fontSize={12} textAnchor="middle" fontWeight="700" fontFamily="Inter,sans-serif">
              {ht != null ? ht.toFixed(1) + "'" : '—'}
            </text>
            <text x={x} y={midY - 10} fill={color} fontSize={11} textAnchor="middle" fontFamily="Inter,sans-serif">
              {rateStr}
            </text>
            <text x={x} y={midY + 25} fill="#64748b" fontSize={11} textAnchor="middle" fontFamily="Inter,sans-serif">
              {g.shortName}
            </text>
          </g>
        )
      })}
      <text x={6} y={midY + 4} fill="#334155" fontSize={11} fontFamily="Inter,sans-serif">↑ upstream</text>
      <text x={W - 6} y={midY + 4} fill="#334155" fontSize={11} textAnchor="end" fontFamily="Inter,sans-serif">downstream ↓</text>
    </svg>
  )
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

export default function Dashboard({ forecasts = {} }) {
  const { gaugesData: data, surgeEvents, nwsAlerts, basinBriefing, alertsForGauge } = useSentinel()

  return (
    <>
      <NwsAlertsBanner alerts={nwsAlerts} showAllClear />

      <div style={{ marginBottom: 24 }}>
        <BasinBriefingHeader
          briefing={basinBriefing.briefing}
          loading={basinBriefing.loading}
          error={basinBriefing.error}
          onRegenerate={basinBriefing.regenerate}
        />
      </div>

      {surgeEvents?.length > 0 && (
        <div className="surge-banner">
          <AlertTriangle size={16} />
          <strong>Upstream Surge Alert:</strong>
          {surgeEvents.map((e, i) => (
            <span key={i}> {e.message}</span>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <ReservoirCard />
      </div>

      {/* River Corridor Strip */}
      <div className="glass-panel corridor-panel">
        <div className="section-label">River Corridor — Upstream to Downstream</div>
        <RiverCorridor gauges={data} />
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

                {gaugeAlerts.length > 0 && (
                  <div
                    className="surge-warning"
                    title={gaugeAlerts.map((a) => a.event).join(', ')}
                    style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.45)', color: '#fecaca' }}
                  >
                    <ShieldAlert size={12} />
                    NWS: {gaugeAlerts[0].event}{gaugeAlerts.length > 1 ? ` +${gaugeAlerts.length - 1} more` : ''}
                  </div>
                )}

                {surgeEvent && (
                  <div className="surge-warning">
                    <AlertTriangle size={12} />
                    Upstream surge from {surgeEvent.sourceName}
                  </div>
                )}

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Sentinel Monitoring</div>
                  <div style={{ fontWeight: 700, color: '#60a5fa' }}>
                    {d?.sentinelLevel || '—'} ({d?.sentinelScore ?? 0})
                  </div>
                  {d?.etaHours && (
                    <div style={{ fontSize: '0.7rem', color: '#f59e0b' }}>
                      Downstream impact ~{d.etaHours.toFixed(1)}h
                    </div>
                  )}
                  {gaugeForecast && <Peak24hBadge forecast={gaugeForecast} />}
                </div>

                <div className="gauge-metrics">
                  <div className="metric">
                    <div className="metric-label">Level</div>
                    <div>
                      <span className="metric-value">{d?.height !== undefined ? d.height.toFixed(2) : '—'}</span>
                      <span className="metric-unit"> ft</span>
                    </div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Flow</div>
                    <div>
                      <span className="metric-value">{d?.flow !== undefined ? d.flow.toLocaleString() : '—'}</span>
                      <span className="metric-unit"> cfs</span>
                    </div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">1hr Change</div>
                    <div>
                      <span className="metric-value" style={{ fontSize: '1.5rem', color: rateColor }}>
                        {rate60 >= 0 ? '+' : ''}{rate60.toFixed(2)}
                      </span>
                      <span className="metric-unit"> ft</span>
                    </div>
                  </div>
                </div>

                {floodPct !== null && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginBottom: 4 }}>
                      <span>Flood stage progress</span>
                      <span style={{ color: floodPct > 85 ? 'var(--alert-red)' : floodPct > 65 ? 'var(--alert-orange)' : '#94a3b8' }}>
                        {floodPct.toFixed(0)}% ({g.floodStageFt} ft)
                      </span>
                    </div>
                    <div className="progress-bar-track">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(floodPct, 100)}%`,
                          background: floodPct > 90 ? 'var(--alert-red)' : floodPct > 65 ? 'var(--alert-orange)' : 'var(--alert-green)'
                        }}
                      />
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 12 }}>
                  <div className="metric-label" style={{ marginBottom: 0 }}>Past 48 Hours</div>
                  <Sparkline data={historyHeights} color={sparklineColor} height={44} />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <AhpsForecastSummary gauge={g} compact />
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

      <div className="glass-panel map-container-wrapper" style={{ padding: 0 }}>
        <RiverMap gauges={data} />
      </div>
    </>
  )
}
