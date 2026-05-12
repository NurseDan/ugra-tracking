import React, { useState } from 'react'
import { X, Check, Zap } from 'lucide-react'
import { createCheckoutSession } from '../lib/api'

const PRICING = {
  member: { name: 'Kerr County Member', price: '$4.99/mo', color: '#10b981', priceId: import.meta.env.VITE_STRIPE_PRICE_MEMBER },
  pro:    { name: 'Pro',               price: '$9.99/mo', color: '#6366f1', priceId: import.meta.env.VITE_STRIPE_PRICE_PRO },
  pro_plus: { name: 'Pro+',            price: '$19.99/mo', color: '#f59e0b', priceId: import.meta.env.VITE_STRIPE_PRICE_PRO_PLUS },
}

const TIER_FEATURES = {
  member:   ['Push notifications', '5 alert subscriptions', 'Real-time dashboard'],
  pro:      ['Everything in Member', '15 subscriptions', 'SMS & email alerts', 'AI river briefings (20/day)'],
  pro_plus: ['Everything in Pro', 'Unlimited subscriptions', 'Data exports', 'Webhooks', 'Unlimited AI briefings'],
}

export default function UpgradeModal({ requiredTier = 'member', feature = 'this feature', onClose }) {
  const [busy, setBusy] = useState(null)

  const tiers = requiredTier === 'pro_plus'
    ? ['pro_plus']
    : requiredTier === 'pro'
      ? ['pro', 'pro_plus']
      : ['member', 'pro', 'pro_plus']

  async function handleUpgrade(tierKey) {
    const { priceId } = PRICING[tierKey]
    if (!priceId) {
      window.location.href = '/pricing'
      return
    }
    setBusy(tierKey)
    try {
      const { url } = await createCheckoutSession(priceId)
      window.location.href = url
    } catch {
      setBusy(null)
    }
  }

  return (
    <div className="upgrade-modal-overlay" onClick={onClose}>
      <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
        <button className="upgrade-modal__close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="upgrade-modal__header">
          <div className="upgrade-modal__icon"><Zap size={22} /></div>
          <h2 className="upgrade-modal__title">Upgrade to unlock {feature}</h2>
          <p className="upgrade-modal__sub">Choose a plan to get started</p>
        </div>

        <div className="upgrade-modal__cards">
          {tiers.map(key => {
            const t = PRICING[key]
            return (
              <div key={key} className="upgrade-modal__card" style={{ '--plan-color': t.color }}>
                <div className="upgrade-modal__card-name">{t.name}</div>
                <div className="upgrade-modal__card-price">{t.price}</div>
                <ul className="upgrade-modal__features">
                  {TIER_FEATURES[key].map(f => (
                    <li key={f}><Check size={13} /> {f}</li>
                  ))}
                </ul>
                <button
                  className="upgrade-modal__btn"
                  style={{ background: t.color }}
                  onClick={() => handleUpgrade(key)}
                  disabled={busy === key}
                >
                  {busy === key ? 'Redirecting…' : `Upgrade to ${t.name}`}
                </button>
              </div>
            )
          })}
        </div>
        <p className="upgrade-modal__footer">
          <a href="/pricing">Compare all plans →</a>
        </p>
      </div>
    </div>
  )
}
