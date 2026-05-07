export const PLAN_LIMITS = {
  free: {
    maxSubscriptions: 2,
    allowedChannels: ['push'],
    aiCallsPerDay: 0
  },
  pro: {
    maxSubscriptions: 10,
    allowedChannels: ['push', 'email', 'webhook'],
    aiCallsPerDay: 50
  },
  admin: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'webhook', 'sms'],
    aiCallsPerDay: Infinity
  }
}

export const limitsFor = plan => PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
