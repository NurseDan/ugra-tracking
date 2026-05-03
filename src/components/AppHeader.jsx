import React, { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Activity, AlertTriangle, Bell, Clock, History, X } from 'lucide-react'
import { ALERT_LEVELS } from '../lib/alertEngine'
import { formatCDT } from '../lib/formatTime'
import { GAUGES } from '../config/gauges'
import NotificationSettings from './NotificationSettings'
import './AppHeader.css'

export default function AppHeader({ highestAlert, lastUpdate }) {
  const [notifOpen, setNotifOpen] = useState(false)

  useEffect(() => {
    if (!notifOpen) return
    const onKey = (e) => { if (e.key === 'Escape') setNotifOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [notifOpen])

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <Link to="/" className="header-title app-header__brand">
            <Activity size={28} color="#60a5fa" />
            Guadalupe Sentinel
          </Link>

          <nav className="app-header__nav">
            <NavLink end to="/" className={({ isActive }) => `app-header__link ${isActive ? 'is-active' : ''}`}>
              Dashboard
            </NavLink>
            <NavLink to="/incidents" className={({ isActive }) => `app-header__link ${isActive ? 'is-active' : ''}`}>
              <History size={14} /> Incidents
            </NavLink>
            <button
              type="button"
              className="app-header__notif-btn"
              onClick={() => setNotifOpen(true)}
              aria-label="Open notification settings"
            >
              <Bell size={14} /> Notifications
            </button>
          </nav>

          <div className="header-meta app-header__meta">
            <div className={`alert-badge ${highestAlert}`}>
              <AlertTriangle size={14} /> {ALERT_LEVELS[highestAlert]?.label || 'Normal'}
            </div>
            <div className="header-time" style={{ marginTop: 6 }}>
              <Clock size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {lastUpdate ? formatCDT(lastUpdate) : 'Loading…'}
            </div>
          </div>
        </div>
      </header>

      {notifOpen && (
        <div
          className="notif-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Notification settings"
          onClick={(e) => { if (e.target === e.currentTarget) setNotifOpen(false) }}
        >
          <div className="notif-modal-panel">
            <button
              type="button"
              className="notif-modal-close"
              onClick={() => setNotifOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <NotificationSettings gauges={GAUGES} />
          </div>
        </div>
      )}
    </>
  )
}
