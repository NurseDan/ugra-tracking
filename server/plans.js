export const PLAN_LIMITS = {
  // The platform is free for everyone. Logged-in users get push alerts and
  // a handful of subscriptions out of the box. Server-funded AI is still
  // gated, but users can attach their own LLM key (BYOK) for unlimited use.
  free: {
    maxSubscriptions: 5,
    allowedChannels: ['push'],
    aiCallsPerDay: 0,
    canExport: true,
  },
  member: {
    maxSubscriptions: 5,
    allowedChannels: ['push'],
    aiCallsPerDay: 0,
    canExport: false,
  },
  pro: {
    maxSubscriptions: 15,
    allowedChannels: ['push', 'email', 'sms'],
    aiCallsPerDay: 20,
    canExport: false,
  },
  pro_plus: {
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
