import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getCurrentUser, createCheckoutSession, createPortalSession } from '../lib/api'

const card = (highlight) => ({
  background: '#1a1a1a', borderRadius: 10, padding: 28,
  flex: '1 1 280px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 16,
  border: highlight ? '2px solid #3b82f6' : '1px solid #2a2a2a'
})
const badge = (color) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
  fontSize: 12, fontWeight: 700, background: color, color: '#fff', marginBottom: 4
})

function CheckItem({ children }) {
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: '#ccc' }}>
      <span style={{ color: '#10b981', marginTop: 1, flexShrink: 0 }}>✓</span>
      <span>{children}</span>
    </li>
  )
}
function XItem({ children }) {
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: '#555' }}>
      <span style={{ marginTop: 1, flexShrink: 0 }}>✗</span>
      <span>{children}</span>
    </li>
  )
}

const MONTHLY_PRICE = 5
const ANNUAL_PRICE = 48

export default function Pricing() {
  const navigate = useNavigate()
  const [user, setUser] = useState(undefined)
  const [billing, setBilling] = useState('monthly')  // 'monthly' | 'annual'
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
      const { url } = await createCheckoutSession(billing === 'annual')
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

  const saving = Math.round((1 - ANNUAL_PRICE / (MONTHLY_PRICE * 12)) * 100)

  return (
    <div style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>Plans &amp; Pricing</h2>
      <p style={{ color: '#aaa', fontSize: 15, marginBottom: 24 }}>
        24/7 flood alerts delivered to you even when your browser is closed. Start free, upgrade when you need more.
      </p>

      {err && (
        <div style={{ background: '#7f1d1d', color: '#fff', padding: 10, borderRadius: 4, marginBottom: 16, fontSize: 14 }}>
          {err}
        </div>
      )}

      {/* Billing toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={() => setBilling('monthly')} style={{
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13,
          background: billing === 'monthly' ? '#3b82f6' : '#1a1a1a',
          color: billing === 'monthly' ? '#fff' : '#888',
          border: billing === 'monthly' ? 'none' : '1px solid #333'
        }}>Monthly</button>
        <button onClick={() => setBilling('annual')} style={{
          padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13,
          background: billing === 'annual' ? '#3b82f6' : '#1a1a1a',
          color: billing === 'annual' ? '#fff' : '#888',
          border: billing === 'annual' ? 'none' : '1px solid #333'
        }}>Annual</button>
        {billing === 'annual' && (
          <span style={{ fontSize: 12, background: '#052e16', color: '#4ade80', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
            Save {saving}%
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>

        {/* Free */}
        <div style={card(false)}>
          <div>
            <div style={badge('#374151')}>Free</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>$0</div>
            <div style={{ color: '#888', fontSize: 13 }}>forever</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CheckItem>Live dashboard — all gauges &amp; map</CheckItem>
            <CheckItem>Historical charts &amp; incident log</CheckItem>
            <CheckItem>Data exports (CSV / JSON)</CheckItem>
            <CheckItem>1 alert subscription (push or email)</CheckItem>
            <CheckItem>20 AI briefing requests / month</CheckItem>
            <XItem>Multiple alert subscriptions</XItem>
            <XItem>SMS alerts</XItem>
            <XItem>Slack / Discord delivery</XItem>
            <XItem>Custom water-level thresholds</XItem>
            <XItem>Webhook delivery</XItem>
          </ul>
          <div style={{ marginTop: 'auto' }}>
            {user === undefined ? null : user ? (
              !isPro && <span style={{ fontSize: 13, color: '#10b981' }}>✓ Your current plan</span>
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
        <div style={card(true)}>
          <div>
            <div style={badge('#1d4ed8')}>Pro</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>
              {billing === 'annual'
                ? <>${Math.round(ANNUAL_PRICE / 12)}<span style={{ fontSize: 16, fontWeight: 400, color: '#888' }}>/mo</span></>
                : <>${MONTHLY_PRICE}<span style={{ fontSize: 16, fontWeight: 400, color: '#888' }}>/mo</span></>
              }
            </div>
            <div style={{ color: '#888', fontSize: 13 }}>
              {billing === 'annual' ? `$${ANNUAL_PRICE} billed annually` : 'billed monthly'} · cancel anytime
            </div>
            <div style={{ fontSize: 12, color: '#fbbf24', marginTop: 4 }}>✦ 7-day free trial</div>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CheckItem>Everything in Free</CheckItem>
            <CheckItem>Unlimited alert subscriptions</CheckItem>
            <CheckItem>SMS alerts (via Twilio)</CheckItem>
            <CheckItem>Slack &amp; Discord delivery</CheckItem>
            <CheckItem>Webhook delivery with HMAC signing</CheckItem>
            <CheckItem>Custom ft / cfs alert thresholds</CheckItem>
            <CheckItem>200 AI briefing requests / month</CheckItem>
            <CheckItem>Priority email support</CheckItem>
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
                {loading ? 'Redirecting…' : user ? `Start 7-day trial →` : 'Start with Pro →'}
              </button>
            )}
          </div>
        </div>

      </div>

      <p style={{ fontSize: 13, color: '#666', marginTop: 28 }}>
        Payments processed securely by Stripe. Cancel or change plans anytime from the billing portal.
        Questions? <a href="mailto:support@guadalupe-sentinel.com" style={{ color: '#3b82f6' }}>Contact us</a>.
      </p>
    </div>
  )
}
