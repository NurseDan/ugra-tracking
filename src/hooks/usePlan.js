import { useState, useEffect } from 'react'
import { getCurrentUser } from '../lib/api'

const TIER_ORDER = { free: 0, member: 1, pro: 2, pro_plus: 3, admin: 99 }

export function usePlan() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCurrentUser().then(u => {
      setUser(u)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const plan = user?.plan ?? 'free'
  const atLeast = tier => TIER_ORDER[plan] >= TIER_ORDER[tier]

  return {
    user,
    plan,
    loading,
    canAlert:  atLeast('member'),
    canSms:    atLeast('pro'),
    canExport: atLeast('pro_plus'),
    canAI:     atLeast('pro'),
    isPaid:    atLeast('member'),
  }
}
