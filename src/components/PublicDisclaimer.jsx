// PublicDisclaimer.jsx
// Issue #6: Public launch checklist - disclaimer, data sources, safety wording
import React from 'react'
import { ShieldAlert } from 'lucide-react'

export default function PublicDisclaimer({ compact = false }) {
  if (compact) {
    return (
      <div style={{
        background: 'rgba(15,23,42,0.7)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '8px 12px',
        fontSize: '11px',
        color: '#94a3b8',
        lineHeight: '1.4',
        marginTop: '8px'
      }}>
        <strong style={{ color: '#f8fafc' }}>Independent awareness tool.</strong>{' '}
        Does not replace NWS alerts, evacuation orders, or 911.
        During emergencies, follow official guidance.
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(234,179,8,0.08)',
      border: '1px solid rgba(234,179,8,0.25)',
      borderRadius: '12px',
      padding: '16px 20px',
      margin: '16px 0'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <ShieldAlert size={20} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#fef3c7', marginBottom: '6px' }}>
            Independent Situational Awareness Tool
          </p>
          <p style={{ fontSize: '12px', color: '#d1d5db', lineHeight: '1.6' }}>
            Guadalupe Sentinel is an independent situational awareness tool using public data.
            It does not replace official emergency alerts, evacuation orders, National Weather
            Service warnings, local emergency management instructions, or 911.
            During emergencies, follow official guidance and move to higher ground if
            conditions change quickly.
          </p>
          <div style={{
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            fontSize: '11px',
            color: '#94a3b8'
          }}>
            <strong style={{ color: '#f8fafc' }}>Data sources:</strong>{' '}
            USGS Real-Time Gauge Network
            {' • '}
            NOAA / National Water Prediction Service
            {' • '}
            Upper Guadalupe River Authority (UGRA) reference context
          </div>
          <p style={{ marginTop: '8px', fontSize: '11px', color: '#f97316', fontWeight: 600 }}>
            Never enter flooded low-water crossings. Call 911 for emergencies.
          </p>
        </div>
      </div>
    </div>
  )
}
