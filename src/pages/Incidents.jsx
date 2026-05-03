import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Download, Trash2, Search, ArrowLeft, Clock, Activity, Filter, Plus
} from 'lucide-react'
import { GAUGES } from '../config/gauges'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { formatCDT } from '../lib/formatTime'
import {
  listIncidents, clearIncidents, subscribe, logIncident
} from '../lib/incidentLog'
import './Incidents.css'

const SEVERITY_ORDER = ['YELLOW', 'ORANGE', 'RED', 'BLACK']
const PAGE_SIZE = 100

function useIncidents() {
  const [incidents, setIncidents] = useState(() => listIncidents())
  useEffect(() => {
    const update = () => setIncidents(listIncidents())
    const unsub = subscribe(update)
    update()
    return unsub
  }, [])
  return incidents
}

function relativeTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function gaugeName(id) {
  const g = GAUGES.find((g) => g.id === id)
  return g?.shortName || g?.name || id || 'Unknown'
}

function severityLabel(level) {
  return ALERT_LEVELS[level]?.label || level || '—'
}

function toCsvCell(value) {
  if (value == null) return ''
  const s = String(value).replace(/"/g, '""')
  return /[",\n]/.test(s) ? `"${s}"` : s
}

function buildCsv(incidents) {
  const headers = ['time', 'gaugeId', 'gaugeName', 'fromLevel', 'toLevel', 'heightFt', 'flowCfs', 'message']
  const lines = [headers.join(',')]
  incidents.forEach((inc) => {
    lines.push([
      inc.time,
      inc.gaugeId,
      inc.gaugeName || gaugeName(inc.gaugeId),
      inc.fromLevel,
      inc.toLevel,
      inc.height ?? inc.heightFt,
      inc.flow ?? inc.flowCfs,
      inc.message
    ].map(toCsvCell).join(','))
  })
  return lines.join('\n')
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function parseList(value) {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function computeStats(incidents) {
  const total = incidents.length
  const bySeverity = {}
  const byGauge = {}
  incidents.forEach((inc) => {
    const sev = inc.toLevel || inc.severity
    if (sev) bySeverity[sev] = (bySeverity[sev] || 0) + 1
    if (inc.gaugeId) byGauge[inc.gaugeId] = (byGauge[inc.gaugeId] || 0) + 1
  })

  let mostActiveGaugeId = null
  let mostActiveCount = 0
  Object.entries(byGauge).forEach(([id, c]) => {
    if (c > mostActiveCount) { mostActiveGaugeId = id; mostActiveCount = c }
  })

  // Longest active warning duration: find consecutive RED/BLACK runs per gauge.
  const sorted = [...incidents].sort((a, b) => new Date(a.time) - new Date(b.time))
  const activeStart = {} // gaugeId -> ms
  let longestMs = 0
  sorted.forEach((inc) => {
    const sev = inc.toLevel
    const gid = inc.gaugeId
    if (!gid) return
    const tMs = new Date(inc.time).getTime()
    if (sev === 'RED' || sev === 'BLACK') {
      if (activeStart[gid] == null) activeStart[gid] = tMs
    } else if (activeStart[gid] != null) {
      longestMs = Math.max(longestMs, tMs - activeStart[gid])
      activeStart[gid] = null
    }
  })
  Object.entries(activeStart).forEach(([gid, start]) => {
    if (start != null) longestMs = Math.max(longestMs, Date.now() - start)
  })

  return {
    total,
    bySeverity,
    mostActiveGaugeId,
    mostActiveCount,
    longestActiveMs: longestMs
  }
}

function formatDuration(ms) {
  if (!ms || ms < 60000) return '—'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs < 24) return rem ? `${hrs}h ${rem}m` : `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

export default function Incidents() {
  const allIncidents = useIncidents()
  const [searchParams, setSearchParams] = useSearchParams()

  const selectedGauges = useMemo(() => parseList(searchParams.get('gauges')), [searchParams])
  const selectedSeverities = useMemo(() => parseList(searchParams.get('severities')), [searchParams])
  const fromDate = searchParams.get('from') || ''
  const toDate = searchParams.get('to') || ''
  const search = searchParams.get('q') || ''
  const page = Math.max(1, Number(searchParams.get('page') || '1'))

  const updateParams = useCallback(
    (updates) => {
      const next = new URLSearchParams(searchParams)
      Object.entries(updates).forEach(([k, v]) => {
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
          next.delete(k)
        } else if (Array.isArray(v)) {
          next.set(k, v.join(','))
        } else {
          next.set(k, String(v))
        }
      })
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  const filtered = useMemo(() => {
    return listIncidents({
      gaugeIds: selectedGauges.length ? selectedGauges : null,
      severities: selectedSeverities.length ? selectedSeverities : null,
      from: fromDate || null,
      to: toDate || null,
      search
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIncidents, selectedGauges, selectedSeverities, fromDate, toDate, search])

  const stats = useMemo(() => computeStats(filtered), [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (page !== safePage) updateParams({ page: safePage > 1 ? safePage : null })
  }, [page, safePage, updateParams])

  const toggleArrayParam = useCallback(
    (paramKey, value) => {
      const current = paramKey === 'gauges' ? selectedGauges : selectedSeverities
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      updateParams({ [paramKey]: next, page: null })
    },
    [selectedGauges, selectedSeverities, updateParams]
  )

  const handleClear = useCallback(() => {
    if (window.confirm('Clear the entire incident log? This cannot be undone.')) {
      clearIncidents()
    }
  }, [])

  const handleExport = useCallback(() => {
    if (filtered.length === 0) return
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(buildCsv(filtered), `guadalupe-incidents-${stamp}.csv`)
  }, [filtered])

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV
  const generateSample = useCallback(() => {
    const gauges = GAUGES.slice(0, 4)
    const g = gauges[Math.floor(Math.random() * gauges.length)] || GAUGES[0]
    const sev = SEVERITY_ORDER[Math.floor(Math.random() * SEVERITY_ORDER.length)]
    logIncident({
      gaugeId: g.id,
      gaugeName: g.shortName || g.name,
      fromLevel: 'GREEN',
      toLevel: sev,
      height: Math.round(Math.random() * 200) / 10,
      flow: Math.round(Math.random() * 5000),
      message: `Sample escalation to ${ALERT_LEVELS[sev]?.label || sev}`
    })
  }, [])

  const hasFilters =
    selectedGauges.length > 0 || selectedSeverities.length > 0 || !!fromDate || !!toDate || !!search

  return (
    <div className="dashboard-container">
      <Link to="/" className="incidents-back">
        <ArrowLeft size={16} /> Back to Dashboard
      </Link>

      <div className="incidents-header">
        <h1 className="header-title">
          <AlertTriangle size={28} /> Incident History
        </h1>
        <div className="incidents-header-actions">
          <button
            type="button"
            className="incidents-btn"
            onClick={handleExport}
            disabled={filtered.length === 0}
            title={filtered.length === 0 ? 'Nothing to export' : 'Download filtered incidents as CSV'}
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            type="button"
            className="incidents-btn incidents-btn--danger"
            onClick={handleClear}
            disabled={allIncidents.length === 0}
          >
            <Trash2 size={14} /> Clear log
          </button>
        </div>
      </div>

      <StatsStrip stats={stats} />

      <div className="incidents-filters glass-panel">
        <div className="incidents-filters-row">
          <div className="incidents-filter incidents-filter--search">
            <label className="incidents-filter-label">
              <Search size={13} /> Search
            </label>
            <input
              type="search"
              className="incidents-input"
              placeholder="Search gauge, message, severity…"
              value={search}
              onChange={(e) => updateParams({ q: e.target.value, page: null })}
            />
          </div>
          <div className="incidents-filter">
            <label className="incidents-filter-label"><Clock size={13} /> From</label>
            <input
              type="date"
              className="incidents-input"
              value={fromDate}
              onChange={(e) => updateParams({ from: e.target.value, page: null })}
            />
          </div>
          <div className="incidents-filter">
            <label className="incidents-filter-label"><Clock size={13} /> To</label>
            <input
              type="date"
              className="incidents-input"
              value={toDate}
              onChange={(e) => updateParams({ to: e.target.value, page: null })}
            />
          </div>
        </div>

        <div className="incidents-filter-block">
          <div className="incidents-filter-label"><Filter size={13} /> Severity</div>
          <div className="incidents-chips">
            {SEVERITY_ORDER.map((sev) => {
              const on = selectedSeverities.includes(sev)
              return (
                <button
                  key={sev}
                  type="button"
                  className={`incidents-chip incidents-chip--${sev.toLowerCase()} ${on ? 'on' : ''}`}
                  onClick={() => toggleArrayParam('severities', sev)}
                >
                  {severityLabel(sev)}
                </button>
              )
            })}
          </div>
        </div>

        <div className="incidents-filter-block">
          <div className="incidents-filter-label"><Filter size={13} /> Gauge</div>
          <div className="incidents-chips">
            {GAUGES.map((g) => {
              const on = selectedGauges.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`incidents-chip ${on ? 'on' : ''}`}
                  onClick={() => toggleArrayParam('gauges', g.id)}
                  title={g.name}
                >
                  {g.shortName || g.name}
                </button>
              )
            })}
          </div>
        </div>

        {hasFilters && (
          <button type="button" className="incidents-link-btn" onClick={resetFilters}>
            Clear all filters
          </button>
        )}
      </div>

      <div className="incidents-list glass-panel">
        {allIncidents.length === 0 ? (
          <EmptyState onSample={isDev ? generateSample : null} />
        ) : filtered.length === 0 ? (
          <div className="incidents-empty">
            <p>No incidents match the current filters.</p>
            <button type="button" className="incidents-link-btn" onClick={resetFilters}>Clear filters</button>
          </div>
        ) : (
          <>
            <table className="incidents-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Gauge</th>
                  <th>Transition</th>
                  <th>Reading</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((inc) => (
                  <IncidentRow key={inc.id || `${inc.time}-${inc.gaugeId}`} inc={inc} />
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onChange={(p) => updateParams({ page: p > 1 ? p : null })}
              />
            )}
          </>
        )}

        {isDev && allIncidents.length > 0 && (
          <button type="button" className="incidents-link-btn incidents-dev-btn" onClick={generateSample}>
            <Plus size={12} /> Generate sample incident (dev)
          </button>
        )}
      </div>
    </div>
  )
}

function StatsStrip({ stats }) {
  const { total, bySeverity, mostActiveGaugeId, mostActiveCount, longestActiveMs } = stats
  return (
    <div className="incidents-stats">
      <StatCard label="Total incidents" value={total} />
      {SEVERITY_ORDER.map((sev) => (
        <StatCard
          key={sev}
          label={severityLabel(sev)}
          value={bySeverity[sev] || 0}
          accentClass={`stat-accent-${sev.toLowerCase()}`}
        />
      ))}
      <StatCard
        label="Most-active gauge"
        value={mostActiveGaugeId ? gaugeName(mostActiveGaugeId) : '—'}
        sub={mostActiveGaugeId ? `${mostActiveCount} incident${mostActiveCount === 1 ? '' : 's'}` : null}
      />
      <StatCard
        label="Longest active warning"
        value={formatDuration(longestActiveMs)}
        icon={<Activity size={14} />}
      />
    </div>
  )
}

function StatCard({ label, value, sub, accentClass = '', icon }) {
  return (
    <div className={`incidents-stat ${accentClass}`}>
      <div className="incidents-stat-label">{icon}{label}</div>
      <div className="incidents-stat-value">{value}</div>
      {sub && <div className="incidents-stat-sub">{sub}</div>}
    </div>
  )
}

function IncidentRow({ inc }) {
  const sev = inc.toLevel || inc.severity || 'GREEN'
  const height = inc.height ?? inc.heightFt
  const flow = inc.flow ?? inc.flowCfs
  return (
    <tr>
      <td>
        <div className="incidents-time-rel">{relativeTime(inc.time)}</div>
        <div className="incidents-time-abs">{formatCDT(inc.time)}</div>
      </td>
      <td>
        <div className="incidents-gauge-name">{inc.gaugeName || gaugeName(inc.gaugeId)}</div>
        <div className="incidents-gauge-id">{inc.gaugeId}</div>
      </td>
      <td>
        <div className="incidents-transition">
          {inc.fromLevel && (
            <>
              <span className={`alert-badge ${inc.fromLevel}`}>{severityLabel(inc.fromLevel)}</span>
              <span className="incidents-arrow">→</span>
            </>
          )}
          <span className={`alert-badge ${sev}`}>{severityLabel(sev)}</span>
        </div>
        {inc.message && <div className="incidents-message">{inc.message}</div>}
      </td>
      <td>
        <div className="incidents-reading">
          {height != null && <span><strong>{Number(height).toFixed(2)}</strong> ft</span>}
          {flow != null && <span><strong>{Number(flow).toLocaleString()}</strong> cfs</span>}
          {height == null && flow == null && <span className="incidents-muted">—</span>}
        </div>
      </td>
      <td>
        <Link to={`/gauge/${inc.gaugeId}`} className="incidents-link-btn">View gauge</Link>
      </td>
    </tr>
  )
}

function Pagination({ page, totalPages, onChange }) {
  return (
    <div className="incidents-pagination">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Prev</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next →</button>
    </div>
  )
}

function EmptyState({ onSample }) {
  return (
    <div className="incidents-empty">
      <AlertTriangle size={32} color="#60a5fa" />
      <h3>No incidents logged yet</h3>
      <p>
        Incidents are recorded automatically when a gauge alert escalates (for example,
        Watch → Warning, or any rise above flood-stage thresholds). Once the system
        detects its first escalation, it will appear here with the time, gauge, and
        reading at the moment of the event.
      </p>
      {onSample && (
        <button type="button" className="incidents-btn" onClick={onSample}>
          <Plus size={14} /> Generate sample incident (dev)
        </button>
      )}
    </div>
  )
}
