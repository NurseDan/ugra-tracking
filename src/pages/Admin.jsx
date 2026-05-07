import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getCurrentUser, adminGetConfig, adminSetConfig, adminDeleteConfig,
  adminGetUsers, adminPatchUser, adminGetStats
} from '../lib/api'

// ── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: { padding: '24px 20px', maxWidth: 960, margin: '0 auto' },
  h2: { margin: '0 0 4px', fontSize: 22 },
  sub: { color: '#888', fontSize: 14, margin: '0 0 28px' },
  section: { marginBottom: 36 },
  sectionTitle: { fontSize: 16, fontWeight: 700, borderBottom: '1px solid #222', paddingBottom: 8, marginBottom: 16 },
  card: { background: '#111', border: '1px solid #222', borderRadius: 8, overflow: 'hidden' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap' },
  label: { flex: '1 1 200px', fontSize: 13, color: '#ccc' },
  hint: { fontSize: 11, color: '#555', marginTop: 2 },
  badge: (color) => ({
    display: 'inline-block', padding: '1px 7px', borderRadius: 4,
    fontSize: 11, fontWeight: 700, background: color, color: '#fff'
  }),
  input: {
    flex: '1 1 240px', padding: '5px 9px', background: '#1a1a1a',
    border: '1px solid #333', borderRadius: 4, color: '#fff', fontSize: 13
  },
  btn: (color = '#3b82f6') => ({
    padding: '5px 12px', background: color, color: '#fff',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    whiteSpace: 'nowrap'
  }),
  statBox: {
    background: '#111', border: '1px solid #222', borderRadius: 8,
    padding: '16px 20px', textAlign: 'center', flex: '1 1 120px'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ source }) {
  const map = { database: ['#16a34a', 'DB ✓'], env: ['#ca8a04', 'ENV'], unset: ['#7f1d1d', 'NOT SET'] }
  const [color, text] = map[source] || ['#555', source]
  return <span style={S.badge(color)}>{text}</span>
}

// ── Stats row ────────────────────────────────────────────────────────────────

