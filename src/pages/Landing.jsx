import React from 'react'
import { Link } from 'react-router-dom'
import { Activity, Bell, Map, Zap, MessageSquare, Download, Shield, Clock } from 'lucide-react'

const ALERT_COLORS = {
  normal: '#10b981',
  early:  '#facc15',
  rapid:  '#f97316',
  danger: '#ef4444'
}

function HeroGauge({ name, stage, flow, level, color }) {
  return (
    <div style={{
      background: '#0f0f0f', border: `1px solid ${color}33`, borderRadius: 8,
      padding: '12px 16px', minWidth: 140
    }}>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{name}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{stage} ft</div>
      <div style={{ fontSize: 12, color: '#666' }}>{flow.toLocaleString()} cfs</div>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginTop: 4 }}>{level}</div>
    </div>
  )
}

function Feature({ icon: Icon, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{
        background: '#1a1a1a', borderRadius: 8, padding: 10, flexShrink: 0,
        border: '1px solid #222', color: '#3b82f6'
      }}>
        <Icon size={20} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{title}</div>
        <div style={{ color: '#888', fontSize: 13, lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  )
}

export default function Landing() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#e5e7eb', background: '#000', minHeight: '100vh' }}>

      {/* Nav */}
      <nav style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 32px', borderBottom: '1px solid #111', position: 'sticky', top: 0,
        background: '#00000099', backdropFilter: 'blur(8px)', zIndex: 100
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: '#fff' }}>
          <Activity size={22} color="#60a5fa" />
          <span style={{ fontWeight: 700, fontSize: 16 }}>Guadalupe Sentinel</span>
        </Link>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <Link to="/dashboard" style={{ color: '#888', fontSize: 14, textDecoration: 'none' }}>Dashboard</Link>
          <Link to="/pricing"   style={{ color: '#888', fontSize: 14, textDecoration: 'none' }}>Pricing</Link>
          <Link to="/login"     style={{ color: '#888', fontSize: 14, textDecoration: 'none' }}>Sign in</Link>
          <Link to="/register"  style={{
            padding: '7px 16px', background: '#2563eb', color: '#fff',
            borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 600
          }}>Get started free</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '80px 24px 60px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px',
          background: '#0c1a2e', border: '1px solid #1e3a5f', borderRadius: 20,
          fontSize: 12, color: '#60a5fa', marginBottom: 24
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          Live data · Updated every 5 minutes
        </div>

        <h1 style={{ fontSize: 'clamp(36px, 6vw, 60px)', fontWeight: 800, lineHeight: 1.1, margin: '0 0 20px' }}>
          Know before the{' '}
          <span style={{ color: '#3b82f6' }}>Guadalupe rises</span>
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2.5vw, 20px)', color: '#9ca3af', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.6 }}>
          Real-time river gauge monitoring with AI briefings and instant flood alerts —
          delivered to your phone, inbox, or Slack before it's too late.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/register" style={{
            padding: '13px 28px', background: '#2563eb', color: '#fff',
            borderRadius: 8, textDecoration: 'none', fontSize: 16, fontWeight: 700
          }}>
            Start monitoring free →
          </Link>
          <Link to="/dashboard" style={{
            padding: '13px 28px', background: '#111', color: '#ccc',
            border: '1px solid #222', borderRadius: 8, textDecoration: 'none', fontSize: 16
          }}>
            View live dashboard
          </Link>
        </div>
      </section>

      {/* Live gauge preview */}
      <section style={{ padding: '0 24px 72px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{
          background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 12, padding: 24
        }}>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>
            CURRENT CONDITIONS — Guadalupe River Basin
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <HeroGauge name="New Braunfels" stage="14.2" flow={3820} level="NORMAL"  color={ALERT_COLORS.normal} />
            <HeroGauge name="Seguin"        stage="18.7" flow={5140} level="EARLY RISE" color={ALERT_COLORS.early}  />
            <HeroGauge name="Cuero"         stage="22.1" flow={8900} level="RAPID RISE" color={ALERT_COLORS.rapid}  />
            <HeroGauge name="Victoria"      stage="31.4" flow={14200} level="DANGER"   color={ALERT_COLORS.danger} />
          </div>
          <div style={{ fontSize: 11, color: '#333', marginTop: 16 }}>
            Sample data for illustration · <Link to="/dashboard" style={{ color: '#555' }}>See live readings →</Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '0 24px 80px', maxWidth: 860, margin: '0 auto' }}>
        <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 700, marginBottom: 48 }}>
          Everything you need to stay ahead of flooding
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 32 }}>
          <Feature icon={Map} title="Live gauge map">
            Interactive map of every USGS gauge in the Guadalupe basin. Color-coded alert levels update every 5 minutes so you know exactly where the river is rising.
          </Feature>
          <Feature icon={Zap} title="AI river briefings">
            GPT-powered plain-English summaries combining gauge data, NWS forecasts, Canyon Lake spillway status, and upstream storm totals — one read per gauge.
          </Feature>
          <Feature icon={Bell} title="Multi-channel alerts">
            Push notifications, email, SMS, Slack, and Discord. Alerts fire server-side 24/7 — you don't need the app open. Set your own ft/cfs trigger thresholds on Pro.
          </Feature>
          <Feature icon={MessageSquare} title="NWS flood warnings">
            Flash Flood Warnings, Watches, and Advisories from the National Weather Service overlaid on the map and forwarded directly to your subscriptions.
          </Feature>
          <Feature icon={Clock} title="Surge & arrival forecasts">
            Rise-rate engine estimates when a surge detected upstream will arrive at your gauge based on current flow speed and channel distance.
          </Feature>
          <Feature icon={Download} title="Data exports">
            Download historical stage and flow readings as CSV or JSON for any gauge, any date range. All gauge data retained for five years.
          </Feature>
        </div>
      </section>

      {/* CTA / pricing strip */}
      <section style={{
        background: '#0c1529', borderTop: '1px solid #1e3a5f', borderBottom: '1px solid #1e3a5f',
        padding: '56px 24px', textAlign: 'center'
      }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Ready to start monitoring?</h2>
        <p style={{ color: '#9ca3af', marginBottom: 32, fontSize: 15 }}>
          Free accounts include 1 alert subscription and 20 AI briefings per month.<br />
          Pro unlocks unlimited subscriptions, SMS, Slack, Discord, and custom thresholds.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/register" style={{
            padding: '12px 28px', background: '#2563eb', color: '#fff',
            borderRadius: 8, textDecoration: 'none', fontSize: 15, fontWeight: 700
          }}>
            Create free account →
          </Link>
          <Link to="/pricing" style={{
            padding: '12px 28px', background: 'transparent', color: '#93c5fd',
            border: '1px solid #1e3a5f', borderRadius: 8, textDecoration: 'none', fontSize: 15
          }}>
            See Pro plan ($5/mo)
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '28px 32px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#555', fontSize: 13 }}>
          <Shield size={14} />
          Data sourced from USGS, NOAA/NWS, AHPS, and LCRA
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link to="/dashboard" style={{ color: '#555', fontSize: 13, textDecoration: 'none' }}>Dashboard</Link>
          <Link to="/pricing"   style={{ color: '#555', fontSize: 13, textDecoration: 'none' }}>Pricing</Link>
          <Link to="/login"     style={{ color: '#555', fontSize: 13, textDecoration: 'none' }}>Sign in</Link>
        </div>
      </footer>
    </div>
  )
}
