import React, { useEffect, useState } from 'react'
import { User, CreditCard, Bell, AlertTriangle } from 'lucide-react'
import {
  getCurrentUser, getUsage, updateProfile, updatePreferences,
  signOutEverywhere, deleteAccount
} from '../lib/api'
import './AccountSettings.css'

const TABS = [
  { key: 'profile',  label: 'Profile',       icon: User },
  { key: 'plan',     label: 'Plan & usage',  icon: CreditCard },
  { key: 'notif',    label: 'Notifications', icon: Bell },
  { key: 'danger',   label: 'Danger zone',   icon: AlertTriangle, danger: true }
]

const LEVELS = ['YELLOW', 'ORANGE', 'RED', 'BLACK']
const ALL_CHANNELS = ['push', 'email', 'webhook', 'sms']

function initials(user) {
  const f = user?.first_name?.[0] || ''
  const l = user?.last_name?.[0] || ''
  if (f || l) return (f + l).toUpperCase()
  return (user?.email?.[0] || '?').toUpperCase()
}

export default function AccountSettings() {
  const [user, setUser] = useState(undefined)
  const [usage, setUsage] = useState(null)
  const [tab, setTab] = useState('profile')
  const [msg, setMsg] = useState(null)

  async function refresh() {
    const u = await getCurrentUser()
    setUser(u)
    if (u) {
      try { setUsage(await getUsage()) } catch {}
    }
  }
  useEffect(() => { refresh() }, [])

  function flash(type, text) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  if (user === undefined) return <div className="account"><div>Loading…</div></div>
  if (user === null) {
    return (
      <div className="account">
        <h1 className="account__title">Account Settings</h1>
        <div style={{ gridColumn: '1 / -1' }}>
          <p>Sign in to manage your account.</p>
          <a href="/api/login" className="account__btn">Sign in with Google</a>
        </div>
      </div>
    )
  }

  return (
    <div className="account">
      <h1 className="account__title">Account Settings</h1>

      <nav className="account__nav" aria-label="Settings sections">
        {TABS.map(t => {
          const Icon = t.icon
          const cls = [
            'account__nav-item',
            tab === t.key ? 'is-active' : '',
            t.danger ? 'is-danger' : ''
          ].filter(Boolean).join(' ')
          return (
            <button key={t.key} className={cls} onClick={() => { setTab(t.key); setMsg(null) }}>
              <Icon size={16} /> {t.label}
            </button>
          )
        })}
      </nav>

      <div className="account__panel">
        {msg && (
          <div className={`account__msg account__msg--${msg.type === 'ok' ? 'ok' : 'err'}`}>
            {msg.text}
          </div>
        )}

        {tab === 'profile' && <ProfileTab user={user} onSaved={refresh} flash={flash} />}
        {tab === 'plan' && <PlanTab user={user} usage={usage} />}
        {tab === 'notif' && <NotificationsTab user={user} onSaved={refresh} flash={flash} />}
        {tab === 'danger' && <DangerTab flash={flash} />}
      </div>
    </div>
  )
}

function ProfileTab({ user, onSaved, flash }) {
  const [firstName, setFirstName] = useState(user.first_name || '')
  const [lastName, setLastName] = useState(user.last_name || '')
  const [saving, setSaving] = useState(false)
  const dirty = firstName !== (user.first_name || '') || lastName !== (user.last_name || '')

  async function onSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateProfile({ first_name: firstName, last_name: lastName })
      flash('ok', 'Profile saved.')
      await onSaved()
    } catch (err) { flash('err', err.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <h2 className="account__section-title">Profile</h2>
      <p className="account__section-desc">Your name and account identity.</p>

      <div className="account__card">
        <div className="account__profile-row">
          {user.profile_image_url
            ? <img src={user.profile_image_url} alt="" className="account__avatar" />
            : <div className="account__avatar">{initials(user)}</div>}
          <div>
            <div className="account__profile-name">
              {user.first_name || ''} {user.last_name || ''}
            </div>
            <div className="account__profile-email">{user.email || '—'}</div>
          </div>
        </div>

        <form onSubmit={onSave}>
          <div className="account__field">
            <label className="account__field-label" htmlFor="fn">First name</label>
            <input id="fn" className="account__input" value={firstName}
              onChange={e => setFirstName(e.target.value)} maxLength={80} />
          </div>
          <div className="account__field">
            <label className="account__field-label" htmlFor="ln">Last name</label>
            <input id="ln" className="account__input" value={lastName}
              onChange={e => setLastName(e.target.value)} maxLength={80} />
          </div>
          <div className="account__field">
            <span className="account__field-label">Email</span>
            <span className="account__field-value">{user.email || '—'}</span>
          </div>
          <div className="account__field">
            <span className="account__field-label">Sign-in method</span>
            <span className="account__field-value">Google</span>
          </div>

          <button type="submit" className="account__btn" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </>
  )
}

