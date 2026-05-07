import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getCurrentUser, createCheckoutSession, createPortalSession } from '../lib/api'

const card = {
  background: '#1a1a1a', borderRadius: 10, padding: 28,
  flex: '1 1 280px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16
}
const badge = (color) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 12, fontWeight: 700, background: color, color: '#fff', marginBottom: 4
})
const checkItem = (children) => (
  <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: '#ccc' }}>
    <span style={{ color: '#10b981', marginTop: 1 }}>✓</span>
    <span>{children}</span>
  </li>
)
const xItem = (children) => (
  <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: '#555' }}>
    <span style={{ marginTop: 1 }}>✗</span>
    <span>{children}</span>
  </li>
)

export default function Pricing() {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => setUser(null))
  }, [])

  const isPro = user?.plan === 'pro'

  async function handleUpgrade() {
    if (!user) { navigate('/register'); return }
    setErr(null); setLoading(true)
    try {
      const { url } = await createCheckoutSession()
      window.location.href = url
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handlePortal() {
    setErr(null); setLoading(true)
    try {
      const { url } = await createPortalSession()
      window.location.href = url
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>Plans &amp; Pricing</h2>
      <p style={{ color: '#aaa', fontSize: 15, marginBottom: 32 }}>
        Guadalupe Sentinel delivers 24/7 flood alerts even when your browser is closed.
        Free accounts include one alert subscription to get started.
      </p>

      {err && (
        <div style={{ background: '#7f1d1d', color: '#fff', padding: 10, borderRadius: 4, marginBottom: 16, fontSize: 14 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* Free */}
        <div style={{ ...card, border: '1px solid #2a2a2a' }}>
          <div>
            <div style={badge('#374151')}>Free</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>$0</div>
            <div style={{ color: '#888', fontSize: 13 }}>forever</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checkItem('Live dashboard — all gauges & map')}
            {checkItem('Historical charts & incident log')}
            {checkItem('Data exports (CSV/JSON)')}
            {checkItem('1 alert subscription (push or email)')}
            {xItem('Multiple alert subscriptions')}
            {xItem('SMS alerts')}
            {xItem('Webhook delivery')}
          </ul>
          <div style={{ marginTop: 'auto' }}>
            {user === undefined ? null : user ? (
              <span style={{ fontSize: 13, color: '#10b981' }}>✓ Your current plan</span>
            ) : (
              <Link to="/register" style={{
                display: 'block', textAlign: 'center', padding: '10px 0',
                background: '#374151', color: '#fff', borderRadius: 4,
                textDecoration: 'none', fontWeight: 600
              }}>
                Get started free
              </Link>
            )}
          </div>
        </div>

        {/* Pro */}
        <div style={{ ...card, border: '2px solid #3b82f6' }}>
          <div>
            <div style={badge('#1d4ed8')}>Pro</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>$5<span style={{ fontSize: 16, fontWeight: 400, color: '#888' }}>/mo</span></div>
            <div style={{ color: '#888', fontSize: 13 }}>cancel anytime</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checkItem('Everything in Free')}
            {checkItem('Unlimited alert subscriptions')}
            {checkItem('SMS alerts (via Twilio)')}
            {checkItem('Webhook delivery with HMAC signing')}
            {checkItem('Priority email support')}
          </ul>
          <div style={{ marginTop: 'auto' }}>
            {isPro ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#10b981' }}>✓ You&apos;re on Pro</span>
                <button onClick={handlePortal} disabled={loading} style={{
                  padding: '10px 0', background: '#1e40af', color: '#fff',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 14
                }}>
                  Manage billing
                </button>
              </div>
            ) : (
              <button onClick={handleUpgrade} disabled={loading} style={{
                width: '100%', padding: '11px 0', background: '#2563eb', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: 15
              }}>
                {loading ? 'Redirecting…' : user ? 'Upgrade to Pro →' : 'Start with Pro →'}
              </button>
            )}
          </div>
        </div>

      </div>

      <p style={{ fontSize: 13, color: '#666', marginTop: 28 }}>
        Payments are securely processed by Stripe. You can cancel or change plans at any time
        from the billing portal. Questions? <a href="mailto:support@guadalupe-sentinel.com" style={{ color: '#3b82f6' }}>Contact us</a>.
      </p>
    </div>
  )
}
