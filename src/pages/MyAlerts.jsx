import React, { useEffect, useState } from 'react'
import { GAUGES } from '../config/gauges'
import {
  getCurrentUser, listSubscriptions, createSubscription,
  deleteSubscription, testSubscription
} from '../lib/api'
import { subscribeBrowserToPush } from '../lib/pushSubscribe'

const LEVELS = ['YELLOW', 'ORANGE', 'RED', 'BLACK']
const CHANNELS = ['push', 'email', 'webhook', 'sms']

export default function MyAlerts() {
  const [user, setUser] = useState(undefined) // undefined=loading, null=anon
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  // form state
  const [gaugeId, setGaugeId] = useState('')
  const [minLevel, setMinLevel] = useState('ORANGE')
  const [channels, setChannels] = useState({ push: true, email: false, webhook: false, sms: false })
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    setLoading(true)
    setErr(null)
    try {
      const u = await getCurrentUser()
      setUser(u)
      if (u) setSubs(await listSubscriptions())
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setErr(null)
    try {
      const selectedChannels = Object.entries(channels).filter(([, v]) => v).map(([k]) => k)
      if (!selectedChannels.length) throw new Error('Pick at least one delivery channel')
      const body = {
        gauge_id: gaugeId || null,
        min_level: minLevel,
        channels: selectedChannels,
        email: channels.email ? email : null,
        phone: channels.sms ? phone : null,
        webhook_url: channels.webhook ? webhookUrl : null,
        webhook_secret: channels.webhook ? webhookSecret : null
      }
      if (channels.push) {
        body.push = await subscribeBrowserToPush()
      }
      await createSubscription(body)
      await refresh()
    } catch (e) { setErr(e.message) }
    finally { setSubmitting(false) }
  }

  async function onDelete(id) {
    if (!confirm('Delete this alert subscription?')) return
    try { await deleteSubscription(id); await refresh() } catch (e) { setErr(e.message) }
  }

  async function onTest(id) {
    try { await testSubscription(id); alert('Test fired — check your inbox / browser / webhook log.') }
    catch (e) { setErr(e.message) }
  }

  if (user === undefined || loading) {
    return <div style={{ padding: 24 }}>Loading…</div>
  }

  if (user === null) {
    return (
      <div style={{ padding: 24, maxWidth: 640 }}>
        <h2>My Alerts</h2>
        <p>Sign in with your Replit account to manage personal alert subscriptions.
           The dashboard, history, and exports stay public — only personalized alerts require an account.</p>
        <a href="/api/login" style={{
          display: 'inline-block', padding: '10px 16px', background: '#3b82f6',
          color: '#fff', textDecoration: 'none', borderRadius: 6
        }}>Sign in with Replit</a>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 880 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>My Alerts</h2>
        <div style={{ fontSize: 14, color: '#888' }}>
          {user.email || user.id} · <a href="/api/logout">Sign out</a>
        </div>
      </div>

      <p style={{ color: '#aaa', fontSize: 14 }}>
        Alerts are delivered server-side 24/7 — they fire even when you have no browser open.
      </p>

      {err && <div style={{ background: '#7f1d1d', color: '#fff', padding: 8, borderRadius: 4, margin: '8px 0' }}>{err}</div>}

      <h3>Add subscription</h3>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, background: '#1a1a1a', padding: 16, borderRadius: 8 }}>
        <label>Gauge:
          <select value={gaugeId} onChange={e => setGaugeId(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="">All gauges</option>
            {GAUGES.map(g => <option key={g.id} value={g.id}>{g.shortName || g.name}</option>)}
          </select>
        </label>
        <label>Notify when level reaches:
          <select value={minLevel} onChange={e => setMinLevel(e.target.value)} style={{ marginLeft: 8 }}>
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <fieldset style={{ border: '1px solid #333', padding: 8 }}>
          <legend>Delivery channels</legend>
          {CHANNELS.map(c => (
            <label key={c} style={{ marginRight: 16 }}>
              <input type="checkbox" checked={channels[c]} onChange={e => setChannels({ ...channels, [c]: e.target.checked })} />
              {' '}{c}
            </label>
          ))}
        </fieldset>
        {channels.email && (
          <label>Email (leave blank to use your Replit account email):
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ marginLeft: 8, width: 280 }} />
          </label>
        )}
        {channels.sms && (
          <div>
            <label>Phone:
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={{ marginLeft: 8, width: 200 }} />
            </label>
            <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 4 }}>
              SMS requires a Twilio connection on the server. Subscriptions are stored, but delivery will be marked
              "failed" until Twilio is connected.
            </div>
          </div>
        )}
        {channels.webhook && (
          <>
            <label>Webhook URL:
              <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} required style={{ marginLeft: 8, width: 380 }} />
            </label>
            <label>HMAC secret (optional):
              <input type="text" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} style={{ marginLeft: 8, width: 280 }} />
            </label>
          </>
        )}
        <button type="submit" disabled={submitting} style={{
          padding: '8px 16px', background: '#3b82f6', color: '#fff',
          border: 'none', borderRadius: 4, cursor: 'pointer', justifySelf: 'start'
        }}>
          {submitting ? 'Saving…' : 'Add subscription'}
        </button>
      </form>

      <h3 style={{ marginTop: 24 }}>Your subscriptions ({subs.length})</h3>
      {subs.length === 0 && <p style={{ color: '#888' }}>No subscriptions yet.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {subs.map(s => (
          <div key={s.id} style={{ background: '#1a1a1a', padding: 12, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div><strong>{s.gauge_id ? (GAUGES.find(g => g.id === s.gauge_id)?.shortName || s.gauge_id) : 'All gauges'}</strong> · ≥ {s.min_level}</div>
              <div style={{ fontSize: 13, color: '#aaa' }}>
                {(s.channels || []).join(', ')}
                {s.email && ` · ${s.email}`}
                {s.webhook_url && ` · ${s.webhook_url}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onTest(s.id)} style={{ padding: '4px 10px' }}>Test</button>
              <button onClick={() => onDelete(s.id)} style={{ padding: '4px 10px', color: '#ef4444' }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
