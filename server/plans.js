export const PLAN_LIMITS = {
  // The platform is fully free for everyone.
  free: {
    maxSubscriptions: Infinity,
    allowedChannels: ['push', 'email', 'sms', 'webhook'],
    aiCallsPerDay: Infinity,
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
