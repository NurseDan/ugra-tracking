import { useAhpsForecast } from '../hooks/useAhpsForecast.js'
import {
  next24hCrest,
  highestForecastCategory
} from '../lib/ahps.js'
import './AhpsForecastChart.css'

const CATEGORY_LABEL = {
  action: 'Action',
  minor: 'Minor Flood',
  moderate: 'Moderate Flood',
  major: 'Major Flood'
}

function formatCrestTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

export default function AhpsForecastSummary({ gauge, compact = false, className = '' }) {
  const { lid, forecast, floodCategories, loading, error } = useAhpsForecast(gauge)

  if (!lid) {
    return (
      <span className={`ahps-summary ${compact ? 'ahps-summary--compact' : ''} ${className}`.trim()}>
        <span className="ahps-summary__label">AHPS</span>
        <span style={{ opacity: 0.7 }}>No official forecast</span>
      </span>
    )
  }

  if (loading && forecast.length === 0) {
    return (
      <span
        className={`ahps-summary ${compact ? 'ahps-summary--compact' : ''} ${className}`.trim()}
        aria-busy="true"
      >
        <span className="ahps-summary__label">AHPS</span>
        <span style={{ opacity: 0.7 }}>Loading…</span>
      </span>
    )
  }

  if (error && forecast.length === 0) {
    return (
      <span className={`ahps-summary ${compact ? 'ahps-summary--compact' : ''} ${className}`.trim()}>
        <span className="ahps-summary__label">AHPS</span>
        <span style={{ opacity: 0.7 }}>Forecast unavailable</span>
      </span>
    )
  }

  const crest = next24hCrest(forecast, floodCategories)
  // Align category window with the 24h crest window so the badge label
  // matches what the user sees in the headline.
  const peakCat = highestForecastCategory(forecast, floodCategories, {
    withinMs: 24 * 60 * 60 * 1000
  })

  if (!crest) {
    return (
      <span className={`ahps-summary ${compact ? 'ahps-summary--compact' : ''} ${className}`.trim()}>
        <span className="ahps-summary__label">AHPS</span>
        <span style={{ opacity: 0.85 }}>No active 24h forecast</span>
      </span>
    )
  }

  const cat = peakCat || crest.category
  const catKey = cat || 'none'
  const catLabel = cat ? CATEGORY_LABEL[cat] : 'No Flood'

  return (
    <span
      className={`ahps-summary ${compact ? 'ahps-summary--compact' : ''} ${className}`.trim()}
      title={`Highest forecast category in next 24h: ${catLabel}`}
    >
      <span className="ahps-summary__label">AHPS Crest</span>
      <span className="ahps-summary__crest">
        {crest.stage.toFixed(1)} ft @ {formatCrestTime(crest.t)}
      </span>
      <span className={`ahps-summary__cat ahps-summary__cat--${catKey}`}>{catLabel}</span>
    </span>
  )
}

export { AhpsForecastSummary }
