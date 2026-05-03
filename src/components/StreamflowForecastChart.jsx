import { useMemo } from 'react'
import { useStreamflowForecast } from '../hooks/useStreamflowForecast.js'
import './StreamflowForecastChart.css'

const SOURCE_LABEL = {
  nwm: 'NOAA NWM',
  'open-meteo': 'Open-Meteo / GloFAS',
  none: 'No forecast'
}

function buildScales(series, observed, threshold, width, height, padding) {
  const all = [
    ...series.map((p) => ({ t: p.t, q: p.q })),
    ...series.filter((p) => Number.isFinite(p.qLow)).map((p) => ({ t: p.t, q: p.qLow })),
    ...series.filter((p) => Number.isFinite(p.qHigh)).map((p) => ({ t: p.t, q: p.qHigh })),
    ...(observed ? [observed] : [])
  ]
  if (all.length === 0) return null

  const flows = all.map((p) => p.q).filter(Number.isFinite)
  const thresholdFlows = Number.isFinite(threshold) ? [threshold] : []
  const yMinRaw = Math.min(...flows, ...thresholdFlows)
  const yMaxRaw = Math.max(...flows, ...thresholdFlows)
  const range = Math.max(0.5, yMaxRaw - yMinRaw)
  const yMin = Math.max(0, yMinRaw - range * 0.05)
  const yMax = yMaxRaw + range * 0.1

  const times = all.map((p) => new Date(p.t).getTime()).filter(Number.isFinite)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tRange = tMax - tMin || 1

  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  return {
    xScale: (t) =>
      padding.left + ((new Date(t).getTime() - tMin) / tRange) * innerW,
    yScale: (q) => padding.top + (1 - (q - yMin) / (yMax - yMin)) * innerH,
    yMin,
    yMax,
    tMin,
    tMax
  }
}

function formatFlow(q) {
  if (!Number.isFinite(q)) return ''
  if (q >= 10000) return `${(q / 1000).toFixed(1)}k`
  if (q >= 1000) return `${Math.round(q)}`
  return q.toFixed(q < 10 ? 1 : 0)
}

