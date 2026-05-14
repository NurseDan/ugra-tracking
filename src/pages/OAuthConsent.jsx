import React from 'react'
import { Link } from 'react-router-dom'
import { Shield, FileText, Lock } from 'lucide-react'

export default function OAuthConsent() {
  return (
    <div className="landing-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="landing-header">
        <div className="brand">
          <div className="logo" />
          <span className="name">Guadalupe Sentinel</span>
        </div>
        <nav className="nav-links">
          <Link to="/">Dashboard</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/api/login" className="login-btn">Sign In</Link>
        </nav>
      </header>

      <main style={{ flex: 1, padding: '4rem 1rem', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
        <div style={{
          background: 'rgba(30,30,30,0.8)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px',
          padding: '3rem',
          backdropFilter: 'blur(12px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(56, 189, 248, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8'
            }}>
              <Shield size={32} />
            </div>
          </div>

          <h1 style={{ textAlign: 'center', fontSize: '2rem', marginBottom: '1rem' }}>OAuth Consent & Privacy</h1>
          
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1.1rem', lineHeight: 1.6, textAlign: 'center', marginBottom: '3rem' }}>
            Guadalupe Sentinel uses Google OAuth to securely authenticate users. We only request the minimum necessary information to provide you with personalized river alerts and account management.
          </p>

          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <div style={{ padding: '2rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', color: '#38bdf8' }}>
                <Lock size={24} />
                <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#fff' }}>Privacy Policy</h2>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
                Learn how we handle your data, including your email address and profile information provided by Google.
              </p>
              <Link to="/privacy" style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 500 }}>
                Read Privacy Policy →
              </Link>
            </div>

            <div style={{ padding: '2rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', color: '#38bdf8' }}>
                <FileText size={24} />
                <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#fff' }}>Terms of Service</h2>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
                Review the terms and conditions for using the Guadalupe Sentinel platform and our alert services.
              </p>
              <Link to="/terms" style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 500 }}>
                Read Terms of Service →
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo" />
            <span>Guadalupe Sentinel</span>
          </div>
          <div className="footer-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
