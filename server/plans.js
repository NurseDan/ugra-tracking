export const PLAN_LIMITS = {
  free: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: 1,
    aiCallsPerMonth: 5,
    canExport: true,
  },
  pro: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: 8,
    aiCallsPerMonth: Infinity,
    canExport: true,
  },
  admin: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: Infinity,
    aiCallsPerMonth: Infinity,
    canExport: true,
  },
}

export const limitsFor = plan => PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