export default function StreamflowForecastChart({
  gauge,
  height = 220,
  width = 600,
  observedFlow = null,
  observedTime = null,
  className = ''
}) {
  const { source, series, updated, loading, error } = useStreamflowForecast(gauge)
  const padding = { top: 16, right: 12, bottom: 26, left: 48 }
  const threshold = Number.isFinite(gauge?.floodFlowCfs)
    ? gauge.floodFlowCfs
    : null

  const observedPoint =
    Number.isFinite(observedFlow) && observedTime
      ? { t: observedTime, q: observedFlow }
      : null

  const scales = useMemo(
    () => buildScales(series, observedPoint, threshold, width, height, padding),
    [series, observedPoint, threshold, width, height]
  )

  if (!gauge) {
    return <div className={`streamflow-chart__empty ${className}`.trim()}>No gauge selected.</div>
  }

  if (loading && series.length === 0) {
    return (
      <div className={`streamflow-chart__empty ${className}`.trim()} aria-busy="true">
        Loading streamflow forecast…
      </div>
    )
  }

  if (source === 'none' || !scales) {
    return (
      <div className={`streamflow-chart__empty ${className}`.trim()}>
        {error
          ? `Forecast unavailable: ${error}`
          : 'No streamflow forecast available for this location.'}
      </div>
    )
  }

  // Build paths
  const medianPath = series
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${scales.xScale(p.t).toFixed(1)},${scales.yScale(p.q).toFixed(1)}`
    )
    .join(' ')

  const bandPoints = series.filter(
    (p) => Number.isFinite(p.qLow) && Number.isFinite(p.qHigh)
  )
  let bandPath = ''
  if (bandPoints.length >= 2) {
    const top = bandPoints
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${scales.xScale(p.t).toFixed(1)},${scales.yScale(p.qHigh).toFixed(1)}`
      )
      .join(' ')
    const bottom = bandPoints
      .slice()
      .reverse()
      .map(
        (p) => `L${scales.xScale(p.t).toFixed(1)},${scales.yScale(p.qLow).toFixed(1)}`
      )
      .join(' ')
    bandPath = `${top} ${bottom} Z`
  }

  const yTicks = 4
  const yStep = (scales.yMax - scales.yMin) / yTicks

  return (
    <div className={`streamflow-chart ${className}`.trim()}>
      <div className="streamflow-chart__header">
        <span className={`streamflow-chart__source streamflow-chart__source--${source}`}>
          {SOURCE_LABEL[source] || source}
        </span>
        {updated ? (
          <span>
            Updated{' '}
            {new Date(updated).toLocaleString('en-US', {
              timeZone: 'America/Chicago',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })}
          </span>
        ) : null}
      </div>

      <svg
        className="streamflow-chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Streamflow forecast for ${gauge.shortName || gauge.name || 'gauge'}`}
      >
        {/* y-axis grid + labels */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = scales.yMin + yStep * i
          const y = scales.yScale(v)
          return (
            <g key={`yt-${i}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="rgba(148,163,184,0.12)"
                strokeWidth="1"
              />
              <text
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill="#94a3b8"
              >
                {formatFlow(v)}
              </text>
            </g>
          )
        })}

        {/* Confidence band */}
        {bandPath ? (
          <path
            d={bandPath}
            fill="rgba(96,165,250,0.18)"
            stroke="rgba(96,165,250,0.35)"
            strokeWidth="1"
          />
        ) : null}

        {/* Median forecast line */}
        {medianPath ? (
          <path
            d={medianPath}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {/* Threshold line (flood-flow cfs if known) */}
        {Number.isFinite(threshold) && threshold >= scales.yMin && threshold <= scales.yMax ? (
          <g>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scales.yScale(threshold)}
              y2={scales.yScale(threshold)}
              stroke="#f87171"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.8"
            />
            <text
              x={width - padding.right - 4}
              y={scales.yScale(threshold) - 3}
              textAnchor="end"
              fontSize="9"
              fill="#fca5a5"
              style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              Flood flow {formatFlow(threshold)} cfs
            </text>
          </g>
        ) : null}

        {/* Last observed dot for continuity */}
        {observedPoint &&
        new Date(observedPoint.t).getTime() >= scales.tMin &&
        new Date(observedPoint.t).getTime() <= scales.tMax ? (
          <g>
            <circle
              cx={scales.xScale(observedPoint.t)}
              cy={scales.yScale(observedPoint.q)}
              r="4"
              fill="#facc15"
              stroke="#1e293b"
              strokeWidth="1.5"
            />
            <text
              x={scales.xScale(observedPoint.t) + 6}
              y={scales.yScale(observedPoint.q) - 6}
              fontSize="10"
              fill="#facc15"
            >
              Now {formatFlow(observedPoint.q)}
            </text>
          </g>
        ) : null}

        {/* x-axis bounds */}
        <text x={padding.left} y={height - 6} fontSize="10" fill="#94a3b8">
          {new Date(scales.tMin).toLocaleDateString('en-US', {
            timeZone: 'America/Chicago',
            month: 'short',
            day: 'numeric'
          })}
        </text>
        <text
          x={width - padding.right}
          y={height - 6}
          fontSize="10"
          fill="#94a3b8"
          textAnchor="end"
        >
          {new Date(scales.tMax).toLocaleDateString('en-US', {
            timeZone: 'America/Chicago',
            month: 'short',
            day: 'numeric'
          })}
        </text>
      </svg>

      <div className="streamflow-chart__legend">
        <span className="streamflow-chart__swatch streamflow-chart__swatch--median">
          <i /> Median (cfs)
        </span>
        {bandPath ? (
          <span className="streamflow-chart__swatch streamflow-chart__swatch--band">
            <i /> Min–Max range
          </span>
        ) : null}
        {Number.isFinite(threshold) ? (
          <span className="streamflow-chart__swatch streamflow-chart__swatch--threshold">
            <i /> Flood flow
          </span>
        ) : null}
        {observedPoint ? (
          <span className="streamflow-chart__swatch streamflow-chart__swatch--observed">
            <i /> Last observed
          </span>
        ) : null}
      </div>
    </div>
  )
}

export { StreamflowForecastChart }
