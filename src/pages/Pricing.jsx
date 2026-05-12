import React, { useState } from 'react'
import { Check, X as XIcon, Zap, Activity } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { createCheckoutSession } from '../lib/api'

const MONTHLY_PRICES = {
  member:   4.99,
  pro:      9.99,
  pro_plus: 19.99,
}
const YEARLY_MONTHLY_PRICES = {
  member:   3.99,
  pro:      7.99,
  pro_plus: 15.99,
}

const PRICE_IDS = {
  member:   { month: import.meta.env.VITE_STRIPE_PRICE_MEMBER,        year: import.meta.env.VITE_STRIPE_PRICE_MEMBER_YEAR },
  pro:      { month: import.meta.env.VITE_STRIPE_PRICE_PRO,           year: import.meta.env.VITE_STRIPE_PRICE_PRO_YEAR },
  pro_plus: { month: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS,      year: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS_YEAR },
}

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    tagline: 'View-only river monitoring',
    color: '#64748b',
    featured: false,
    features: [
      { label: 'Alert subscriptions',  value: 'None' },
      { label: 'Mobile push alerts',   value: false },
      { label: 'SMS & email alerts',   value: false },
      { label: 'AI river briefings',   value: false },
      { label: 'Data exports',         value: false },
      { label: 'Webhook integrations', value: false },
      { label: 'Early access features',value: false },
    ],
  },
  {
    key: 'member',
    name: 'Member',
    tagline: 'Essential alerts for Kerr County',
    color: '#10b981',
    featured: false,
    features: [
      { label: 'Alert subscriptions',  value: '5 gauges' },
      { label: 'Mobile push alerts',   value: true },
      { label: 'SMS & email alerts',   value: false },
      { label: 'AI river briefings',   value: false },
      { label: 'Data exports',         value: false },
      { label: 'Webhook integrations', value: false },
      { label: 'Early access features',value: false },
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: 'Multi-channel alerts + AI briefings',
    color: '#6366f1',
    featured: true,
    features: [
      { label: 'Alert subscriptions',  value: '15 gauges' },
      { label: 'Mobile push alerts',   value: true },
      { label: 'SMS & email alerts',   value: true },
      { label: 'AI river briefings',   value: '20 / day' },
      { label: 'Data exports',         value: false },
      { label: 'Webhook integrations', value: false },
      { label: 'Early access features',value: false },
    ],
  },
  {
    key: 'pro_plus',
    name: 'Pro+',
    tagline: 'Unlimited everything + data access',
    color: '#f59e0b',
    featured: false,
    features: [
      { label: 'Alert subscriptions',  value: 'Unlimited' },
      { label: 'Mobile push alerts',   value: true },
      { label: 'SMS & email alerts',   value: true },
      { label: 'AI river briefings',   value: 'Unlimited' },
      { label: 'Data exports',         value: true },
      { label: 'Webhook integrations', value: true },
      { label: 'Early access features',value: true },
    ],
  },
]

function FeatureValue({ value }) {
  if (value === true) return <Check size={16} className="pricing-check" />
  if (value === false) return <XIcon size={16} className="pricing-x" />
  return <span className="pricing-card__feature-text">{value}</span>
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false)
  const [busy, setBusy] = useState(null)
  const { session } = useAuth()

  async function handleCta(planKey) {
    if (planKey === 'free') return
    if (!session) {
      window.location.href = '/api/login'
      return
    }
    const priceId = yearly ? PRICE_IDS[planKey]?.year : PRICE_IDS[planKey]?.month
    if (!priceId) {
      window.location.href = '/account'
      return
    }
    setBusy(planKey)
    try {
      const { url } = await createCheckoutSession(priceId)
      window.location.href = url
    } catch {
      setBusy(null)
    }
  }

  return (
    <div className="pricing-page">
      <div className="pricing-page__header">
        <nav className="pricing-page__nav">
          <Link to="/" className="pricing-page__brand"><Activity size={20} color="#60a5fa" /> Track the Guad</Link>
          <div className="pricing-page__nav-links">
            {session
              ? <Link to="/" className="pricing-nav-link">Dashboard</Link>
              : <a href="/api/login" className="pricing-nav-link">Sign in</a>}
          </div>
        </nav>
        <h1 className="pricing-page__title">Simple, transparent pricing</h1>
        <p className="pricing-page__sub">Start free. Upgrade anytime for alerts, AI briefings, and data exports.</p>

        <div className="pricing-toggle" role="group" aria-label="Billing period">
          <button
            className={`pricing-toggle__btn${!yearly ? ' is-active' : ''}`}
            onClick={() => setYearly(false)}
          >Monthly</button>
          <button
            className={`pricing-toggle__btn${yearly ? ' is-active' : ''}`}
            onClick={() => setYearly(true)}
          >Yearly <span className="pricing-toggle__badge">Save 20%</span></button>
        </div>
      </div>

      <div className="pricing-grid">
        {PLANS.map(plan => {
          const isPaid = plan.key !== 'free'
          const price = yearly
            ? YEARLY_MONTHLY_PRICES[plan.key]
            : MONTHLY_PRICES[plan.key]

          return (
            <div
              key={plan.key}
              className={`pricing-card${plan.featured ? ' pricing-card--featured' : ''}`}
              style={{ '--plan-color': plan.color }}
            >
              {plan.featured && <div className="pricing-card__badge">Most popular</div>}
              <div className="pricing-card__name" style={{ color: plan.color }}>{plan.name}</div>
              <div className="pricing-card__tagline">{plan.tagline}</div>

              {isPaid ? (
                <div className="pricing-card__price">
                  <span className="pricing-card__amount">${price.toFixed(2)}</span>
                  <span className="pricing-card__period">/mo{yearly ? ' billed annually' : ''}</span>
                </div>
              ) : (
                <div className="pricing-card__price">
                  <span className="pricing-card__amount">$0</span>
                  <span className="pricing-card__period">/mo forever</span>
                </div>
              )}

              <ul className="pricing-card__features">
                {plan.features.map(f => (
                  <li key={f.label} className="pricing-card__feature">
                    <FeatureValue value={f.value} />
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>

              {isPaid && (
                <div className="pricing-card__detail-link">
                  <Link to={`/plans/${plan.key === 'pro_plus' ? 'pro-plus' : plan.key}`}>
                    See what's included →
                  </Link>
                </div>
              )}

              <button
                className="pricing-card__cta"
                style={plan.featured ? { background: plan.color } : {}}
                onClick={() => handleCta(plan.key)}
                disabled={busy === plan.key || plan.key === 'free'}
              >
                {plan.key === 'free'
                  ? (session ? 'Current plan' : 'Get started free')
                  : busy === plan.key
                    ? 'Redirecting…'
                    : `Upgrade to ${plan.name}`}
              </button>
            </div>
          )
        })}
      </div>

      <p className="pricing-page__footer">
        All plans include a 7-day money-back guarantee. Cancel anytime from your{' '}
        <Link to="/account">account settings</Link>.
      </p>
    </div>
  )
}
