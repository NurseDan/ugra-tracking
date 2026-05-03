import { useEffect, useMemo, useState } from 'react'
import { sortAlertsBySeverity } from '../lib/nwsAlerts.js'

const SESSION_KEY = 'nws-dismissed-alerts'

function loadDismissed() {
  if (typeof sessionStorage === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function persistDismissed(set) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

function severityClass(severity) {
  switch (severity) {
    case 'Extreme': return 'nws-alert--extreme'
    case 'Severe': return 'nws-alert--severe'
    case 'Moderate': return 'nws-alert--moderate'
    case 'Minor': return 'nws-alert--minor'
    default: return 'nws-alert--unknown'
  }
}

function formatExpiry(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  } catch {
    return ''
  }
}

export default function NwsAlertsBanner({ alerts = [], compact = false, showAllClear = false }) {
  const [dismissed, setDismissed] = useState(() => loadDismissed())

  useEffect(() => {
    persistDismissed(dismissed)
  }, [dismissed])

  const visible = useMemo(() => {
    const sorted = sortAlertsBySeverity(alerts)
    return sorted.filter((a) => !dismissed.has(a.id))
  }, [alerts, dismissed])

  if (visible.length === 0) {
    if (showAllClear) {
      return (
        <div className="nws-allclear-pill" role="status">
          <span className="nws-allclear-dot" />
          No active flood alerts
        </div>
      )
    }
    return null
  }

  const dismiss = (id) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  return (
    <div className={`nws-alerts-stack ${compact ? 'nws-alerts-stack--compact' : ''}`} role="region" aria-label="Active NWS flood alerts">
      {visible.map((alert) => (
        <article
          key={alert.id || alert.headline}
          className={`nws-alert ${severityClass(alert.severity)}`}
          aria-live="polite"
        >
          <div className="nws-alert__header">
            <div className="nws-alert__event">
              <span className="nws-alert__badge">{alert.severity || 'Alert'}</span>
              <span className="nws-alert__title">{alert.event}</span>
            </div>
            <button
              type="button"
              className="nws-alert__dismiss"
              aria-label="Dismiss alert"
              onClick={() => dismiss(alert.id || alert.headline)}
            >
              ×
            </button>
          </div>
          <p className="nws-alert__headline">{alert.headline}</p>
          {!compact && alert.areaDesc ? (
            <p className="nws-alert__area"><strong>Affected:</strong> {alert.areaDesc}</p>
          ) : null}
          <div className="nws-alert__meta">
            {alert.expires ? <span>Expires {formatExpiry(alert.expires)}</span> : null}
            {alert.sender ? <span>{alert.sender}</span> : null}
          </div>
        </article>
      ))}
    </div>
  )
}
