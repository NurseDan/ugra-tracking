import React, { useState } from 'react'
import { GAUGES } from '../config/gauges'

const SOURCES = [
  { key: 'readings',    label: 'Gauge readings (USGS)', perGauge: true,  history: false },
  { key: 'incidents',   label: 'Incident log',          perGauge: false, history: false },
  { key: 'nws_alerts',  label: 'NWS active alerts',     perGauge: false, history: true },
  { key: 'ahps',        label: 'AHPS / NWPS forecasts', perGauge: true,  history: true },
  { key: 'nwm',         label: 'National Water Model',  perGauge: true,  history: true },
  { key: 'weather',     label: 'Weather (Open-Meteo)',  perGauge: true,  history: true },
  { key: 'canyon_lake', label: 'Canyon Lake reservoir', perGauge: false, history: true }
]

const PERIODS = [
  { value: '1d',  label: 'Last 24 hours' },
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y',  label: 'Last year' },
  { value: '5y',  label: 'Last 5 years (max)' }
]

function buildUrl(src, fmt, opts) {
  const qs = new URLSearchParams()
  if (opts.usePeriod) {
    qs.set('period', opts.period)
  } else {
    if (opts.from) qs.set('from', new Date(opts.from).toISOString())
    if (opts.to)   qs.set('to',   new Date(opts.to).toISOString())
  }
  if (opts.gaugeId) qs.set(src.key === 'readings' ? 'gauge_id' : 'key', opts.gaugeId)
  const path = src.history
    ? `/api/export/source/${src.key}.${fmt}`
    : `/api/export/${src.key}.${fmt}`
  return `${path}?${qs.toString()}`
}

export default function Exports() {
  const [period, setPeriod] = useState('30d')
  const [usePeriod, setUsePeriod] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [gaugeId, setGaugeId] = useState('')

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <h2>Data exports</h2>
      <p style={{ color: '#aaa', fontSize: 14 }}>
        Every public data source is captured by the always-on backend and retained for five years.
        Pick a date range and download CSV or JSON. Files are streamed straight from the server-side
        history table — no browser-side fetching of upstream APIs.
      </p>

      <div style={{ background: '#1a1a1a', padding: 16, borderRadius: 8, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            <input type="radio" checked={usePeriod} onChange={() => setUsePeriod(true)} /> Quick range:
            <select value={period} onChange={e => setPeriod(e.target.value)} style={{ marginLeft: 8 }} disabled={!usePeriod}>
              {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label>
            <input type="radio" checked={!usePeriod} onChange={() => setUsePeriod(false)} /> Custom:
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ marginLeft: 8 }} disabled={usePeriod} /> →
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ marginLeft: 8 }} disabled={usePeriod} />
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Gauge filter (per-gauge sources only):
            <select value={gaugeId} onChange={e => setGaugeId(e.target.value)} style={{ marginLeft: 8 }}>
              <option value="">All gauges</option>
              {GAUGES.map(g => <option key={g.id} value={g.id}>{g.shortName || g.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {SOURCES.map(src => (
          <div key={src.key} style={{
            background: '#1a1a1a', padding: 12, borderRadius: 6,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div>
              <div style={{ fontWeight: 600 }}>{src.label}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {src.perGauge ? 'Per gauge · ' : ''}
                {src.history ? 'Five-year retained history' : 'Snapshot of current data'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <a className="export-btn" href={buildUrl(src, 'csv', {
                usePeriod, period, from, to,
                gaugeId: src.perGauge ? gaugeId : null
              })}>CSV</a>
              <a className="export-btn" href={buildUrl(src, 'json', {
                usePeriod, period, from, to,
                gaugeId: src.perGauge ? gaugeId : null
              })}>JSON</a>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        .export-btn {
          display: inline-block; padding: 6px 14px; background: #2563eb; color: #fff;
          text-decoration: none; border-radius: 4px; font-size: 13px;
        }
        .export-btn:hover { background: #1d4ed8; }
      `}</style>
    </div>
  )
}
