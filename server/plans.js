export const PLAN_LIMITS = {
  free: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: 0,        // free users must bring their own key
    canExport: true,
  },
  pro: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: 50,       // server-funded, 50 calls/day
    canExport: true,
  },
  admin: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: Infinity,
    canExport: true,
  },
}

export const limitsFor = plan => PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
