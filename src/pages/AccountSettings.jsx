import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { User, CreditCard, Bell, AlertTriangle, Zap, ExternalLink, Key, Radio } from 'lucide-react'
import {
  getCurrentUser, getUsage, updateProfile, updatePreferences,
  signOutEverywhere, deleteAccount, updateUserProfile,
  getLlmKey, saveLlmKey, deleteLlmKey,
  listMySensors, createSensor, deleteSensor,
} from '../lib/api'
import { ALERT_LEVELS } from '../lib/alertEngine'
import './AccountSettings.css'

const TABS = [
  { key: 'profile',  label: 'Profile',       icon: User },
  { key: 'usage',    label: 'Usage',         icon: CreditCard },
  { key: 'notif',    label: 'Notifications', icon: Bell },
  { key: 'ai',       label: 'AI key (BYOK)', icon: Key },
  { key: 'sensors',  label: 'Community sensors', icon: Radio },
  { key: 'danger',   label: 'Danger zone',   icon: AlertTriangle, danger: true }
]

const LEVELS = Object.keys(ALERT_LEVELS).filter(k => ALERT_LEVELS[k].priority >= 1)
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
        {tab === 'usage' && <UsageTab usage={usage} />}
        {tab === 'notif' && <NotificationsTab user={user} onSaved={refresh} flash={flash} />}
        {tab === 'ai' && <AiKeyTab flash={flash} />}
        {tab === 'sensors' && <SensorsTab flash={flash} />}
        {tab === 'danger' && <DangerTab flash={flash} />}
      </div>

      <div className="account__footer" style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
        <Link to="/privacy" style={{ color: 'inherit', textDecoration: 'none', marginRight: '1rem' }}>Privacy Policy</Link>
        <Link to="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>Terms of Service</Link>
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

