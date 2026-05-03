import React, { useState, useCallback, useRef } from 'react'
import { RefreshCw, TrendingUp, AlertTriangle, Info } from 'lucide-react'
import { generateRiseForecast, getPeak24h } from '../lib/riseForecast'
import { formatCDT } from '../lib/formatTime'

const PANEL_H = 220
const PADDING = { top: 16, right: 16, bottom: 32, left: 52 }

function formatShortTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true })
}

function categoryColor(cat) {
  if (!cat) return '#94a3b8'
  if (cat.includes('Major')) return '#991b1b'
  if (cat.includes('Moderate')) return '#ef4444'
  if (cat.includes('Minor')) return '#f97316'
  if (cat.includes('Action')) return '#f59e0b'
  return '#10b981'
}

function ForecastSvg({ forecast, observedTail, currentStage, floodStageFt }) {
  const W = 900
  const H = PANEL_H
  const chartW = W - PADDING.left - PADDING.right
  const chartH = H - PADDING.top - PADDING.bottom

  const forecastPoints = forecast?.points || []
  const tailPoints = observedTail || []

  const allStages = [
    ...tailPoints.map(p => p.height).filter(v => v !== null && v !== undefined),
    ...forecastPoints.map(p => p.stageFt),
    ...forecastPoints.map(p => p.high)
  ]
  if (floodStageFt) allStages.push(floodStageFt)

  const minVal = allStages.length ? Math.min(...allStages) : 0
  const maxVal = allStages.length ? Math.max(...allStages) : 10
  const range = maxVal - minVal || 1
  const yMin = Math.max(0, minVal - range * 0.1)
  const yMax = maxVal + range * 0.15

  const now = Date.now()
  const tailStart = tailPoints.length ? new Date(tailPoints[0].time).getTime() : now - 6 * 3600000
  const forecastEnd = forecastPoints.length ? new Date(forecastPoints[forecastPoints.length - 1].t).getTime() : now + 72 * 3600000
  const timeRange = forecastEnd - tailStart || 1

  function xPos(ts) {
    return PADDING.left + ((ts - tailStart) / timeRange) * chartW
  }
  function yPos(val) {
    return PADDING.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH
  }

  const nowX = xPos(now)

  const tailPoly = tailPoints.length >= 2
    ? tailPoints.map(p => `${xPos(new Date(p.time).getTime()).toFixed(1)},${yPos(p.height).toFixed(1)}`).join(' ')
    : ''

  const fcPoly = forecastPoints.map(p => `${xPos(new Date(p.t).getTime()).toFixed(1)},${yPos(p.stageFt).toFixed(1)}`).join(' ')

  const bandPoints = forecastPoints.length >= 2 ? [
    ...forecastPoints.map(p => `${xPos(new Date(p.t).getTime()).toFixed(1)},${yPos(p.high).toFixed(1)}`),
    ...[...forecastPoints].reverse().map(p => `${xPos(new Date(p.t).getTime()).toFixed(1)},${yPos(p.low).toFixed(1)}`)
  ].join(' ') : ''

  const floodY = floodStageFt ? yPos(floodStageFt) : null
  const floodInRange = floodY !== null && floodY >= PADDING.top && floodY <= PADDING.top + chartH

  const peakPt = forecast?.peak
  const peakX = peakPt ? xPos(new Date(peakPt.time).getTime()) : null
  const peakY = peakPt ? yPos(peakPt.stageFt) : null

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * (i / 4))
  const xLabels = [
    { ts: now, label: 'Now' },
    { ts: now + 24 * 3600000, label: '+24h' },
    { ts: now + 48 * 3600000, label: '+48h' },
    { ts: now + 72 * 3600000, label: '+72h' }
  ]

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
      {yTicks.map((val, i) => (
        <g key={i}>
          <line x1={PADDING.left} y1={yPos(val)} x2={PADDING.left + chartW} y2={yPos(val)}
            stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          <text x={PADDING.left - 6} y={yPos(val) + 4} textAnchor="end" fill="#64748b" fontSize={11}>
            {val.toFixed(1)}
          </text>
        </g>
      ))}

      {xLabels.map(({ ts, label }, i) => {
        const x = xPos(ts)
        if (x < PADDING.left || x > PADDING.left + chartW) return null
        return (
          <g key={i}>
            <line x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + chartH}
              stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray={i === 0 ? 'none' : '4,4'} />
            <text x={x} y={PADDING.top + chartH + 18} textAnchor="middle" fill="#64748b" fontSize={10}>
              {label}
            </text>
          </g>
        )
      })}

      {floodInRange && (
        <g>
          <line x1={PADDING.left} y1={floodY} x2={PADDING.left + chartW} y2={floodY}
            stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6,4" />
          <text x={PADDING.left + 4} y={floodY - 5} fill="#ef4444" fontSize={9} fontWeight="600">
            Flood {floodStageFt}ft
          </text>
        </g>
      )}

      <rect x={nowX} y={PADDING.top} width={PADDING.left + chartW - nowX} height={chartH}
        fill="rgba(96,165,250,0.04)" />
      <line x1={nowX} y1={PADDING.top} x2={nowX} y2={PADDING.top + chartH}
        stroke="rgba(96,165,250,0.5)" strokeWidth={1.5} />

      {bandPoints && (
        <polygon points={bandPoints} fill="#60a5fa" fillOpacity={0.12} stroke="none" />
      )}

      {tailPoly && (
        <polyline fill="none" stroke="#60a5fa" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          points={tailPoly} />
      )}

      {fcPoly && (
        <polyline fill="none" stroke="#a78bfa" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="6,3" points={fcPoly} />
      )}

      {peakX !== null && peakY !== null && peakX >= PADDING.left && peakX <= PADDING.left + chartW && (
        <g>
          <circle cx={peakX} cy={peakY} r={5} fill="#f97316" stroke="#fff" strokeWidth={2} />
          <text x={peakX} y={peakY - 10} textAnchor="middle" fill="#f97316" fontSize={10} fontWeight="700">
            {forecast.peak.stageFt.toFixed(1)}ft
          </text>
        </g>
      )}

      <text x={PADDING.left - 36} y={PADDING.top + chartH / 2} textAnchor="middle" fill="#64748b" fontSize={11}
        transform={`rotate(-90, ${PADDING.left - 36}, ${PADDING.top + chartH / 2})`}>
        Stage (ft)
      </text>
    </svg>
  )
}