function PlanTab({ user, usage }) {
  const plan = (user.plan || 'free').toLowerCase()
  const subUsed = usage?.subscriptions.used ?? 0
  const subLimit = usage?.subscriptions.limit
  const aiUsed = usage?.aiCalls.used ?? 0
  const aiLimit = usage?.aiCalls.limit

  return (
    <>
      <h2 className="account__section-title">Plan & usage</h2>
      <p className="account__section-desc">Your subscription tier and current consumption.</p>

      <div className="account__plan-banner">
        <div>
          <div className="account__plan-name">{plan}</div>
          <div className="account__plan-meta">
            {plan === 'free'  && 'Up to 2 alerts · Push only'}
            {plan === 'pro'   && 'Up to 10 alerts · Push, email, webhook · 50 AI calls/day'}
            {plan === 'admin' && 'Unlimited alerts and AI calls'}
          </div>
        </div>
        {plan === 'free' && (
          <a href="mailto:support@example.com?subject=Upgrade%20to%20Pro" className="account__btn">
            Upgrade
          </a>
        )}
      </div>

      <div className="account__card">
        <UsageBar label="Alert subscriptions" used={subUsed} limit={subLimit} />
        <UsageBar label="AI briefings today" used={aiUsed} limit={aiLimit} />
      </div>
    </>
  )
}

function UsageBar({ label, used, limit }) {
  const isUnlimited = limit == null
  const pct = isUnlimited ? 0 : Math.min(100, limit === 0 ? 0 : (used / limit) * 100)
  const fillClass = pct >= 100 ? 'is-full' : pct >= 80 ? 'is-near' : ''
  return (
    <div className="account__usage-row">
      <div className="account__usage-label">
        <span>{label}</span>
        <span>{used}{isUnlimited ? '' : ` / ${limit}`}{isUnlimited && ' · unlimited'}</span>
      </div>
      <div className="account__usage-bar">
        <div className={`account__usage-fill ${fillClass}`}
             style={{ width: `${isUnlimited ? 100 : pct}%`,
                      opacity: isUnlimited ? 0.4 : 1 }} />
      </div>
    </div>
  )
}

function NotificationsTab({ user, onSaved, flash }) {
  const [email, setEmail] = useState(user.default_email || '')
  const [minLevel, setMinLevel] = useState(user.default_min_level || 'ORANGE')
  const initialChannels = Array.isArray(user.default_channels) ? user.default_channels : ['push']
  const [channels, setChannels] = useState(new Set(initialChannels))
  const [saving, setSaving] = useState(false)

  function toggle(c) {
    const next = new Set(channels)
    next.has(c) ? next.delete(c) : next.add(c)
    setChannels(next)
  }

  async function onSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updatePreferences({
        default_email: email,
        default_min_level: minLevel,
        default_channels: [...channels]
      })
      flash('ok', 'Preferences saved.')
      await onSaved()
    } catch (err) { flash('err', err.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <h2 className="account__section-title">Default notification preferences</h2>
      <p className="account__section-desc">
        These defaults apply when creating new alert subscriptions. You can override
        them per-subscription on the My Alerts page.
      </p>

      <form onSubmit={onSave} className="account__card">
        <div className="account__field">
          <label className="account__field-label" htmlFor="em">Default email</label>
          <input id="em" type="email" className="account__input" value={email}
            placeholder={user.email || ''} onChange={e => setEmail(e.target.value)}
            maxLength={254} />
        </div>
        <div className="account__field">
          <label className="account__field-label" htmlFor="lv">Minimum alert level</label>
          <select id="lv" className="account__input" value={minLevel}
            onChange={e => setMinLevel(e.target.value)}>
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="account__field" style={{ alignItems: 'flex-start' }}>
          <span className="account__field-label">Default channels</span>
          <div className="account__channels">
            {ALL_CHANNELS.map(c => (
              <label key={c}
                className={`account__channel ${channels.has(c) ? 'is-checked' : ''}`}>
                <input type="checkbox" checked={channels.has(c)}
                  onChange={() => toggle(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="account__btn" disabled={saving}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </form>
    </>
  )
}

function DangerTab({ flash }) {
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSignOutAll() {
    if (!window.confirm('Sign out of all devices? You will be returned to the home page.')) return
    setBusy(true)
    try {
      await signOutEverywhere()
      window.location.href = '/'
    } catch (err) { flash('err', err.message); setBusy(false) }
  }

  async function onDelete() {
    if (confirm !== 'DELETE') {
      flash('err', 'Type DELETE to confirm.')
      return
    }
    setBusy(true)
    try {
      await deleteAccount()
      window.location.href = '/'
    } catch (err) { flash('err', err.message); setBusy(false) }
  }

  return (
    <>
      <h2 className="account__section-title">Danger zone</h2>
      <p className="account__section-desc">Irreversible actions affecting your account.</p>

      <div className="account__card account__danger-card">
        <div className="account__danger-row">
          <div className="account__danger-text">
            <strong>Sign out everywhere</strong>
            <span>End all active sessions on every device.</span>
          </div>
          <button className="account__btn account__btn--ghost" onClick={onSignOutAll} disabled={busy}>
            Sign out all
          </button>
        </div>

        <div className="account__danger-row">
          <div className="account__danger-text">
            <strong>Delete account</strong>
            <span>Permanently remove your account, alert subscriptions, and history.
              Type <code>DELETE</code> to confirm.</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="account__input" style={{ width: 120 }}
              value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="DELETE" />
            <button className="account__btn account__btn--danger"
              onClick={onDelete} disabled={busy || confirm !== 'DELETE'}>
              Delete
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