function StatsRow() {
  const [stats, setStats] = useState(null)
  useEffect(() => { adminGetStats().then(setStats).catch(() => {}) }, [])
  if (!stats) return null
  const items = [
    { label: 'Total users', value: stats.total_users },
    { label: 'Free', value: stats.free_users },
    { label: 'Pro', value: stats.pro_users },
    { label: 'Active subs', value: stats.total_subs },
    { label: 'Alerts today', value: stats.sent_today },
    { label: 'Incidents (7d)', value: stats.incidents_week }
  ]
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 32 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={S.statBox}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{value ?? '—'}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Config section ───────────────────────────────────────────────────────────

function ConfigSection({ settings, encryptionAvailable, onSaved }) {
  const [editing, setEditing] = useState({})
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState({})
  const [errors, setErrors] = useState({})

  const sections = [...new Set(settings.map(s => s.section))]

  async function save(key, encrypted) {
    const val = values[key]?.trim()
    if (!val) return
    setSaving(s => ({ ...s, [key]: true }))
    setErrors(e => ({ ...e, [key]: null }))
    try {
      await adminSetConfig(key, val)
      setEditing(e => ({ ...e, [key]: false }))
      setValues(v => ({ ...v, [key]: '' }))
      onSaved()
    } catch (err) {
      setErrors(e => ({ ...e, [key]: err.message }))
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
    }
  }

  async function clear(key) {
    if (!confirm(`Remove "${key}" from database? The environment variable (if set) will be used as fallback.`)) return
    try {
      await adminDeleteConfig(key)
      onSaved()
    } catch (err) {
      setErrors(e => ({ ...e, [key]: err.message }))
    }
  }

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Configuration</div>

      {!encryptionAvailable && (
        <div style={{ background: '#7c2d12', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#fdba74' }}>
          <strong>CONFIG_ENCRYPTION_KEY not set.</strong> Encrypted fields (Stripe keys, auth tokens) cannot be saved via the GUI.
          Generate a key with: <code style={{ background: '#000', padding: '1px 5px', borderRadius: 3 }}>openssl rand -hex 32</code> and add it to your environment.
        </div>
      )}

      {sections.map(section => (
        <div key={section} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#888', fontWeight: 600, marginBottom: 8 }}>{section}</div>
          <div style={S.card}>
            {settings.filter(s => s.section === section).map((s, i, arr) => (
              <div key={s.key} style={{ ...S.row, borderBottom: i < arr.length - 1 ? '1px solid #1a1a1a' : 'none' }}>
                <div style={S.label}>
                  <div>{s.label}</div>
                  {s.hint && <div style={S.hint}>{s.hint}</div>}
                  {s.encrypted && <div style={{ ...S.hint, color: '#3b82f6' }}>🔒 encrypted</div>}
                </div>
                <StatusBadge source={s.source} />
                {editing[s.key] ? (
                  <>
                    <input
                      style={S.input}
                      type={s.encrypted ? 'password' : 'text'}
                      placeholder={s.hint || s.key}
                      value={values[s.key] || ''}
                      onChange={e => setValues(v => ({ ...v, [s.key]: e.target.value }))}
                      autoFocus
                    />
                    <button style={S.btn()} disabled={saving[s.key]} onClick={() => save(s.key, s.encrypted)}>
                      {saving[s.key] ? '…' : 'Save'}
                    </button>
                    <button style={S.btn('#374151')} onClick={() => setEditing(e => ({ ...e, [s.key]: false }))}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      style={S.btn('#374151')}
                      disabled={s.encrypted && !encryptionAvailable}
                      onClick={() => setEditing(e => ({ ...e, [s.key]: true }))}
                    >
                      {s.set ? 'Change' : 'Set'}
                    </button>
                    {s.source === 'database' && (
                      <button style={S.btn('#7f1d1d')} onClick={() => clear(s.key)}>Clear</button>
                    )}
                  </>
                )}
                {errors[s.key] && (
                  <div style={{ width: '100%', color: '#ef4444', fontSize: 12 }}>{errors[s.key]}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Go-live checklist ────────────────────────────────────────────────────────

function GoLiveChecklist({ settings }) {
  const required = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID_PRO', 'STRIPE_WEBHOOK_SECRET', 'DATABASE_URL', 'SESSION_SECRET']
  const optional = ['STRIPE_PRICE_ID_PRO_ANNUAL', 'OPENAI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'PUBLIC_URL', 'VAPID_SUBJECT']
  const byKey = Object.fromEntries(settings.map(s => [s.key, s]))

  function check(key) {
    const s = byKey[key]
    if (!s) return key === 'DATABASE_URL' || key === 'SESSION_SECRET' ? '✓ env' : '✗ missing'
    return s.set ? '✓' : '✗'
  }
  function isSet(key) {
    const s = byKey[key]
    if (!s) return key === 'DATABASE_URL' || key === 'SESSION_SECRET'
    return s.set
  }

  const allRequired = required.every(isSet)

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Go-live checklist</div>
      <div style={{
        background: allRequired ? '#052e16' : '#1c0a00',
        border: `1px solid ${allRequired ? '#16a34a' : '#92400e'}`,
        borderRadius: 8, padding: '14px 18px', marginBottom: 12
      }}>
        <div style={{ fontWeight: 700, color: allRequired ? '#4ade80' : '#fbbf24', marginBottom: 10 }}>
          {allRequired ? '✓ All required settings configured — ready to go live!' : '⚠ Complete required settings before going live'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
          {required.map(key => (
            <div key={key} style={{ fontSize: 13, color: isSet(key) ? '#4ade80' : '#f87171', display: 'flex', gap: 6 }}>
              <span>{isSet(key) ? '✓' : '✗'}</span>
              <span>{byKey[key]?.label || key}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
        Optional: {optional.map(key => (
          <span key={key} style={{ marginRight: 12, color: isSet(key) ? '#4ade80' : '#555' }}>
            {isSet(key) ? '✓' : '○'} {byKey[key]?.label || key}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Users section ─────────────────────────────────────────────────────────────

function UsersSection({ currentUserId }) {
  const [users, setUsers] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(() => {
    adminGetUsers().then(setUsers).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  async function setPlan(id, plan) {
    await adminPatchUser(id, { plan })
    load()
  }
  async function toggleAdmin(id, current) {
    if (!confirm(`${current ? 'Remove' : 'Grant'} admin access for this user?`)) return
    await adminPatchUser(id, { is_admin: !current })
    load()
  }

  if (err) return <div style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>
  if (!users) return <div style={{ color: '#666', fontSize: 13 }}>Loading…</div>

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Users ({users.length})</div>
      <div style={S.card}>
        <div style={{ ...S.row, background: '#0a0a0a', fontSize: 11, color: '#555', fontWeight: 700 }}>
          <div style={{ flex: '2 1 200px' }}>Email</div>
          <div style={{ flex: '0 0 60px' }}>Plan</div>
          <div style={{ flex: '0 0 60px' }}>Subs</div>
          <div style={{ flex: '0 0 80px' }}>Auth</div>
          <div style={{ flex: '0 0 80px' }}>Admin</div>
          <div style={{ flex: '0 0 140px' }}>Actions</div>
        </div>
        {users.map(u => (
          <div key={u.id} style={{ ...S.row, opacity: u.id === currentUserId ? 1 : 0.85 }}>
            <div style={{ flex: '2 1 200px' }}>
              <div style={{ fontSize: 13, color: '#ccc' }}>{u.email || u.id}</div>
              {(u.first_name || u.last_name) && (
                <div style={{ fontSize: 11, color: '#555' }}>{[u.first_name, u.last_name].filter(Boolean).join(' ')}</div>
              )}
            </div>
            <div style={{ flex: '0 0 60px' }}>
              <span style={S.badge(u.plan === 'pro' ? '#1d4ed8' : '#374151')}>
                {(u.plan || 'free').toUpperCase()}
              </span>
            </div>
            <div style={{ flex: '0 0 60px', fontSize: 13, color: '#888' }}>{u.sub_count}</div>
            <div style={{ flex: '0 0 80px', fontSize: 12, color: '#666' }}>{u.auth_provider}</div>
            <div style={{ flex: '0 0 80px' }}>
              {u.is_admin ? <span style={{ color: '#4ade80', fontSize: 12 }}>✓ admin</span> : null}
            </div>
            <div style={{ flex: '0 0 140px', display: 'flex', gap: 6 }}>
              {u.plan !== 'pro'
                ? <button style={S.btn('#1d4ed8')} onClick={() => setPlan(u.id, 'pro')}>→ Pro</button>
                : <button style={S.btn('#374151')} onClick={() => setPlan(u.id, 'free')}>→ Free</button>
              }
              <button style={S.btn(u.is_admin ? '#7f1d1d' : '#374151')} onClick={() => toggleAdmin(u.id, u.is_admin)}>
                {u.is_admin ? 'Revoke' : 'Admin'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  const [user, setUser] = useState(undefined)
  const [config, setConfig] = useState(null)
  const [err, setErr] = useState(null)

  const loadConfig = useCallback(() => {
    adminGetConfig().then(setConfig).catch(e => setErr(e.message))
  }, [])

  useEffect(() => {
    getCurrentUser().then(u => {
      setUser(u)
      if (u) loadConfig()
    }).catch(() => setUser(null))
  }, [loadConfig])

  if (user === undefined) return <div style={{ padding: 32, color: '#888' }}>Loading…</div>

  if (!user) return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <h2>Admin</h2>
      <p style={{ color: '#aaa' }}>Sign in first.</p>
      <Link to="/login" style={{ color: '#3b82f6' }}>Sign in →</Link>
    </div>
  )

  if (err) return (
    <div style={{ padding: 32, color: '#ef4444' }}>
      {err === 'Forbidden' || err.includes('403')
        ? 'You do not have admin access. Ask the site owner to grant it.'
        : err}
    </div>
  )

  if (!config) return <div style={{ padding: 32, color: '#888' }}>Loading config…</div>

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Admin panel</h2>
      <p style={S.sub}>Signed in as {user.email} · <a href="/api/logout" style={{ color: '#888' }}>Sign out</a></p>

      <StatsRow />

      <GoLiveChecklist settings={config.settings} />

      <ConfigSection
        settings={config.settings}
        encryptionAvailable={config.encryptionAvailable}
        onSaved={loadConfig}
      />

      <UsersSection currentUserId={user.id} />
    </div>
  )
}
