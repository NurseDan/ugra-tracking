import React, { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Check, X as XIcon, ArrowLeft } from 'lucide-react'
import { PLAN_DETAILS, SLUG_TO_KEY } from '../config/planDetails'
import { useAuth } from '../context/AuthContext'
import { createCheckoutSession } from '../lib/api'

const BELOW = { member: null, pro: 'member', pro_plus: 'pro' }
const BELOW_LABEL = { member: null, pro: 'Member', pro_plus: 'Pro' }

export default function PlanDetail() {
  const { tier } = useParams()
  const planKey = SLUG_TO_KEY[tier]
  const plan = planKey ? PLAN_DETAILS[planKey] : null
  const [yearly, setYearly] = useState(false)
  const [busy, setBusy] = useState(false)
  const { session } = useAuth()

  if (!plan) {
    return (
      <div className="plan-detail-page">
        <div className="plan-detail__not-found">
          <h1>Plan not found</h1>
          <Link to="/pricing">← Back to pricing</Link>
        </div>
      </div>
    )
  }

  const price = yearly ? plan.yearlyMonthlyPrice : plan.monthlyPrice
  const priceIdKey = yearly ? plan.priceEnvYear : plan.priceEnvMonth

  async function handleUpgrade() {
    if (!session) { window.location.href = '/api/login'; return }
    const priceId = import.meta.env[priceIdKey]
    if (!priceId) { window.location.href = '/account'; return }
    setBusy(true)
    try {
      const { url } = await createCheckoutSession(priceId)
      window.location.href = url
    } catch { setBusy(false) }
  }

  const below = BELOW[planKey]
  const belowPlan = below ? PLAN_DETAILS[below] : null

  return (
    <div className="plan-detail-page">
      <div className="plan-detail__back">
        <Link to="/pricing"><ArrowLeft size={16} /> Back to all plans</Link>
      </div>

      {/* Hero */}
      <div className="plan-detail__hero" style={{ '--plan-color': plan.color }}>
        <div className="plan-detail__badge" style={{ background: plan.color }}>{plan.name}</div>
        <h1 className="plan-detail__title">{plan.tagline}</h1>

        <div className="pricing-toggle plan-detail__toggle" role="group">
          <button className={`pricing-toggle__btn${!yearly ? ' is-active' : ''}`} onClick={() => setYearly(false)}>Monthly</button>
          <button className={`pricing-toggle__btn${yearly ? ' is-active' : ''}`} onClick={() => setYearly(true)}>Yearly <span className="pricing-toggle__badge">Save 20%</span></button>
        </div>

        <div className="plan-detail__price">
          <span className="plan-detail__amount">${price.toFixed(2)}</span>
          <span className="plan-detail__period">/mo{yearly ? ' billed annually' : ''}</span>
        </div>

        <button
          className="plan-detail__cta"
          style={{ background: plan.color }}
          onClick={handleUpgrade}
          disabled={busy}
        >
          {busy ? 'Redirecting…' : `Upgrade to ${plan.name}`}
        </button>
      </div>

      {/* What's included */}
      <section className="plan-detail__section">
        <h2 className="plan-detail__section-title">What's included</h2>
        <ul className="plan-detail__features">
          {plan.features.map(f => (
            <li key={f.label} className="plan-detail__feature">
              <Check size={18} className="pricing-check" style={{ color: plan.color }} />
              <div>
                <strong>{f.label}</strong>
                <p>{f.desc}</p>
              </div>
            </li>
          ))}
          {plan.notIncluded.map(f => (
            <li key={f} className="plan-detail__feature plan-detail__feature--no">
              <XIcon size={18} className="pricing-x" />
              <div><strong>{f}</strong></div>
            </li>
          ))}
        </ul>
      </section>

      {/* Comparison vs. tier below */}
      {belowPlan && (
        <section className="plan-detail__section plan-detail__compare">
          <h2 className="plan-detail__section-title">{plan.name} vs. {belowPlan.name}</h2>
          <div className="plan-detail__compare-grid">
            <div className="plan-detail__compare-col">
              <div className="plan-detail__compare-header" style={{ color: belowPlan.color }}>{BELOW_LABEL[planKey]}</div>
              <ul>
                {belowPlan.features.map(f => <li key={f.label}><Check size={13} /> {f.label}</li>)}
              </ul>
            </div>
            <div className="plan-detail__compare-col plan-detail__compare-col--highlight" style={{ '--plan-color': plan.color }}>
              <div className="plan-detail__compare-header" style={{ color: plan.color }}>{plan.name} adds</div>
              <ul>
                {plan.features
                  .filter(f => !belowPlan.features.find(bf => bf.label === f.label))
                  .map(f => <li key={f.label}><Check size={13} style={{ color: plan.color }} /> {f.label}</li>)
                }
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* Use case */}
      <section className="plan-detail__section plan-detail__usecase">
        <blockquote className="plan-detail__quote" style={{ borderColor: plan.color }}>
          {plan.useCases}
        </blockquote>
      </section>

      <div className="plan-detail__footer-cta">
        <button
          className="plan-detail__cta"
          style={{ background: plan.color }}
          onClick={handleUpgrade}
          disabled={busy}
        >
          {busy ? 'Redirecting…' : `Get ${plan.name} — $${price.toFixed(2)}/mo`}
        </button>
        <Link to="/pricing" className="plan-detail__all-plans">View all plans</Link>
      </div>
    </div>
  )
}
