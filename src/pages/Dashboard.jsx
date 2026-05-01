import React from 'react'
import { Link } from 'react-router-dom'
import { GAUGES } from '../config/gauges'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { formatCDT } from '../lib/formatTime'
import RiverMap from '../components/RiverMap'
import Sparkline from '../components/Sparkline'
import { AlertTriangle, Clock } from 'lucide-react'

export default function Dashboard({ data, surgeEvents }) {
  return (
    <>
      {surgeEvents?.length > 0 && (
        <div className="surge-banner">
          <AlertTriangle size={16} />
          <strong>Upstream Surge Alert:</strong>
          {surgeEvents.map((e, i) => (
            <span key={i}> {e.message}</span>
          ))}
        </div>
      )}

      <div className="dashboard-grid">
        {GAUGES.map(g => {
          const d = data[g.id]
          const alertClass = d?.alert || 'GREEN'
          const alertLabel = ALERT_LEVELS[alertClass]?.label || 'Normal'
          const surgeEvent = surgeEvents?.find(e => e.downstreamGaugeId === g.id)

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
                  <div className={`alert-badge ${alertClass}`}>
                    {alertLabel}
                  </div>
                </div>

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

                <div style={{ marginBottom: '16px' }}>
                  <div className="metric-label" style={{ marginBottom: '0' }}>Past 2 Hours</div>
                  <Sparkline data={historyHeights} color={sparklineColor} />
                </div>

                <div className="gauge-footer">
                  <div style={{ color: '#e2e8f0', fontWeight: '500' }}>
                    Gauge Updated: <span style={{ color: '#94a3b8' }}>{d?.time ? formatCDT(d.time) : '—'}</span>
                  </div>
                  <div style={{ color: '#60a5fa', fontWeight: '600' }}>View Details →</div>
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
