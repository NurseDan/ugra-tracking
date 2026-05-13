import React, { useState } from 'react'
import { Activity, AlertTriangle, BarChart2, Map, RefreshCw, Zap, Shield, Bell } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const FEATURES = [
  {
    icon: <Activity size={22} color="#2F6B86" />,
    title: 'Live from the river',
    desc: 'Water levels and flow rates streamed in from six USGS gauges between Hunt and Comfort, refreshed every minute.'
  },
  {
    icon: <AlertTriangle size={22} color="#D9714A" />,
    title: 'Plain-language alerts',
    desc: 'Normal, elevated, warning, danger, critical — color-coded so a glance from the porch tells you what the river is doing.'
  },
  {
    icon: <BarChart2 size={22} color="#5B6FB7" />,
    title: '48-hour trends',
    desc: 'Sparklines and full charts show direction and rate-of-rise, with rolling 5-, 15-, and 60-minute changes for every gauge.'
  },
  {
    icon: <Map size={22} color="#5C7E5A" />,
    title: 'River-corridor map',
    desc: 'See every gauge plotted upstream-to-downstream on an interactive map with live color indicators per station.'
  },
  {
    icon: <RefreshCw size={22} color="#2F6B86" />,
    title: 'Bring your own AI',
    desc: 'Plug in your own OpenAI, Anthropic, Groq, or OpenRouter key for unlimited AI briefings — no platform quota, no surprise bills.'
  },
  {
    icon: <Zap size={22} color="#E0A04A" />,
    title: 'Surge detection',
    desc: 'A simple surge detector flags rapid upstream rises that often precede flash flooding downstream.'
  }
]

const GAUGES_PREVIEW = [
  { name: 'North Fork near Hunt', level: '4.2', flow: '312', alert: 'GREEN' },
  { name: 'Hunt', level: '6.8', flow: '891', alert: 'YELLOW' },
  { name: 'Kerrville', level: '8.1', flow: '2,140', alert: 'ORANGE' },
  { name: 'Center Point', level: '5.3', flow: '680', alert: 'GREEN' },
]

function PreviewCard({ gauge }) {
  const colors = {
    GREEN:  { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', text: '#10b981', label: 'Normal' },
    YELLOW: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b', label: 'Elevated' },
    ORANGE: { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)', text: '#f97316', label: 'Warning' },
  }
  const c = colors[gauge.alert]
  return (
    <div className="landing-preview-card" style={{ '--preview-color': c.text }}>
      <div className="landing-preview-card__top">
        <span className="landing-preview-card__name">{gauge.name}</span>
        <span className="landing-preview-card__badge" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>{c.label}</span>
      </div>
      <div className="landing-preview-card__metrics">
        <div>
          <div className="landing-preview-card__metric-label">Level</div>
          <div className="landing-preview-card__metric-value">{gauge.level}<span className="landing-preview-card__metric-unit"> ft</span></div>
        </div>
        <div>
          <div className="landing-preview-card__metric-label">Flow</div>
          <div className="landing-preview-card__metric-value">{gauge.flow}<span className="landing-preview-card__metric-unit"> cfs</span></div>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const { signInWithGoogle } = useAuth()
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    setLoading(true)
    await signInWithGoogle()
    setLoading(false)
  }

  return (
    <div className="landing-root">
      {/* Nav */}
      <nav className="landing-nav">
        <div className="landing-nav__brand">
          <Activity size={22} color="#2F6B86" />
          Track the Guad
        </div>
        <button className="landing-btn landing-btn--outline" onClick={handleSignIn} disabled={loading}>
          Sign in
        </button>
      </nav>

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero__badge"><Shield size={13} /> Free for the Hill Country</div>
        <h1 className="landing-hero__title">
          Eyes on the river,<br />from <span className="landing-gradient-text">Hunt to Comfort</span>
        </h1>
        <p className="landing-hero__sub">
          A neighborly flood-awareness dashboard for the upper Guadalupe. Live USGS readings,
          plain-language alerts, and trend charts — refreshed every minute and free for everyone
          who calls the Hill Country home.
        </p>
        <div className="landing-hero__cta">
          <button className="landing-btn landing-btn--primary landing-btn--lg" onClick={handleSignIn} disabled={loading}>
            {loading ? <span className="landing-spinner" /> : <GoogleIcon />}
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>
          <span className="landing-hero__cta-sub">Free to use · No credit card</span>
        </div>

        {/* Preview Cards */}
        <div className="landing-preview-grid">
          {GAUGES_PREVIEW.map(g => <PreviewCard key={g.name} gauge={g} />)}
        </div>
        <p className="landing-preview-note">Sample data — sign in for live readings</p>
      </section>

      {/* Features */}
      <section className="landing-features">
        <div className="landing-section-header">
          <h2 className="landing-section-title">Built for Hill Country folks</h2>
          <p className="landing-section-sub">For ranchers checking low-water crossings, parents at summer camp, tubers and outfitters, and anyone who needs to know what the Guadalupe is doing — right now.</p>
        </div>
        <div className="landing-features-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="landing-feature-card">
              <div className="landing-feature-card__icon">{f.icon}</div>
              <h3 className="landing-feature-card__title">{f.title}</h3>
              <p className="landing-feature-card__desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stations strip */}
      <section className="landing-stations">
        <div className="landing-section-header">
          <h2 className="landing-section-title">Six stations along the corridor</h2>
          <p className="landing-section-sub">Headwaters at Hunt down through Kerrville and on to Comfort. Each one is a low-water crossing or a town that watches the rise.</p>
        </div>
        <div className="landing-stations-list">
          {['North Fork near Hunt', 'Hunt', 'Above Kerrville', 'Kerrville', 'Center Point', 'Comfort'].map((name, i) => (
            <div key={name} className="landing-station-pill">
              <span className="landing-station-pill__num">{i + 1}</span>
              {name}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="landing-final-cta">
        <div className="landing-final-cta__inner glass-panel">
          <h2 className="landing-final-cta__title">Ready to keep an eye on the river?</h2>
          <p className="landing-final-cta__sub">Sign in free for live readings, trend charts, push alerts, and — if you want it — your own AI key for unlimited briefings.</p>
          <button className="landing-btn landing-btn--primary landing-btn--lg" onClick={handleSignIn} disabled={loading}>
            {loading ? <span className="landing-spinner" /> : <GoogleIcon />}
            {loading ? 'Redirecting…' : 'Continue with Google'}
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <span>© {new Date().getFullYear()} Track the Guad</span>
        <span>Data sourced from <a className="landing-footer-link" href="https://waterdata.usgs.gov" target="_blank" rel="noreferrer">USGS National Water Information System</a></span>
      </footer>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
    </svg>
  )
}
