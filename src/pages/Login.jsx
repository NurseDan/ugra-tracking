import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

const formStyle = {
  display: 'flex', flexDirection: 'column', gap: 12,
  background: '#1a1a1a', padding: 24, borderRadius: 8, maxWidth: 400
}
const inputStyle = {
  padding: '8px 12px', borderRadius: 4, border: '1px solid #333',
  background: '#111', color: '#fff', fontSize: 15, width: '100%', boxSizing: 'border-box'
}
const btnStyle = {
  padding: '10px 16px', background: '#3b82f6', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 15, fontWeight: 600
}
const dividerStyle = {
  display: 'flex', alignItems: 'center', gap: 8, color: '#555', fontSize: 13, margin: '4px 0'
}

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  // Check whether Replit OIDC login is available by trying a HEAD on /api/login.
  // We just always show it; if it 503s the user gets a clear message from the server.
  const showReplitLogin = true

  async function onSubmit(e) {
    e.preventDefault()
    setErr(null); setLoading(true)
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password })
      })
      const body = await r.json()
      if (!r.ok) { setErr(body.error || 'Login failed'); return }
      navigate('/my-alerts')
    } catch {
      setErr('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>Sign in</h2>
      <p style={{ color: '#aaa', fontSize: 14, marginBottom: 20 }}>
        Sign in to manage your flood alert subscriptions.
      </p>

      {err && (
        <div style={{ background: '#7f1d1d', color: '#fff', padding: 10, borderRadius: 4, marginBottom: 12, fontSize: 14 }}>
          {err}
        </div>
      )}

      <form onSubmit={onSubmit} style={formStyle}>
        <label style={{ fontSize: 13, color: '#ccc' }}>Email
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            required autoComplete="email" style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13, color: '#ccc' }}>Password
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            required autoComplete="current-password" style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {showReplitLogin && (
        <>
          <div style={dividerStyle}>
            <div style={{ flex: 1, height: 1, background: '#333' }} />
            <span>or</span>
            <div style={{ flex: 1, height: 1, background: '#333' }} />
          </div>
          <a href="/api/login" style={{
            display: 'block', textAlign: 'center', padding: '10px 16px',
            background: '#1e293b', color: '#93c5fd', border: '1px solid #334155',
            borderRadius: 4, textDecoration: 'none', fontSize: 14, fontWeight: 500
          }}>
            Continue with Replit
          </a>
        </>
      )}

      <p style={{ fontSize: 13, color: '#888', marginTop: 16 }}>
        No account? <Link to="/register" style={{ color: '#3b82f6' }}>Create one free</Link>
      </p>
    </div>
  )
}
