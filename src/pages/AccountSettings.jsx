import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { User, CreditCard, Bell, AlertTriangle, Zap, ExternalLink } from 'lucide-react'
import {
  getCurrentUser, getUsage, updateProfile, updatePreferences,
  signOutEverywhere, deleteAccount, updateUserProfile, createCheckoutSession, createPortalSession
} from '../lib/api'
import { PLAN_DETAILS, PLANS_ORDERED } from '../config/planDetails'
import './AccountSettings.css'

const TABS = [
  { key: 'profile',  label: 'Profile',       icon: User },
  { key: 'plan',     label: 'Plan & usage',  icon: CreditCard },
  { key: 'notif',    label: 'Notifications', icon: Bell },
  { key: 'danger',   label: 'Danger zone',   icon: AlertTriangle, danger: true }
]

const LEVELS = ['YELLOW', 'ORANGE', 'RED', 'BLACK']
const ALL_CHANNELS = ['push', 'email', 'webhook', 'sms']

const PRICE_IDS = {
  member:   import.meta.env.VITE_STRIPE_PRICE_MEMBER,
  pro:      import.meta.env.VITE_STRIPE_PRICE_PRO,
  pro_plus: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS,
}

const PLAN_LABELS = {
  free: 'Free',
  member: 'Kerr County Member',
  pro: 'Pro',
  pro_plus: 'Pro+',
  admin: 'Admin',
}

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

  // Show upgrade=1 flash if redirected from Stripe checkout
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('upgraded') === '1') {
      flash('ok', 'Subscription activated! Your plan has been upgraded.')
      window.history.replaceState({}, '', '/account')
      refresh()
    }
  }, [])

  function flash(type, text) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 5000)
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
        {tab === 'plan' && <PlanTab user={user} usage={usage} flash={flash} />}
        {tab === 'notif' && <NotificationsTab user={user} onSaved={refresh} flash={flash} />}
        {tab === 'danger' && <DangerTab flash={flash} />}
      </div>
    </div>
  )
}

function ProfileTab({ user, onSaved, flash }) {
  const [firstName, setFirstName] = useState(user.first_name || '')
  const [lastName, setLastName] = useState(user.last_name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [saving, setSaving] = useState(false)
  const dirty =
    firstName !== (user.first_name || '') ||
    lastName  !== (user.last_name  || '') ||
    phone     !== (user.phone      || '')

  async function onSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateUserProfile({ first_name: firstName, last_name: lastName, phone })
      flash('ok', 'Profile saved.')
      await onSaved()
    } catch (err) { flash('err', err.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <h2 className="account__section-title">Profile</h2>
      <p className="account__section-desc">Your name, contact info, and account identity.</p>

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
          <div className="account__fields-row">
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
          </div>

          <div className="account__field">
            <label className="account__field-label" htmlFor="ph">Phone number</label>
            <input id="ph" type="tel" className="account__input" value={phone}
              onChange={e => setPhone(e.target.value)} maxLength={20}
              placeholder="+1 (555) 000-0000" />
            <span className="account__field-hint">Used for SMS alerts on Pro plan and above.</span>
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

function PlanTab({ user, usage, flash }) {
  const plan = user.plan || 'free'
  const planDetails = PLAN_DETAILS[plan] || PLAN_DETAILS.free
  const subUsed = usage?.subscriptions.used ?? 0
  const subLimit = usage?.subscriptions.limit
  const aiUsed = usage?.aiCalls.used ?? 0
  const aiLimit = usage?.aiCalls.limit
  const [upgrading, setUpgrading] = useState(null)
  const [portalLoading, setPortalLoading] = useState(false)

  async function handleUpgrade(planKey) {
    const priceId = PRICE_IDS[planKey]
    if (!priceId) { flash('err', 'Stripe not configured yet.'); return }
    setUpgrading(planKey)
    try {
      const { url } = await createCheckoutSession(priceId)
      window.location.href = url
    } catch (err) {
      flash('err', err.message)
      setUpgrading(null)
    }
  }

  async function handlePortal() {
    setPortalLoading(true)
    try {
      const { url } = await createPortalSession()
      window.location.href = url
    } catch (err) {
      flash('err', err.message)
      setPortalLoading(false)
    }
  }

  const isPaid = plan !== 'free' && plan !== 'admin'

  return (
    <>
      <h2 className="account__section-title">Plan & usage</h2>
      <p className="account__section-desc">Your subscription tier and current consumption.</p>

      {/* Current plan banner */}
      <div className="account__plan-banner" style={{ '--plan-color': planDetails.color }}>
        <div>
          <div className="account__plan-name" style={{ color: planDetails.color }}>
            {PLAN_LABELS[plan] || plan}
          </div>
          <div className="account__plan-meta">
            {plan === 'free'     && 'View-only access · No alerts or AI'}
            {plan === 'member'   && 'Up to 5 alert subscriptions · Push alerts'}
            {plan === 'pro'      && 'Up to 15 subscriptions · Push, SMS, email · 20 AI calls/day'}
            {plan === 'pro_plus' && 'Unlimited subscriptions · All channels · Unlimited AI · Data exports'}
            {plan === 'admin'    && 'Admin — unrestricted access'}
          </div>
        </div>
        {isPaid && (
          <button className="account__btn" onClick={handlePortal} disabled={portalLoading}>
            <ExternalLink size={14} />
            {portalLoading ? 'Loading…' : 'Manage billing'}
          </button>
        )}
        {plan === 'free' && (
          <Link to="/pricing" className="account__btn" style={{ background: '#3b82f6', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Zap size={14} /> View plans
          </Link>
        )}
      </div>

      {/* Usage bars */}
      <div className="account__card">
        <UsageBar label="Alert subscriptions" used={subUsed} limit={subLimit} />
        <UsageBar label="AI briefings today" used={aiUsed} limit={aiLimit} />
      </div>

      {/* Upgrade cards for free/member/pro users */}
      {plan !== 'pro_plus' && plan !== 'admin' && (
        <div className="account__upgrade-section">
          <h3 className="account__upgrade-title">Upgrade your plan</h3>
          <div className="account__upgrade-cards">
            {PLANS_ORDERED.filter(k => {
              const order = { free: 0, member: 1, pro: 2, pro_plus: 3, admin: 99 }
              return k !== 'free' && order[k] > order[plan]
            }).map(key => {
              const p = PLAN_DETAILS[key]
              return (
                <div key={key} className="account__upgrade-card" style={{ '--plan-color': p.color }}>
                  {p.badge && <div className="account__upgrade-badge">{p.badge}</div>}
                  <div className="account__upgrade-plan-name">{p.name}</div>
                  <div className="account__upgrade-price">${p.monthlyPrice}<span>/mo</span></div>
                  <ul className="account__upgrade-features">
                    {p.features.filter(f => f.included).slice(0, 4).map((f, i) => (
                      <li key={i}>✓ {f.label}</li>
                    ))}
                  </ul>
                  <Link to={`/plans/${key}`} className="account__upgrade-detail-link">
                    See full details
                  </Link>
                  <button
                    className="account__btn account__upgrade-cta"
                    style={{ background: p.color }}
                    onClick={() => handleUpgrade(key)}
                    disabled={upgrading === key}
                  >
                    <Zap size={13} />
                    {upgrading === key ? 'Loading…' : p.cta}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
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
