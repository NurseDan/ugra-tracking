import React, { useState, useRef, useCallback } from 'react'

const PADDING = { top: 20, right: 16, bottom: 40, left: 52 }
const FLOOD_COLORS = {
  normal: '#10b981',
  action: '#f59e0b',
  minor: '#f97316',
  moderate: '#ef4444',
  major: '#991b1b'
}

function formatAxisDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTooltipTime(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

function deriveThresholds(floodStageFt, floodCategories) {
  if (floodCategories) {
    return [
      { label: 'Action', value: floodCategories.action, color: '#f59e0b' },
      { label: 'Minor', value: floodCategories.minor, color: '#f97316' },
      { label: 'Moderate', value: floodCategories.moderate, color: '#ef4444' },
      { label: 'Major', value: floodCategories.major, color: '#991b1b' }
    ].filter(t => t.value !== null && t.value !== undefined && Number.isFinite(t.value))
  }
  if (!floodStageFt) return []
  return [
    { label: 'Action', value: parseFloat((floodStageFt * 0.82).toFixed(1)), color: '#f59e0b' },
    { label: 'Minor (Flood)', value: floodStageFt, color: '#f97316' },
    { label: 'Moderate', value: parseFloat((floodStageFt * 1.25).toFixed(1)), color: '#ef4444' },
    { label: 'Major', value: parseFloat((floodStageFt * 1.6).toFixed(1)), color: '#991b1b' }
  ]
}

export default function HistoryChart({ history, floodStageFt, floodCategories, height = 280, showFlow = false }) {
  const [tooltip, setTooltip] = useState(null)
  const [displayFlow, setDisplayFlow] = useState(showFlow)
  const svgRef = useRef(null)

  const points = history
    ? history.filter(p => {
        const val = displayFlow ? p.flow : p.height
        return val !== null && val !== undefined && typeof val === 'number' && !isNaN(val)
      })
    : []

  const hasFlow = history ? history.some(p => p.flow !== null && p.flow !== undefined) : false

  const W = 900
  const H = height
  const chartW = W - PADDING.left - PADDING.right
  const chartH = H - PADDING.top - PADDING.bottom

  const values = points.map(p => displayFlow ? p.flow : p.height)
  const times = points.map(p => new Date(p.time).getTime())

  const minVal = values.length ? Math.min(...values) : 0
  const maxVal = values.length ? Math.max(...values) : 10
  const rawRange = maxVal - minVal
  const pad = rawRange < 1 ? 0.5 : rawRange * 0.1
  const yMin = Math.max(0, minVal - pad)
  const yMax = maxVal + pad

  const minTime = times.length ? Math.min(...times) : Date.now() - 14 * 86400000
  const maxTime = times.length ? Math.max(...times) : Date.now()
  const timeRange = maxTime - minTime || 1

  function xPos(ts) {
    return PADDING.left + ((ts - minTime) / timeRange) * chartW
  }

  function yPos(val) {
    return PADDING.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH
  }

  const polylinePoints = points.map(p => {
    const ts = new Date(p.time).getTime()
    const val = displayFlow ? p.flow : p.height
    return `${xPos(ts).toFixed(1)},${yPos(val).toFixed(1)}`
  }).join(' ')

  const areaPoints = points.length >= 2
    ? `${xPos(times[0]).toFixed(1)},${(PADDING.top + chartH).toFixed(1)} ${polylinePoints} ${xPos(times[times.length - 1]).toFixed(1)},${(PADDING.top + chartH).toFixed(1)}`
    : ''

  const thresholds = !displayFlow ? deriveThresholds(floodStageFt, floodCategories) : []
  const visibleThresholds = thresholds
    .map(t => ({ ...t, y: yPos(t.value) }))
    .filter(t => t.y >= PADDING.top && t.y <= PADDING.top + chartH)

  const yTickCount = 5
  const yTicks = Array.from({ length: yTickCount }, (_, i) => yMin + (yMax - yMin) * (i / (yTickCount - 1)))

  const xTickCount = 7
  const xTicks = Array.from({ length: xTickCount }, (_, i) => minTime + (timeRange * i) / (xTickCount - 1))

  const handleMouseMove = useCallback((e) => {
    if (!svgRef.current || points.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * W
    const chartRelX = mouseX - PADDING.left
    const ratio = Math.max(0, Math.min(1, chartRelX / chartW))
    const targetTime = minTime + ratio * timeRange

    let closest = points[0]
    let closestDiff = Infinity
    for (const p of points) {
      const diff = Math.abs(new Date(p.time).getTime() - targetTime)
      if (diff < closestDiff) {
        closestDiff = diff
        closest = p
      }
    }

    if (closest) {
      const ts = new Date(closest.time).getTime()
      const val = displayFlow ? closest.flow : closest.height
      setTooltip({
        x: xPos(ts),
        y: yPos(val),
        time: closest.time,
        height: closest.height,
        flow: closest.flow
      })
    }
  }, [points, minTime, timeRange, chartW, displayFlow])

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  if (points.length < 2) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
        Insufficient history data for chart
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      {hasFlow && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setDisplayFlow(false)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
              background: !displayFlow ? '#60a5fa' : 'rgba(255,255,255,0.1)',
              color: !displayFlow ? '#0f172a' : '#94a3b8'
            }}>
            Stage (ft)
          </button>
          <button
            onClick={() => setDisplayFlow(true)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
              background: displayFlow ? '#60a5fa' : 'rgba(255,255,255,0.1)',
              color: displayFlow ? '#0f172a' : '#94a3b8'
            }}>
            Flow (cfs)
          </button>
        </div>
      )}

      <svg
        ref={svgRef}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {yTicks.map((val, i) => {
          const y = yPos(val)
          return (
            <g key={i}>
              <line x1={PADDING.left} y1={y} x2={PADDING.left + chartW} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={PADDING.left - 6} y={y + 4} textAnchor="end" fill="#64748b" fontSize={11}>
                {displayFlow ? (val > 999 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)) : val.toFixed(1)}
              </text>
            </g>
          )
        })}

        {xTicks.map((ts, i) => {
          const x = xPos(ts)
          const label = formatAxisDate(new Date(ts).toISOString())
          return (
            <g key={i}>
              <line x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + chartH}
                stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={x} y={PADDING.top + chartH + 16} textAnchor="middle" fill="#64748b" fontSize={10}>
                {label}
              </text>
            </g>
          )
        })}

        {visibleThresholds.map((t, i) => (
          <g key={i}>
            <line x1={PADDING.left} y1={t.y} x2={PADDING.left + chartW} y2={t.y}
              stroke={t.color} strokeWidth={1.5} strokeDasharray="6,4" opacity={0.85} />
            <text x={PADDING.left + chartW - 4} y={t.y - 4} textAnchor="end" fill={t.color} fontSize={10} fontWeight="600">
              {t.label} {t.value}ft
            </text>
          </g>
        ))}

        {areaPoints && (
          <polygon
            points={areaPoints}
            fill="#60a5fa"
            fillOpacity={0.1}
            stroke="none"
          />
        )}

        <polyline
          fill="none"
          stroke="#60a5fa"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polylinePoints}
        />

        {tooltip && (
          <g>
            <line x1={tooltip.x} y1={PADDING.top} x2={tooltip.x} y2={PADDING.top + chartH}
              stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="4,3" />
            <circle cx={tooltip.x} cy={tooltip.y} r={4} fill="#60a5fa" stroke="#fff" strokeWidth={2} />
          </g>
        )}

        <text x={PADDING.left - 36} y={PADDING.top + chartH / 2} textAnchor="middle" fill="#64748b" fontSize={11}
          transform={`rotate(-90, ${PADDING.left - 36}, ${PADDING.top + chartH / 2})`}>
          {displayFlow ? 'Flow (cfs)' : 'Stage (ft)'}
        </text>
      </svg>

      {tooltip && (
        <div style={{
          position: 'absolute',
          top: Math.max(4, tooltip.y - PADDING.top - 60),
          left: `${Math.max(5, Math.min(85, (tooltip.x / W) * 100))}%`,
          transform: 'translateX(-50%)',
          background: 'rgba(15,23,42,0.95)',
          border: '1px solid rgba(96,165,250,0.4)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: '0.75rem',
          pointerEvents: 'none',
          zIndex: 10,
          minWidth: 140,
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ color: '#94a3b8', marginBottom: 4 }}>{formatTooltipTime(tooltip.time)}</div>
          {tooltip.height !== null && tooltip.height !== undefined && (
            <div style={{ color: '#60a5fa', fontWeight: 600 }}>Stage: {tooltip.height.toFixed(2)} ft</div>
          )}
          {tooltip.flow !== null && tooltip.flow !== undefined && (
            <div style={{ color: '#a78bfa', fontWeight: 600 }}>Flow: {tooltip.flow.toLocaleString()} cfs</div>
          )}
        </div>
      )}
    </div>
  )
}
