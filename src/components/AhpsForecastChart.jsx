import { useMemo } from 'react'
import { useAhpsForecast } from '../hooks/useAhpsForecast.js'
import './AhpsForecastChart.css'

const THRESHOLDS = [
  { key: 'action', label: 'Action', color: '#facc15' },
  { key: 'minor', label: 'Minor', color: '#fb923c' },
  { key: 'moderate', label: 'Moderate', color: '#f87171' },
  { key: 'major', label: 'Major', color: '#fca5a5' }
]

function buildScales(observed, forecast, categories, width, height, padding) {
  const allPoints = [...observed, ...forecast]
  if (allPoints.length === 0) return null

  const stages = allPoints.map((p) => p.stage)
  const thresholdStages = Object.values(categories || {}).filter((v) =>
    Number.isFinite(v)
  )

  const minStage = Math.min(...stages, ...(thresholdStages.length ? thresholdStages : [Infinity]))
  const maxStage = Math.max(...stages, ...(thresholdStages.length ? thresholdStages : [-Infinity]))
  const stageRange = Math.max(0.5, maxStage - minStage)
  const yMin = minStage - stageRange * 0.05
  const yMax = maxStage + stageRange * 0.1

  const times = allPoints.map((p) => new Date(p.t).getTime()).filter(Number.isFinite)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tRange = tMax - tMin || 1

  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const xScale = (t) =>
    padding.left + ((new Date(t).getTime() - tMin) / tRange) * innerW
  const yScale = (s) =>
    padding.top + (1 - (s - yMin) / (yMax - yMin)) * innerH

  return { xScale, yScale, yMin, yMax, tMin, tMax, innerW, innerH }
}

function pathFor(points, scales) {
  if (!points || points.length === 0) return ''
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${scales.xScale(p.t).toFixed(1)},${scales
      .yScale(p.stage)
      .toFixed(1)}`)
    .join(' ')
}

export default function AhpsForecastChart({
  gauge,
  height = 220,
  width = 600,
  showLegend = true,
  className = ''
}) {
  const { observed, forecast, floodCategories, lid, loading, error } =
    useAhpsForecast(gauge)

  const padding = { top: 16, right: 12, bottom: 24, left: 40 }

  const scales = useMemo(
    () =>
      buildScales(observed, forecast, floodCategories, width, height, padding),
    [observed, forecast, floodCategories, width, height]
  )

  if (!lid) {
    return (
      <div className={`ahps-chart__empty ${className}`.trim()}>
        No official AHPS forecast for this gauge.
      </div>
    )
  }

  if (loading && observed.length === 0 && forecast.length === 0) {
    return (
      <div className={`ahps-chart__empty ${className}`.trim()} aria-busy="true">
        Loading official forecast…
      </div>
    )
  }

  if (error && observed.length === 0 && forecast.length === 0) {
    return (
      <div className={`ahps-chart__empty ${className}`.trim()}>
        Forecast unavailable: {error}
      </div>
    )
  }

  if (!scales) {
    return (
      <div className={`ahps-chart__empty ${className}`.trim()}>
        No forecast data published for {lid} right now.
      </div>
    )
  }

  const observedPath = pathFor(observed, scales)
  const forecastPath = pathFor(forecast, scales)
  const lastObserved = observed[observed.length - 1]
  const firstForecast = forecast[0]
  const bridge =
    lastObserved && firstForecast
      ? `M${scales.xScale(lastObserved.t).toFixed(1)},${scales
          .yScale(lastObserved.stage)
          .toFixed(1)} L${scales.xScale(firstForecast.t).toFixed(1)},${scales
          .yScale(firstForecast.stage)
          .toFixed(1)}`
      : ''

  const yTicks = 4
  const yStep = (scales.yMax - scales.yMin) / yTicks

  return (
    <div className={`ahps-chart ${className}`.trim()}>
      <svg
        className="ahps-chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`AHPS observed and forecast stage for ${lid}`}
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
                {v.toFixed(v > 50 ? 0 : 1)}
              </text>
            </g>
          )
        })}

        {/* flood category threshold lines */}
        {THRESHOLDS.map(({ key, label, color }) => {
          const stage = floodCategories?.[key]
          if (!Number.isFinite(stage)) return null
          if (stage < scales.yMin || stage > scales.yMax) return null
          const y = scales.yScale(stage)
          return (
            <g key={`th-${key}`} style={{ color }}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke={color}
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.7"
              />
              <text
                x={width - padding.right - 4}
                y={y - 3}
                textAnchor="end"
                className="ahps-chart__threshold-label"
              >
                {label} {stage} ft
              </text>
            </g>
          )
        })}

        {/* now-line: vertical separator between observed end & forecast start */}
        {lastObserved ? (
          <line
            x1={scales.xScale(lastObserved.t)}
            x2={scales.xScale(lastObserved.t)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="rgba(148,163,184,0.4)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        ) : null}

        {/* observed line */}
        {observedPath ? (
          <path
            d={observedPath}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {/* bridge between observed and forecast */}
        {bridge ? (
          <path
            d={bridge}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.2"
            strokeDasharray="3 3"
            opacity="0.6"
          />
        ) : null}

        {/* forecast line */}
        {forecastPath ? (
          <path
            d={forecastPath}
            fill="none"
            stroke="#c084fc"
            strokeWidth="2"
            strokeDasharray="6 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}

        {/* x-axis time bounds */}
        <text x={padding.left} y={height - 6} fontSize="10" fill="#94a3b8">
          {new Date(scales.tMin).toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            hour12: true
          })}
        </text>
        <text
          x={width - padding.right}
          y={height - 6}
          fontSize="10"
          fill="#94a3b8"
          textAnchor="end"
        >
          {new Date(scales.tMax).toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            hour12: true
          })}
        </text>
      </svg>

      {showLegend ? (
        <div className="ahps-chart__legend">
          <span className="ahps-chart__swatch ahps-chart__swatch--obs">
            <i /> Observed
          </span>
          <span className="ahps-chart__swatch ahps-chart__swatch--fcst">
            <i /> Forecast
          </span>
          {THRESHOLDS.map(({ key, label }) =>
            Number.isFinite(floodCategories?.[key]) ? (
              <span
                key={`lg-${key}`}
                className={`ahps-chart__swatch ahps-chart__swatch--${key}`}
              >
                <i /> {label} {floodCategories[key]} ft
              </span>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  )
}

export { AhpsForecastChart }
