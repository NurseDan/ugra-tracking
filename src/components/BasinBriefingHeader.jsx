import React from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { RISK_META } from './GaugeBriefingCard'
import './BasinBriefingHeader.css'

export default function BasinBriefingHeader({
  briefing,
  loading = false,
  error = null,
  onRegenerate
}) {
  const meta = RISK_META[briefing?.riskLevel] || RISK_META.low
  const isUnavailable = Boolean(briefing?.unavailable)

  return (
    <div
      className="basin-briefing"
      style={{
        borderLeft: `3px solid ${meta.color}`,
        background: `linear-gradient(90deg, ${meta.color}22 0%, rgba(15,23,42,0.55) 60%)`
      }}
    >
      <div className="basin-briefing-icon" style={{ color: meta.color }}>
        <Activity size={18} />
      </div>
      <div className="basin-briefing-body">
        {loading && !briefing && (
          <div className="basin-briefing-skel">
            <div className="basin-skel-line" style={{ width: '40%' }} />
            <div className="basin-skel-line" style={{ width: '85%' }} />
          </div>
        )}
        {error && !briefing && (
          <div className="basin-briefing-error">Basin briefing failed: {error.message || String(error)}</div>
        )}
        {briefing && (
          <>
            <div className="basin-briefing-headline">
              {!isUnavailable && (
                <span className="basin-risk-chip" style={{ background: meta.color }}>
                  {meta.label}
                </span>
              )}
              <span>{briefing.headline}</span>
            </div>
            <div className="basin-briefing-summary">{briefing.summary}</div>
          </>
        )}
      </div>
      {onRegenerate && (
        <button
          type="button"
          className="basin-briefing-refresh"
          onClick={onRegenerate}
          disabled={loading}
          aria-label="Regenerate basin briefing"
          title="Regenerate basin briefing"
        >
          <RefreshCw size={14} className={loading ? 'basin-spin' : ''} />
        </button>
      )}
    </div>
  )
}
