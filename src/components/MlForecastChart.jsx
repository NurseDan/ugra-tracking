import React, { useState, useEffect } from 'react'
import { Cpu } from 'lucide-react'

export default function MlForecastChart({ gaugeId }) {
  const [forecast, setForecast] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ml/forecasts')
      .then(r => r.json())
      .then(data => {
        if (data && data[gaugeId]) setForecast(data[gaugeId])
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load ML forecast', err)
        setLoading(false)
      })
  }, [gaugeId])

  if (loading) return <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Loading AI predictions...</div>
  if (!forecast || forecast.length < 2) return null

  const PADDING = { top: 20, right: 16, bottom: 40, left: 52 }
  const W = 900
  const H = 200
  const chartW = W - PADDING.left - PADDING.right
  const chartH = H - PADDING.top - PADDING.bottom

  const heights = forecast.map(f => f.height)
  const times = forecast.map(f => new Date(f.time).getTime())

  const minVal = Math.max(0, Math.min(...heights) - 1)
  const maxVal = Math.max(...heights) + 1

  const minTime = times[0]
  const maxTime = times[times.length - 1]
  const timeRange = maxTime - minTime || 1

  function xPos(ts) {
    return PADDING.left + ((ts - minTime) / timeRange) * chartW
  }
  function yPos(val) {
    return PADDING.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH
  }

  const polylinePoints = forecast.map(p => {
    return `${xPos(new Date(p.time).getTime()).toFixed(1)},${yPos(p.height).toFixed(1)}`
  }).join(' ')

  const areaPoints = `${xPos(minTime).toFixed(1)},${(PADDING.top + chartH).toFixed(1)} ${polylinePoints} ${xPos(maxTime).toFixed(1)},${(PADDING.top + chartH).toFixed(1)}`

  return (
    <div className="glass-panel" style={{ borderLeft: '4px solid #0A84FF', marginTop: 24 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#f8fafc' }}>
        <Cpu size={20} color="#0A84FF" />
        Local AI Prediction (12hr)
        <span style={{ fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(10, 132, 255, 0.2)', borderRadius: 12, color: '#64D2FF' }}>PRO</span>
      </h3>
      <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 16 }}>
        This custom neural network is trained locally on historical gauge data and flow dynamics to predict the next 12 hours.
      </p>
      
      <div style={{ position: 'relative', width: '100%', height: H }}>
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ overflow: 'visible' }}
        >
          {/* Y-axis ticks */}
          {[minVal, (minVal + maxVal)/2, maxVal].map((val, i) => {
            const y = yPos(val)
            return (
              <g key={i}>
                <line x1={PADDING.left} y1={y} x2={PADDING.left + chartW} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <text x={PADDING.left - 6} y={y + 4} textAnchor="end" fill="#64748b" fontSize={11}>
                  {val.toFixed(1)}
                </text>
              </g>
            )
          })}

          {/* X-axis ticks */}
          {forecast.map((f, i) => {
            if (i % 3 !== 0 && i !== forecast.length - 1) return null
            const x = xPos(new Date(f.time).getTime())
            const d = new Date(f.time)
            const label = `${d.getHours() % 12 || 12}${d.getHours() >= 12 ? 'p' : 'a'}`
            return (
              <g key={i}>
                <line x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + chartH} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
                <text x={x} y={PADDING.top + chartH + 16} textAnchor="middle" fill="#64748b" fontSize={10}>
                  {label}
                </text>
              </g>
            )
          })}

          <polygon points={areaPoints} fill="#0A84FF" fillOpacity={0.15} stroke="none" />
          <polyline fill="none" stroke="#64D2FF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" points={polylinePoints} />
          
          {forecast.map((f, i) => (
            <circle key={i} cx={xPos(new Date(f.time).getTime())} cy={yPos(f.height)} r={3} fill="#0A84FF" stroke="#000" strokeWidth={1} />
          ))}
        </svg>
      </div>
    </div>
  )
}
