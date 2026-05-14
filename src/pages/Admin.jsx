import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminGetStats,
  adminListUsers,
  adminUpdateUserPlan,
  adminListIncidents,
  adminDeleteIncident,
  adminListSourceCache,
  adminDeleteSourceCache,
  adminListAiCache,
  adminPurgeAiCache,
  adminListNotifications,
} from '../lib/api'
import { usePlan } from '../hooks/usePlan'

const PLANS = ['free', 'admin']

function fmtTime(t) {
  if (!t) return '—'
  try { return new Date(t).toLocaleString() } catch { return String(t) }
}

function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function Section({ title, children, action }) {
  return (
    <section style={{ marginBottom: 24, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Stats({ stats }) {
  if (!stats) return <div>Loading…</div>
  const cards = [
    { label: 'Users (total)', value: Object.values(stats.usersByPlan).reduce((a, b) => a + b, 0) },
    { label: 'Subscriptions', value: stats.subscriptions },
    { label: 'Incidents', value: stats.incidents },
    { label: 'AI calls today', value: stats.aiCallsToday },
    { label: 'Source cache keys', value: stats.sourceCacheKeys },
    { label: 'Source history rows', value: stats.sourceHistoryRows },
  ]
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: '#1e293b', padding: 12, borderRadius: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{c.value ?? '—'}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
        Users by plan:{' '}
        {Object.entries(stats.usersByPlan).map(([p, n]) => (
          <span key={p} style={{ marginRight: 12 }}>{p}: <strong>{n}</strong></span>
        ))}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, opacity: 0.6 }}>
        Latest incident: {fmtTime(stats.latestIncident)}
      </div>
    </>
  )
}

function Users() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try { setRows(await adminListUsers({ q })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, []) // initial

  async function changePlan(id, plan) {
    if (!window.confirm(`Set plan for ${id} to "${plan}"?`)) return
    try {
      await adminUpdateUserPlan(id, plan)
      setRows(rs => rs.map(r => r.id === id ? { ...r, plan } : r))
    } catch (e) { alert(`Failed: ${e.message}`) }
  }

  return (
    <>
      <form
        onSubmit={(e) => { e.preventDefault(); load() }}
        style={{ display: 'flex', gap: 8, marginBottom: 12 }}
      >
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search email or name…"
          style={{ flex: 1, padding: 6, borderRadius: 4, border: '1px solid #334155', background: '#0b1220', color: 'inherit' }}
        />
        <button type="submit">Search</button>
      </form>
      {error && <div style={{ color: '#f87171', marginBottom: 8 }}>{error}</div>}
      {loading && <div>Loading…</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: 6 }}>Email</th>
              <th style={{ padding: 6 }}>Name</th>
              <th style={{ padding: 6 }}>Plan</th>

              <th style={{ padding: 6 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 6 }}>{u.email || u.id}</td>
                <td style={{ padding: 6 }}>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                <td style={{ padding: 6 }}>
                  <select
                    value={u.plan}
                    onChange={e => changePlan(u.id, e.target.value)}
                    style={{ background: '#0b1220', color: 'inherit', border: '1px solid #334155', borderRadius: 4, padding: '2px 4px' }}
                  >
                    {PLANS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>

                <td style={{ padding: 6 }}>{fmtTime(u.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Incidents() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  async function load() {
    try { setRows(await adminListIncidents(200)) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  async function del(id) {
    if (!window.confirm('Delete this incident?')) return
    try {
      await adminDeleteIncident(id)
      setRows(r => r.filter(x => x.id !== id))
    } catch (e) { alert(e.message) }
  }
  if (error) return <div style={{ color: '#f87171' }}>{error}</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #334155' }}>
            <th style={{ padding: 6 }}>Gauge</th>
            <th style={{ padding: 6 }}>Transition</th>
            <th style={{ padding: 6 }}>Height</th>
            <th style={{ padding: 6 }}>Flow</th>
            <th style={{ padding: 6 }}>Occurred</th>
            <th style={{ padding: 6 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(i => (
            <tr key={i.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: 6 }}>{i.gauge_name || i.gauge_id}</td>
              <td style={{ padding: 6 }}>{i.from_level} → {i.to_level}</td>
              <td style={{ padding: 6 }}>{i.height_ft ?? '—'}</td>
              <td style={{ padding: 6 }}>{i.flow_cfs ?? '—'}</td>
              <td style={{ padding: 6 }}>{fmtTime(i.occurred_at)}</td>
              <td style={{ padding: 6 }}>
                <button onClick={() => del(i.id)} style={{ background: '#7f1d1d', color: 'white', border: 0, padding: '2px 8px', borderRadius: 4 }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SourceCache() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  async function load() {
    try { setRows(await adminListSourceCache()) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])
  async function del(key) {
    if (!window.confirm(`Delete cache entry "${key}"? Next poll tick will repopulate it.`)) return
    try { await adminDeleteSourceCache(key); setRows(r => r.filter(x => x.key !== key)) }
    catch (e) { alert(e.message) }
  }
  if (error) return <div style={{ color: '#f87171' }}>{error}</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #334155' }}>
            <th style={{ padding: 6 }}>Key</th>
            <th style={{ padding: 6 }}>Fetched</th>
            <th style={{ padding: 6 }}>Size</th>
            <th style={{ padding: 6 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: 6, fontFamily: 'monospace' }}>{r.key}</td>
              <td style={{ padding: 6 }}>{fmtTime(r.fetched_at)}</td>
              <td style={{ padding: 6 }}>{fmtBytes(r.size_bytes)}</td>
              <td style={{ padding: 6 }}>
                <button onClick={() => del(r.key)} style={{ background: '#7f1d1d', color: 'white', border: 0, padding: '2px 8px', borderRadius: 4 }}>Evict</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AiCache() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  async function load() {
    try { setRows(await adminListAiCache()) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])
  async function purge() {
    if (!window.confirm('Purge ALL AI briefing cache entries?')) return
    try { await adminPurgeAiCache(); setRows([]) }
    catch (e) { alert(e.message) }
  }
  if (error) return <div style={{ color: '#f87171' }}>{error}</div>
  const totalHits = rows.reduce((a, r) => a + (r.hits || 0), 0)
  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 13, opacity: 0.85 }}>
        <span>{rows.length} entries</span>
        <span>{totalHits} cache hits saved tokens</span>
        <button onClick={purge} style={{ marginLeft: 'auto', background: '#7f1d1d', color: 'white', border: 0, padding: '2px 8px', borderRadius: 4 }}>Purge all</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #334155' }}>
              <th style={{ padding: 6 }}>Key</th>
              <th style={{ padding: 6 }}>Model</th>
              <th style={{ padding: 6 }}>Hits</th>
              <th style={{ padding: 6 }}>Size</th>
              <th style={{ padding: 6 }}>Created</th>
              <th style={{ padding: 6 }}>Expires</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.cache_key} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{r.cache_key.slice(0, 16)}…</td>
                <td style={{ padding: 6 }}>{r.model}</td>
                <td style={{ padding: 6 }}>{r.hits}</td>
                <td style={{ padding: 6 }}>{fmtBytes(r.size_bytes)}</td>
                <td style={{ padding: 6 }}>{fmtTime(r.created_at)}</td>
                <td style={{ padding: 6 }}>{fmtTime(r.expires_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Notifications() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => {
    adminListNotifications(200).then(setRows).catch(e => setError(e.message))
  }, [])
  if (error) return <div style={{ color: '#f87171' }}>{error}</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #334155' }}>
            <th style={{ padding: 6 }}>Channel</th>
            <th style={{ padding: 6 }}>Status</th>
            <th style={{ padding: 6 }}>Sent</th>
            <th style={{ padding: 6 }}>Subscription</th>
            <th style={{ padding: 6 }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(n => (
            <tr key={n.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: 6 }}>{n.channel}</td>
              <td style={{ padding: 6, color: n.status === 'sent' ? '#34d399' : '#f87171' }}>{n.status}</td>
              <td style={{ padding: 6 }}>{fmtTime(n.sent_at)}</td>
              <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{(n.subscription_id || '').slice(0, 8)}</td>
              <td style={{ padding: 6, color: '#f87171' }}>{n.error || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Admin() {
  const { plan, loading } = usePlan()
  const [stats, setStats] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (plan !== 'admin') return
    adminGetStats().then(setStats).catch(() => setStats(null))
  }, [plan, refreshKey])

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>
  if (plan !== 'admin') {
    return (
      <div style={{ padding: 24 }}>
        <h1>Admin</h1>
        <p>This page requires the <code>admin</code> plan.</p>
        <p><Link to="/">← Back</Link></p>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        <button onClick={() => setRefreshKey(k => k + 1)}>Refresh</button>
        <span style={{ marginLeft: 'auto', fontSize: 13, opacity: 0.7 }}>
          <Link to="/">← Dashboard</Link>
        </span>
      </div>
      <Section title="Stats"><Stats stats={stats} /></Section>
      <Section title="Users"><Users /></Section>
      <Section title="Incidents"><Incidents /></Section>
      <Section title="Source cache"><SourceCache /></Section>
      <Section title="AI briefing cache"><AiCache /></Section>
      <Section title="Recent notifications"><Notifications /></Section>
    </div>
  )
}