function UsageTab({ usage }) {
  const subUsed = usage?.subscriptions.used ?? 0
  const subLimit = usage?.subscriptions.limit
  const aiUsed = usage?.aiCalls.used ?? 0
  const aiLimit = usage?.aiCalls.limit

  return (
    <>
      <h2 className="account__section-title">Usage</h2>
      <p className="account__section-desc">Your current consumption. Enjoy unlimited use of Guadalupe Sentinel.</p>

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

function AiKeyTab({ flash }) {
  const [state, setState] = useState(null)
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try { setState(await getLlmKey()) }
    catch (err) { flash('err', err.message) }
  }
  useEffect(() => { refresh() }, [])

  async function onSave(e) {
    e.preventDefault()
    if (!key.trim()) return flash('err', 'Paste an API key first.')
    setBusy(true)
    try {
      await saveLlmKey({ provider, model: model.trim() || undefined, key: key.trim() })
      setKey('')
      flash('ok', 'API key saved. Your AI calls now bill to your provider directly.')
      await refresh()
    } catch (err) { flash('err', err.message) }
    finally { setBusy(false) }
  }

  async function onRemove() {
    if (!window.confirm('Remove your stored API key? AI calls will fall back to the server quota.')) return
    setBusy(true)
    try {
      await deleteLlmKey()
      flash('ok', 'API key removed.')
      await refresh()
    } catch (err) { flash('err', err.message) }
    finally { setBusy(false) }
  }

  if (!state) return <div>Loading…</div>

  const providers = state.providers || []
  const current = providers.find(p => p.id === provider)

  return (
    <>
      <h2 className="account__section-title">Bring your own AI key</h2>
      <p className="account__section-desc">
        Attach an API key from any supported LLM provider and your briefings will
        bill directly to your account — no platform quotas, no hidden cost.
        Keys are sealed with AES-256-GCM at rest and never returned to the browser.
      </p>

      <div className="account__card">
        {state.configured ? (
          <>
            <div className="account__field">
              <span className="account__field-label">Active key</span>
              <span className="account__field-value">
                {state.provider} · ends in ••••{state.last_four} · {state.model || 'default model'}
              </span>
            </div>
            <button className="account__btn account__btn--ghost" onClick={onRemove} disabled={busy}>
              Remove key
            </button>
            <hr style={{ margin: '16px 0', border: 0, borderTop: '1px solid #eee' }} />
            <p className="account__section-desc">Replace it by entering a new key below.</p>
          </>
        ) : (
          <p className="account__section-desc">
            You haven't attached a key yet. Server-funded AI may be disabled on your plan;
            paste a key from your favorite provider to enable AI briefings.
          </p>
        )}

        <form onSubmit={onSave}>
          <div className="account__field">
            <label className="account__field-label" htmlFor="prov">Provider</label>
            <select id="prov" className="account__input" value={provider}
              onChange={e => { setProvider(e.target.value); setModel('') }}>
              {providers.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="account__field">
            <label className="account__field-label" htmlFor="mdl">Model (optional)</label>
            <input id="mdl" className="account__input" value={model}
              onChange={e => setModel(e.target.value)} maxLength={80}
              placeholder={current?.defaultModel || ''} />
            <span className="account__field-hint">
              Leave blank to use the provider default. Smaller models keep token costs low.
            </span>
          </div>
          <div className="account__field">
            <label className="account__field-label" htmlFor="apikey">API key</label>
            <input id="apikey" className="account__input" type="password" value={key}
              onChange={e => setKey(e.target.value)} autoComplete="off"
              placeholder="sk-..." />
            <span className="account__field-hint">
              Only the last four characters are kept for display.
            </span>
          </div>
          <button type="submit" className="account__btn" disabled={busy || !key.trim()}>
            {busy ? 'Saving…' : (state.configured ? 'Replace key' : 'Save key')}
          </button>
        </form>
      </div>
    </>
  )
}

function SensorsTab({ flash }) {
  const [sensors, setSensors] = useState(null)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState('water_level')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try { setSensors(await listMySensors()) }
    catch (err) { flash('err', err.message) }
  }
  useEffect(() => { refresh() }, [])

  async function onAdd(e) {
    e.preventDefault()
    if (!consent) return flash('err', 'You must consent before publishing a sensor.')
    setBusy(true)
    try {
      await createSensor({
        label: label.trim(),
        kind,
        lat: Number(lat),
        lng: Number(lng),
        is_public: isPublic,
        consent: true,
      })
      setLabel(''); setLat(''); setLng(''); setConsent(false)
      flash('ok', 'Sensor registered.')
      await refresh()
    } catch (err) { flash('err', err.message) }
    finally { setBusy(false) }
  }

  async function onDelete(id) {
    if (!window.confirm('Remove this sensor and all of its readings?')) return
    try {
      await deleteSensor(id)
      await refresh()
    } catch (err) { flash('err', err.message) }
  }

  return (
    <>
      <h2 className="account__section-title">Community sensors</h2>
      <p className="account__section-desc">
        Hosting a private rain gauge or water-level sensor? Register it here to
        contribute readings to the public map. Sharing is fully opt-in — toggle
        a sensor private at any time and it disappears from the public view.
        Ingest readings by POSTing to <code>/api/me/sensors/&lt;id&gt;/readings</code>.
      </p>

      <div className="account__card">
        <form onSubmit={onAdd}>
          <div className="account__field">
            <label className="account__field-label" htmlFor="slabel">Label</label>
            <input id="slabel" className="account__input" value={label}
              onChange={e => setLabel(e.target.value)} maxLength={120}
              placeholder="Back-pasture rain gauge" required />
          </div>
          <div className="account__fields-row">
            <div className="account__field">
              <label className="account__field-label" htmlFor="skind">Kind</label>
              <select id="skind" className="account__input" value={kind}
                onChange={e => setKind(e.target.value)}>
                <option value="water_level">Water level</option>
                <option value="rain">Rain</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="account__field">
              <label className="account__field-label" htmlFor="slat">Latitude</label>
              <input id="slat" className="account__input" value={lat}
                onChange={e => setLat(e.target.value)} placeholder="30.0469" required />
            </div>
            <div className="account__field">
              <label className="account__field-label" htmlFor="slng">Longitude</label>
              <input id="slng" className="account__input" value={lng}
                onChange={e => setLng(e.target.value)} placeholder="-99.1403" required />
            </div>
          </div>
          <div className="account__field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
              Publish readings on the public map
            </label>
          </div>
          <div className="account__field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
              <span>I confirm I own or operate this sensor and consent to sharing its
                location and readings with the community. I understand I can delete
                it at any time.</span>
            </label>
          </div>
          <button type="submit" className="account__btn" disabled={busy || !consent}>
            {busy ? 'Saving…' : 'Register sensor'}
          </button>
        </form>
      </div>

      <div className="account__card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Your sensors</h3>
        {sensors == null && <div>Loading…</div>}
        {sensors && sensors.length === 0 && <p>None yet.</p>}
        {sensors && sensors.map(s => (
          <div key={s.id} className="account__danger-row">
            <div className="account__danger-text">
              <strong>{s.label}</strong>
              <span>
                {s.kind} · {Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}
                {' · '}{s.is_public ? 'public' : 'private'}
              </span>
            </div>
            <button className="account__btn account__btn--ghost" onClick={() => onDelete(s.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
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
