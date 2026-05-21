import React, { useState, useEffect } from 'react'
import { MapPin, Plus, Trash2, Home } from 'lucide-react'
import { listProperties, deleteProperty } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { GAUGES } from '../config/gauges'
import { alertColor } from '../lib/alertColors'

export default function SafeZoneManager({ gaugesData, onAddClick }) {
  const { session } = useAuth()
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) {
      setProperties([])
      setLoading(false)
      return
    }
    fetchProperties()
    window.addEventListener('refresh_properties', fetchProperties)
    return () => window.removeEventListener('refresh_properties', fetchProperties)
  }, [session])

  async function fetchProperties() {
    try {
      const data = await listProperties()
      setProperties(data)
    } catch (err) {
      console.error('Failed to fetch properties:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this property?')) return
    await deleteProperty(id)
    fetchProperties()
  }

  if (!session) return null

  return (
    <div className="glass-panel" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Home size={20} color="var(--apple-blue)" /> My Safe Zones
          </h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Personalized property monitoring</p>
        </div>
        <button 
          onClick={onAddClick}
          className="landing-btn landing-btn--primary" 
          style={{ padding: '6px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <MapPin size={14} /> Add Property
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading properties...</div>
      ) : properties.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>You haven't saved any properties yet.</div>
          <button onClick={onAddClick} style={{ background: 'transparent', color: 'var(--apple-blue)', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
            Click the map to drop a pin →
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {properties.map(p => {
            const gauge = GAUGES.find(g => g.id === p.nearest_gauge_id)
            const d = gaugesData[p.nearest_gauge_id]
            const color = alertColor(d?.alert)
            const atRisk = d?.alert && d.alert !== 'GREEN' && d.alert !== 'NORMAL'

            return (
              <div key={p.id} style={{ 
                background: atRisk ? 'rgba(255,69,58,0.1)' : 'rgba(0,0,0,0.2)', 
                border: `1px solid ${atRisk ? 'rgba(255,69,58,0.3)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 12, padding: 16, display: 'flex', justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '1.1rem', marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Linked to: {gauge?.name || p.nearest_gauge_id}</div>
                  <div style={{ marginTop: 12, fontSize: '0.85rem', color: atRisk ? 'var(--alert-red)' : 'var(--text-muted)' }}>
                    {atRisk ? (
                      <span style={{ fontWeight: 600 }}>Warning: Nearest gauge is surging.</span>
                    ) : (
                      <span>Property is currently safe.</span>
                    )}
                  </div>
                </div>
                <div>
                  <button onClick={() => handleDelete(p.id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
