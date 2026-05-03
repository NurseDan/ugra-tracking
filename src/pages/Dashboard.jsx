import React from 'react'
import { Link } from 'react-router-dom'
import { GAUGES } from '../config/gauges'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { formatCDT } from '../lib/formatTime'
import RiverMap from '../components/RiverMap'
import Sparkline from '../components/Sparkline'
import NwsAlertsBanner from '../components/NwsAlertsBanner'
import BasinBriefingHeader from '../components/BasinBriefingHeader'
import ReservoirCard from '../components/ReservoirCard'
import AhpsForecastSummary from '../components/AhpsForecastSummary'
import { useSentinel } from '../contexts/SentinelContext'
import { AlertTriangle, Clock, ShieldAlert } from 'lucide-react'

export default function Dashboard() {
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

      <div className="dashboard-grid">
        {GAUGES.map(g => {
          const d = data[g.id]
          const alertClass = d?.alert || 'GREEN'
          const alertLabel = ALERT_LEVELS[alertClass]?.label || 'Normal'
          const surgeEvent = surgeEvents?.find(e => e.downstreamGaugeId === g.id)
          const gaugeAlerts = alertsForGauge(g.id)

          const historyHeights = d?.history
            ? d.history.map(h => h.height).filter(h => typeof h === 'number' && !isNaN(h))
            : []

          const sparklineColor = `var(--alert-${alertClass.toLowerCase()})`

          return (
            <Link to={`/gauge/${g.id}`} key={g.id} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="glass-panel gauge-card">
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
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Sentinel Monitoring</div>
                  <div style={{ fontWeight: 700, color: '#60a5fa' }}>
                    {d?.sentinelLevel || '—'} ({d?.sentinelScore ?? 0})
                  </div>
                  {d?.etaHours && (
                    <div style={{ fontSize: '0.7rem', color: '#f59e0b' }}>
                      Downstream impact ~{d.etaHours.toFixed(1)}h
                    </div>
                  )}
                </div>

                <div className="gauge-metrics">
                  <div className="metric">
                    <div className="metric-label">Water Level</div>
                    <div>
                      <span className="metric-value">{d?.height !== undefined ? d.height.toFixed(2) : '—'}</span>
                      <span className="metric-unit"> ft</span>
                    </div>
                  </div>
                  <div className="metric">
                    <div className="metric-label">Flow Rate</div>
                    <div>
                      <span className="metric-value">{d?.flow !== undefined ? d.flow.toLocaleString() : '—'}</span>
                      <span className="metric-unit"> cfs</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div className="metric-label" style={{ marginBottom: 0 }}>Past 2 Hours</div>
                  <Sparkline data={historyHeights} color={sparklineColor} />
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
