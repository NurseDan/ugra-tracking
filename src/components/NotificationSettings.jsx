import React, { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, AlertCircle, Send, Check } from 'lucide-react'
import {
  getPermissionState,
  requestPermission,
  getSubscribedGauges,
  subscribeToGauge,
  unsubscribeFromGauge,
  isNwsAlertsEnabled,
  setNwsAlertsEnabled,
  sendTestNotification,
  isSupported,
  ensureServiceWorker
} from '../lib/notifications'
import './NotificationSettings.css'

export default function NotificationSettings({ gauges = [] }) {
  const supported = isSupported()
  const [permission, setPermission] = useState(() => (supported ? getPermissionState() : 'unsupported'))
  const [subscribed, setSubscribed] = useState(() => new Set(getSubscribedGauges()))
  const [nwsOn, setNwsOn] = useState(() => isNwsAlertsEnabled())
  const [testStatus, setTestStatus] = useState(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (supported && permission === 'granted') {
      ensureServiceWorker()
    }
  }, [supported, permission])

  const refreshSubscribed = useCallback(() => {
    setSubscribed(new Set(getSubscribedGauges()))
  }, [])

  const handleRequest = useCallback(async () => {
    setRequesting(true)
    const result = await requestPermission()
    setPermission(result)
    setRequesting(false)
    if (result === 'granted') ensureServiceWorker()
  }, [])

  const toggleGauge = useCallback(
    (id) => {
      if (subscribed.has(id)) {
        unsubscribeFromGauge(id)
      } else {
        subscribeToGauge(id)
      }
      refreshSubscribed()
    },
    [subscribed, refreshSubscribed]
  )

  const toggleNws = useCallback(() => {
    const next = !nwsOn
    setNwsAlertsEnabled(next)
    setNwsOn(next)
  }, [nwsOn])

  const handleTest = useCallback(async () => {
    setTestStatus({ loading: true })
    const result = await sendTestNotification()
    setTestStatus({ loading: false, ok: result.ok, message: result.reason })
    setTimeout(() => setTestStatus(null), 4000)
  }, [])

  if (!supported) {
    return (
      <div className="notif-settings glass-panel">
        <div className="notif-header">
          <BellOff size={20} />
          <h3>Notifications</h3>
        </div>
        <div className="notif-error">
          <AlertCircle size={16} />
          <span>Your browser does not support web notifications.</span>
        </div>
      </div>
    )
  }

  const canEnable = permission === 'granted'

  return (
    <div className="notif-settings glass-panel">
      <div className="notif-header">
        {canEnable ? <BellRing size={20} color="#10b981" /> : <Bell size={20} />}
        <h3>Notifications</h3>
        <span className={`notif-perm notif-perm--${permission}`}>{permissionLabel(permission)}</span>
      </div>

      {permission !== 'granted' && (
        <div className="notif-perm-block">
          {permission === 'denied' ? (
            <div className="notif-error">
              <AlertCircle size={16} />
              <span>
                Notifications are blocked. Open your browser site settings and allow notifications for this
                site, then reload.
              </span>
            </div>
          ) : (
            <>
              <p className="notif-help">
                Get a browser notification when a watched gauge crosses Watch / Warning / Major, or when a
                Flash Flood Warning hits a watched area.
              </p>
              <button
                type="button"
                className="notif-primary-btn"
                onClick={handleRequest}
                disabled={requesting}
              >
                {requesting ? 'Requesting…' : 'Enable notifications'}
              </button>
            </>
          )}
        </div>
      )}

      {canEnable && (
        <>
          <div className="notif-row notif-row--master">
            <label className="notif-toggle">
              <input type="checkbox" checked={nwsOn} onChange={toggleNws} />
              <span className="notif-toggle-track" />
              <span className="notif-toggle-label">Notify me about NWS flood alerts</span>
            </label>
          </div>

          <div className="notif-section-title">Watched gauges</div>
          {gauges.length === 0 ? (
            <div className="notif-help">No gauges available.</div>
          ) : (
            <ul className="notif-gauge-list">
              {gauges.map((g) => {
                const id = g.id
                const on = subscribed.has(id)
                return (
                  <li key={id} className="notif-row">
                    <label className="notif-toggle">
                      <input type="checkbox" checked={on} onChange={() => toggleGauge(id)} />
                      <span className="notif-toggle-track" />
                      <span className="notif-toggle-label">{g.shortName || g.name || id}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="notif-test-row">
            <button type="button" className="notif-secondary-btn" onClick={handleTest} disabled={testStatus?.loading}>
              <Send size={14} />
              {testStatus?.loading ? 'Sending…' : 'Send test notification'}
            </button>
            {testStatus && !testStatus.loading && (
              <span className={`notif-test-status ${testStatus.ok ? 'ok' : 'err'}`}>
                {testStatus.ok ? <><Check size={14} /> Sent</> : testStatus.message || 'Failed'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function permissionLabel(state) {
  switch (state) {
    case 'granted': return 'Enabled'
    case 'denied': return 'Blocked'
    case 'default': return 'Not yet allowed'
    case 'unsupported': return 'Unsupported'
    default: return state
  }
}
