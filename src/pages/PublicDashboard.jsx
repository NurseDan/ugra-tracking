// PublicDashboard.jsx
// Issues #1, #2, #4: Public-facing community flood awareness dashboard
// Mobile-first, hero panel, gauge cards, map, incident log, disclaimers
import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { GAUGES } from '../config/gauges'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { formatCDT } from '../lib/formatTime'
import { useSentinel } from '../contexts/SentinelContext'
import RiverMap from '../components/RiverMap'
import PublicDisclaimer from '../components/PublicDisclaimer'
import { Clock, TrendingUp, Droplets, AlertTriangle } from 'lucide-react'

function getOverallStatus(data) {
  const alerts = Object.values(data).map(d => d?.alert || 'GREEN')
  if (alerts.some(a => a === 'BLACK')) return { level: 'BLACK', label: 'CRITICAL / DATA FAILURE DURING STORM' }
  if (alerts.some(a => a === 'RED')) return { level: 'RED', label: 'DANGEROUS RISE DETECTED' }
  if (alerts.some(a => a === 'ORANGE')) return { level: 'ORANGE', label: 'RAPID RISE DETECTED' }
  if (alerts.some(a => a === 'YELLOW')) return { level: 'YELLOW', label: 'WATCHING UPSTREAM RISE' }
  return { level: 'GREEN', label: 'NORMAL' }
}

function HeroPanel({ status, lastUpdate }) {
  const bgColor = {
    GREEN: 'rgba(16,185,129,0.08)',
    YELLOW: 'rgba(245,158,11,0.08)',
    ORANGE: 'rgba(249,115,22,0.12)',
    RED: 'rgba(239,68,68,0.15)',
    BLACK: 'rgba(153,27,27,0.2)'
  }[status.level] || 'rgba(15,23,42,0.7)'

  const borderColor = {
    GREEN: 'rgba(16,185,129,0.3)',
    YELLOW: 'rgba(245,158,11,0.4)',
    ORANGE: 'rgba(249,115,22,0.5)',
    RED: 'rgba(239,68,68,0.6)',
    BLACK: 'rgba(153,27,27,0.7)'
  }[status.level] || 'rgba(255,255,255,0.1)'

  return (
    <div style={{
      background: bgColor,
      border: `2px solid ${borderColor}`,
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <AlertTriangle size={24} color={`var(--alert-${status.level.toLowerCase()})`} />
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          River Status: {status.label}
        </h2>
      </div>
      <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6', margin: '8px 0 0 0' }}>
        {status.level === 'GREEN' && 'All gauges reporting normal conditions. Continue monitoring during storms.'}
        {status.level === 'YELLOW' && 'Early rise detected upstream. Watch for changing conditions.'}
        {status.level === 'ORANGE' && 'Rapid rise detected. Avoid low-water crossings and stay alert.'}
        {status.level === 'RED' && 'Dangerous rise in progress. Move to higher ground if near river. Follow official alerts.'}
        {status.level === 'BLACK' && 'CRITICAL: Catastrophic rise or gauge failure during storm. Follow official emergency guidance immediately.'}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '11px', color: '#94a3b8' }}>
        <Clock size={14} />
        <span>Last updated: {lastUpdate ? formatCDT(lastUpdate) : '—'}</span>
      </div>
    </div>
  )
}

