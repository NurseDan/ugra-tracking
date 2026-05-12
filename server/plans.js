export const PLAN_LIMITS = {
  free:     { maxSubscriptions: 0,        allowedChannels: [],                               aiCallsPerDay: 0,        canExport: false },
  member:   { maxSubscriptions: 5,        allowedChannels: ['push'],                         aiCallsPerDay: 0,        canExport: false },
  pro:      { maxSubscriptions: 15,       allowedChannels: ['push', 'email', 'sms'],         aiCallsPerDay: 20,       canExport: false },
  pro_plus: { maxSubscriptions: Infinity, allowedChannels: ['push', 'email', 'sms', 'webhook'], aiCallsPerDay: Infinity, canExport: true  },
  admin:    { maxSubscriptions: Infinity, allowedChannels: ['push', 'email', 'sms', 'webhook'], aiCallsPerDay: Infinity, canExport: true  },
}

export const limitsFor = plan => PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
