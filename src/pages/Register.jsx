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

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '' })
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  function set(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErr(null); setLoading(true)
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(form)
      })
      const body = await r.json()
      if (!r.ok) { setErr(body.error || 'Registration failed'); return }
      navigate('/my-alerts')
    } catch {
      setErr('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 480, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>Create account</h2>
      <p style={{ color: '#aaa', fontSize: 14, marginBottom: 20 }}>
        Free accounts include 1 alert subscription. <Link to="/pricing" style={{ color: '#3b82f6' }}>
          See Pro plan
        </Link> for unlimited.
      </p>

      {err && (
        <div style={{ background: '#7f1d1d', color: '#fff', padding: 10, borderRadius: 4, marginBottom: 12, fontSize: 14 }}>
          {err}
        </div>
      )}

      <form onSubmit={onSubmit} style={formStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 13, color: '#ccc' }}>First name
            <input
              type="text" value={form.first_name} onChange={set('first_name')}
              autoComplete="given-name" style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 13, color: '#ccc' }}>Last name
            <input
              type="text" value={form.last_name} onChange={set('last_name')}
              autoComplete="family-name" style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
        </div>
        <label style={{ fontSize: 13, color: '#ccc' }}>Email
          <input
            type="email" value={form.email} onChange={set('email')}
            required autoComplete="email" style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 13, color: '#ccc' }}>Password (min 8 characters)
          <input
            type="password" value={form.password} onChange={set('password')}
            required minLength={8} autoComplete="new-password" style={{ ...inputStyle, marginTop: 4 }}
          />
        </label>
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? 'Creating account…' : 'Create free account'}
        </button>
      </form>

      <p style={{ fontSize: 13, color: '#888', marginTop: 16 }}>
        Already have an account? <Link to="/login" style={{ color: '#3b82f6' }}>Sign in</Link>
      </p>
    </div>
  )
}
