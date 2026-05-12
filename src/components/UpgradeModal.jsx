import React from 'react'
import { Link } from 'react-router-dom'
import { X, Lock } from 'lucide-react'
import { PLAN_DETAILS } from '../config/planDetails'
import { createCheckoutSession } from '../lib/api'

const PRICE_IDS = {
  member:   import.meta.env.VITE_STRIPE_PRICE_MEMBER,
  pro:      import.meta.env.VITE_STRIPE_PRICE_PRO,
  pro_plus: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS,
}

async function startCheckout(planKey) {
  const priceId = PRICE_IDS[planKey]
  if (!priceId) { window.location.href = '/pricing'; return }
  try {
    const { url } = await createCheckoutSession(priceId)
    window.location.href = url
  } catch {
    window.location.href = '/pricing'
  }
}

export default function UpgradeModal({ requiredPlan = 'member', featureName = 'this feature', onClose }) {
  const tiers = requiredPlan === 'pro_plus'
    ? ['pro_plus']
    : requiredPlan === 'pro'
    ? ['pro', 'pro_plus']
    : ['member', 'pro', 'pro_plus']

  return (
    <div className="upgrade-modal-backdrop" onClick={onClose}>
      <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
        <button className="upgrade-modal__close" onClick={onClose}><X size={18} /></button>

        <div className="upgrade-modal__header">
          <Lock size={28} style={{ color: '#f59e0b' }} />
          <h2 className="upgrade-modal__title">Unlock {featureName}</h2>
          <p className="upgrade-modal__sub">Choose a plan to get access</p>
        </div>

        <div className="upgrade-modal__cards">
          {tiers.map(key => {
            const p = PLAN_DETAILS[key]
            return (
              <div key={key} className="upgrade-modal__card" style={{ '--plan-color': p.color }}>
                {p.badge && <div className="upgrade-modal__badge">{p.badge}</div>}
                <div className="upgrade-modal__plan-name">{p.name}</div>
                <div className="upgrade-modal__price">${p.monthlyPrice}<span>/mo</span></div>
                <ul className="upgrade-modal__features">
                  {p.features.filter(f => f.included).slice(0, 4).map((f, i) => (
                    <li key={i}>✓ {f.label}</li>
                  ))}
                </ul>
                <button
                  className="upgrade-modal__cta"
                  style={{ background: p.color }}
                  onClick={() => startCheckout(key)}
                >
                  {p.cta}
                </button>
              </div>
            )
          })}
        </div>

        <div className="upgrade-modal__footer">
          <Link to="/pricing" onClick={onClose} style={{ color: '#60a5fa', fontSize: '0.8rem' }}>
            Compare all plans →
          </Link>
        </div>
      </div>
    </div>
  )
}
