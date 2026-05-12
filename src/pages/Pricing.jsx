import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X, Zap } from 'lucide-react'
import { PLAN_DETAILS, PLANS_ORDERED } from '../config/planDetails'
import { createCheckoutSession } from '../lib/api'
import { usePlan } from '../hooks/usePlan'

const PRICE_IDS_MONTHLY = {
  member:   import.meta.env.VITE_STRIPE_PRICE_MEMBER,
  pro:      import.meta.env.VITE_STRIPE_PRICE_PRO,
  pro_plus: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS,
}
const PRICE_IDS_YEARLY = {
  member:   import.meta.env.VITE_STRIPE_PRICE_MEMBER_YEAR,
  pro:      import.meta.env.VITE_STRIPE_PRICE_PRO_YEAR,
  pro_plus: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS_YEAR,
}

async function handleUpgrade(planKey, yearly) {
  const ids = yearly ? PRICE_IDS_YEARLY : PRICE_IDS_MONTHLY
  const priceId = ids[planKey]
  if (!priceId) return
  try {
    const { url } = await createCheckoutSession(priceId)
    window.location.href = url
  } catch {
    // Stripe not configured — silently no-op in dev
  }
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false)
  const { plan: currentPlan, isPaid, loading } = usePlan()

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <h1 className="pricing-hero__title">Simple, Transparent Pricing</h1>
        <p className="pricing-hero__sub">
          Choose the plan that fits your UGRA monitoring needs. Upgrade or cancel any time.
        </p>

        <div className="pricing-toggle">
          <button
            className={`pricing-toggle__btn${!yearly ? ' active' : ''}`}
            onClick={() => setYearly(false)}
          >Monthly</button>
          <button
            className={`pricing-toggle__btn${yearly ? ' active' : ''}`}
            onClick={() => setYearly(true)}
          >
            Yearly <span className="pricing-toggle__save">Save 20%</span>
          </button>
        </div>
      </div>

      <div className="pricing-grid">
        {PLANS_ORDERED.map(key => {
          const p = PLAN_DETAILS[key]
          const price = yearly ? p.yearlyMonthlyPrice : p.monthlyPrice
          const isCurrent = !loading && currentPlan === key
          const isFree = key === 'free'
          const isFeatured = p.badge === 'Most Popular'

          return (
            <div
              key={key}
              className={`pricing-card${isFeatured ? ' pricing-card--featured' : ''}${isCurrent ? ' pricing-card--current' : ''}`}
              style={{ '--plan-color': p.color }}
            >
              {p.badge && <div className="pricing-card__badge">{p.badge}</div>}
              {isCurrent && <div className="pricing-card__current-badge">Your Plan</div>}

              <div className="pricing-card__name">{p.name}</div>
              <div className="pricing-card__tagline">{p.tagline}</div>

              <div className="pricing-card__price">
                {isFree ? (
                  <span className="pricing-card__amount">Free</span>
                ) : (
                  <>
                    <span className="pricing-card__amount">${price.toFixed(2)}</span>
                    <span className="pricing-card__period">/mo{yearly ? ' billed annually' : ''}</span>
                  </>
                )}
              </div>

              <ul className="pricing-card__features">
                {p.features.map((f, i) => (
                  <li key={i} className={`pricing-card__feature${f.included ? '' : ' pricing-card__feature--no'}`}>
                    {f.included
                      ? <Check size={14} style={{ color: p.color, flexShrink: 0 }} />
                      : <X size={14} style={{ color: '#475569', flexShrink: 0 }} />
                    }
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>

              <div className="pricing-card__actions">
                {!isFree && (
                  <Link to={`/plans/${key}`} className="pricing-card__detail-link">
                    See full details
                  </Link>
                )}
                {isFree ? (
                  <Link to="/" className="pricing-card__cta pricing-card__cta--ghost">
                    View dashboard
                  </Link>
                ) : isCurrent ? (
                  <button className="pricing-card__cta pricing-card__cta--current" disabled>
                    Current plan
                  </button>
                ) : (
                  <button
                    className="pricing-card__cta"
                    style={{ background: p.color }}
                    onClick={() => handleUpgrade(key, yearly)}
                  >
                    <Zap size={14} /> {p.cta}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="pricing-footer">
        <p>All paid plans include a 7-day free trial. No credit card required to sign up for Free.</p>
        <p>Questions? Contact us at <a href="mailto:support@ugra.org" style={{ color: '#60a5fa' }}>support@ugra.org</a></p>
      </div>
    </div>
  )
}