export default function RiseForecastPanel({ siteId, history, floodStageFt, floodCategories, ahpsForecast, streamflowForecast, initialForecast }) {
  const [forecast, setForecast] = useState(initialForecast || null)
  const [loading, setLoading] = useState(!initialForecast)
  const [error, setError] = useState(null)
  const generatingRef = useRef(false)

  const generate = useCallback(async (forceRefresh = false) => {
    if (!siteId || !history || history.length === 0) return
    if (generatingRef.current) return
    generatingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const result = await generateRiseForecast(siteId, history, {
        forceRefresh,
        ahpsForecast,
        streamflowForecast
      })
      if (result) setForecast(result)
      else setError('Forecast could not be generated')
    } catch (err) {
      setError(err?.message || 'Forecast failed')
    } finally {
      generatingRef.current = false
      setLoading(false)
    }
  }, [siteId, history, ahpsForecast, streamflowForecast])

  React.useEffect(() => {
    if (!initialForecast && history && history.length > 0) {
      generate(false)
    }
  }, [siteId, history?.length])

  const catColor = forecast?.peak ? categoryColor(forecast.peak.category) : '#94a3b8'
  const observedTail = history
    ? history
        .filter(p => p.height !== null && p.height !== undefined)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
        .slice(-48)
    : []

  return (
    <div className="glass-panel" style={{ borderLeft: `4px solid ${catColor}`, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f8fafc', margin: 0 }}>
          <TrendingUp size={20} color={catColor} />
          Rise Forecast (72-hour)
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.7rem', color: '#64748b', fontStyle: 'italic' }}>
            Experimental — not an official forecast
          </span>
          <button
            onClick={() => generate(true)}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.75rem'
            }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'Generating...' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading && !forecast && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#94a3b8', padding: '24px 0' }}>
          <div className="loading-spinner" style={{ width: 16, height: 16 }} />
          Generating forecast...
        </div>
      )}

      {error && !forecast && (
        <div style={{ color: '#f97316', fontSize: '0.875rem', padding: '12px 0' }}>
          <AlertTriangle size={14} style={{ display: 'inline', marginRight: 6 }} />
          {error}
        </div>
      )}

      {forecast && (
        <>
          {(ahpsForecast || streamflowForecast) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {ahpsForecast && (
                <span style={{ fontSize: '0.7rem', color: '#60a5fa', background: 'rgba(96,165,250,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(96,165,250,0.25)' }}>
                  AHPS official peak {ahpsForecast.peakFt.toFixed(1)}ft fused
                </span>
              )}
              {streamflowForecast && (
                <span style={{ fontSize: '0.7rem', color: '#a78bfa', background: 'rgba(167,139,250,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(167,139,250,0.25)' }}>
                  {streamflowForecast.source?.toUpperCase() || 'NWM'} peak {streamflowForecast.peakCfs.toLocaleString()} cfs fused
                </span>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Peak Stage</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: catColor }}>
                {forecast.peak.stageFt.toFixed(1)} ft
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{formatShortTime(forecast.peak.time)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Category</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: catColor }}>{forecast.peak.category}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Confidence</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0' }}>
                {Math.round((forecast.confidence || 0) * 100)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 }}>Provider</div>
              <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {forecast.provider === 'llm' ? 'AI-assisted' : 'Deterministic'}
              </div>
            </div>
          </div>

          <ForecastSvg
            forecast={forecast}
            observedTail={observedTail}
            currentStage={observedTail.length ? observedTail[observedTail.length - 1].height : 0}
            floodStageFt={floodStageFt}
          />

          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
            <p style={{ color: '#e2e8f0', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{forecast.narrative}</p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {forecast.sources?.map((s, i) => (
                <span key={i} style={{ fontSize: '0.7rem', color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4 }}>
                  {s}
                </span>
              ))}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
              Generated {formatCDT(forecast.generatedAt)}
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6, padding: '8px 12px', background: 'rgba(248,197,93,0.08)', border: '1px solid rgba(248,197,93,0.2)', borderRadius: 6 }}>
            <Info size={12} color="#f59e0b" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.5 }}>
              This is an experimental model-based estimate, not an official NWS or AHPS forecast. For life-safety decisions, consult official sources.
            </span>
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

export { categoryColor }
