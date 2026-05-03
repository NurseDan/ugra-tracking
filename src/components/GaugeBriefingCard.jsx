import React, { useState } from 'react'
import { Cpu, RefreshCw, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import './GaugeBriefingCard.css'

const RISK_META = {
  low: { label: 'Low', color: '#10b981' },
  watch: { label: 'Watch', color: '#f59e0b' },
  warning: { label: 'Warning', color: '#f97316' },
  critical: { label: 'Critical', color: '#ef4444' }
}

function riskMeta(level) {
  return RISK_META[level] || RISK_META.low
}

function formatTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Chicago'
    })
  } catch {
    return ''
  }
}

export default function GaugeBriefingCard({
  briefing,
  loading = false,
  error = null,
  context = null,
  onRegenerate,
  fetchedAt = 0
}) {
  const [open, setOpen] = useState(false)
  const meta = riskMeta(briefing?.riskLevel)
  const isUnavailable = Boolean(briefing?.unavailable)

  return (
    <div className="briefing-card glass-panel" style={{ borderLeft: `4px solid ${meta.color}` }}>
      <div className="briefing-header">
        <h3>
          <Cpu size={20} color={meta.color} />
          AI Surge Briefing
          {briefing && !isUnavailable && (
            <span className="risk-pill" style={{ background: meta.color }}>
              {meta.label}
            </span>
          )}
        </h3>
        <button
          type="button"
          className="briefing-action"
          onClick={onRegenerate}
          disabled={loading}
          aria-label="Regenerate briefing"
          title="Regenerate"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          {loading ? 'Generating…' : 'Regenerate'}
        </button>
      </div>

      {loading && !briefing && (
        <div className="briefing-skeleton">
          <div className="skel skel-line" style={{ width: '60%' }} />
          <div className="skel skel-line" />
          <div className="skel skel-line" style={{ width: '85%' }} />
        </div>
      )}

      {error && !briefing && (
        <div className="briefing-error">
          <AlertCircle size={16} />
          <span>Briefing failed: {error.message || String(error)}</span>
        </div>
      )}

      {briefing && (
        <>
          <div className="briefing-headline">{briefing.headline}</div>
          <p className="briefing-summary">{briefing.summary}</p>

          {briefing.keyFactors?.length > 0 && (
            <ul className="briefing-factors">
              {briefing.keyFactors.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}

          <div className="briefing-meta">
            {!isUnavailable && (
              <span>
                Confidence: {Math.round((briefing.confidence ?? 0) * 100)}%
              </span>
            )}
            {fetchedAt > 0 && <span>Generated {formatTime(briefing.generatedAt)}</span>}
          </div>

          {context && (
            <div className="briefing-inputs">
              <button
                type="button"
                className="briefing-toggle"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
              >
                {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                What went into this?
              </button>
              {open && (
                <pre className="briefing-context">{JSON.stringify(context, null, 2)}</pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export { RISK_META }