function GaugeCard({ gauge, data }) {
  const alertColor = `var(--alert-${data?.alert?.toLowerCase() || 'green'})`
  const isStale = data?.isStale

  return (
    <div style={{
      background: 'rgba(30,41,59,0.7)',
      border: `1px solid ${alertColor}`,
      borderRadius: '10px',
      padding: '14px',
      marginBottom: '12px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#f8fafc', margin: '0 0 4px 0' }}>
            {gauge.name}
          </h3>
          <div style={{
            display: 'inline-block',
            fontSize: '11px',
            fontWeight: 600,
            color: alertColor,
            background: `${alertColor}20`,
            padding: '3px 8px',
            borderRadius: '4px'
          }}>
            {ALERT_LEVELS[data?.alert]?.label || 'Normal'}
          </div>
        </div>
        {isStale && (
          <div style={{
            fontSize: '10px',
            color: '#f87171',
            background: 'rgba(248,113,113,0.15)',
            padding: '3px 6px',
            borderRadius: '4px'
          }}>
            Stale data
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>Water Level</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
            {data?.height !== undefined ? data.height.toFixed(2) : '—'} <span style={{ fontSize: '12px', color: '#94a3b8' }}>ft</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>Flow Rate</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#f8fafc' }}>
            {data?.flow !== undefined ? data.flow.toLocaleString() : '—'} <span style={{ fontSize: '12px', color: '#94a3b8' }}>cfs</span>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <TrendingUp size={12} />
          Rate of Rise
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', fontSize: '11px' }}>
          <div>
            <span style={{ color: '#94a3b8' }}>5m:</span>{' '}
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>
              {data?.rates?.rise5m !== undefined ? (data.rates.rise5m >= 0 ? '+' : '') + data.rates.rise5m.toFixed(2) : '—'}
            </span>
          </div>
          <div>
            <span style={{ color: '#94a3b8' }}>15m:</span>{' '}
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>
              {data?.rates?.rise15m !== undefined ? (data.rates.rise15m >= 0 ? '+' : '') + data.rates.rise15m.toFixed(2) : '—'}
            </span>
          </div>
          <div>
            <span style={{ color: '#94a3b8' }}>1h:</span>{' '}
            <span style={{ color: '#f8fafc', fontWeight: 600 }}>
              {data?.rates?.rise60m !== undefined ? (data.rates.rise60m >= 0 ? '+' : '') + data.rates.rise60m.toFixed(2) : '—'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Clock size={10} />
        {data?.time ? formatCDT(data.time) : '—'}
      </div>
    </div>
  )
}

export default function PublicDashboard() {
  const { gaugesData: data, lastUpdate, surgeEvents } = useSentinel()
  const [showIncidents, setShowIncidents] = useState(false)

  const status = getOverallStatus(data)

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '16px' }}>
      <header style={{ marginBottom: '20px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#f8fafc', margin: '0 0 6px 0' }}>
          Guadalupe Sentinel
        </h1>
        <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
          Upper Guadalupe River Flood Awareness
        </p>
      </header>

      <PublicDisclaimer />

      <HeroPanel status={status} lastUpdate={lastUpdate} />

      {surgeEvents?.length > 0 && (
        <div style={{
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: '10px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#fca5a5', marginBottom: '6px' }}>
            ⚠️ Upstream Surge Alert
          </div>
          {surgeEvents.map((e, i) => (
            <div key={i} style={{ fontSize: '11px', color: '#fecaca', marginBottom: '4px' }}>
              {e.message}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f8fafc', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Droplets size={18} />
          Gauge Readings
        </h2>
        {GAUGES.map(g => (
          <GaugeCard key={g.id} gauge={g} data={data[g.id]} />
        ))}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#f8fafc', marginBottom: '12px' }}>
          River Map
        </h2>
        <div style={{ borderRadius: '10px', overflow: 'hidden', height: '300px' }}>
          <RiverMap data={data} surgeEvents={surgeEvents} />
        </div>
      </div>

      <PublicDisclaimer compact />

      <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '11px', color: '#64748b' }}>
        <p style={{ margin: '4px 0' }}>Guadalupe Sentinel · Independent Awareness Tool</p>
        <p style={{ margin: '4px 0' }}>Not affiliated with UGRA, NWS, or local emergency management</p>
        <p style={{ margin: '4px 0' }}>For official alerts: <a href="https://weather.gov" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>weather.gov</a></p>
      </div>
    </div>
  )
}
