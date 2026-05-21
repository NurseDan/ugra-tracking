import React, { useEffect, useRef } from 'react'
import { GAUGES } from '../config/gauges'

export default function RiverAnimation({ data }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animationId
    let time = 0

    const sortedGauges = [...GAUGES].filter(g => g.type === 'river').sort((a, b) => a.order - b.order)

    function render() {
      if (!ctx || !canvas) return
      
      const width = canvas.width
      const height = canvas.height
      
      // Responsive sizing based on parent container width if needed
      const parentWidth = canvas.parentElement.clientWidth
      if (width !== parentWidth) {
        canvas.width = parentWidth
        canvas.height = 160 // Fixed height
      }

      ctx.clearRect(0, 0, width, height)

      // Background
      const bgGradient = ctx.createLinearGradient(0, 0, 0, height)
      bgGradient.addColorStop(0, 'rgba(47, 107, 134, 0.0)')
      bgGradient.addColorStop(1, 'rgba(47, 107, 134, 0.15)')
      ctx.fillStyle = bgGradient
      ctx.fillRect(0, 0, width, height)

      const padding = 60
      const usableWidth = width - padding * 2
      const step = sortedGauges.length > 1 ? usableWidth / (sortedGauges.length - 1) : 0

      // Compute wave segments
      ctx.beginPath()
      ctx.moveTo(0, height)

      for (let i = 0; i <= width; i += 5) {
        // Find which gauges this x-coordinate falls between
        let leftGaugeIdx = 0
        let rightGaugeIdx = 0
        let progress = 0

        const xPos = i - padding
        
        if (xPos <= 0) {
          leftGaugeIdx = 0
          rightGaugeIdx = 0
          progress = 0
        } else if (xPos >= usableWidth) {
          leftGaugeIdx = sortedGauges.length - 1
          rightGaugeIdx = sortedGauges.length - 1
          progress = 1
        } else {
          leftGaugeIdx = Math.floor(xPos / step)
          rightGaugeIdx = Math.min(leftGaugeIdx + 1, sortedGauges.length - 1)
          progress = (xPos - (leftGaugeIdx * step)) / step
        }

        const gLeft = sortedGauges[leftGaugeIdx]
        const gRight = sortedGauges[rightGaugeIdx]
        
        const dLeft = data[gLeft.id]
        const dRight = data[gRight.id]

        // Map flow rate to amplitude. Typical flow might be 100-5000 cfs
        const flowLeft = dLeft?.flow || 100
        const flowRight = dRight?.flow || 100
        
        // Smooth interpolation
        const easeInOut = progress * progress * (3 - 2 * progress)
        const flowAtX = flowLeft + (flowRight - flowLeft) * easeInOut
        
        // Map height (ft) to base water level
        const htLeft = dLeft?.height || 5
        const htRight = dRight?.height || 5
        const htAtX = htLeft + (htRight - htLeft) * easeInOut

        // Calculate visual properties
        const baseY = height - 30 - (Math.min(htAtX, 30) * 2.5) 
        
        // Smooth, gentle amplitude
        const amplitude = 8 + Math.min(Math.sqrt(flowAtX) * 0.2, 20)
        
        // Slow, rolling wave frequency
        const speed = 0.01 + Math.min(flowAtX / 80000, 0.03)
        const frequency = 0.005 + Math.min(flowAtX / 200000, 0.01)

        // Simple smooth sine wave
        const y = baseY + Math.sin(i * frequency + time * speed) * amplitude

        if (i === 0) ctx.lineTo(i, y)
        else ctx.lineTo(i, y)
      }

      ctx.lineTo(width, height)
      ctx.lineTo(0, height)
      ctx.closePath()

      // Fill wave with neon Apple Glass gradient
      const waveGradient = ctx.createLinearGradient(0, 0, 0, height)
      waveGradient.addColorStop(0, 'rgba(10, 132, 255, 0.4)')
      waveGradient.addColorStop(1, 'rgba(10, 132, 255, 0.1)')
      ctx.fillStyle = waveGradient
      ctx.fill()
      
      // Wave outline
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      ctx.stroke()

      // Draw gauge markers
      sortedGauges.forEach((g, idx) => {
        const x = padding + idx * step
        const d = data[g.id]
        
        const ht = d?.height || 5
        const baseY = height - 30 - (Math.min(ht, 30) * 2)
        
        // Stagger every other label higher
        const isStaggered = idx % 2 !== 0
        const markerY = baseY - (isStaggered ? 58 : 40)
        
        // Draw pillar
        ctx.beginPath()
        ctx.moveTo(x, height)
        ctx.lineTo(x, markerY)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.setLineDash([])
        
        // Draw dot
        ctx.beginPath()
        ctx.arc(x, markerY, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#64D2FF'
        ctx.shadowColor = '#0A84FF'
        ctx.shadowBlur = 10
        ctx.fill()
        ctx.shadowBlur = 0 // reset
        
        // Text
        ctx.fillStyle = '#f8fafc'
        ctx.font = '600 12px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(g.shortName, x, markerY - 12)
      })

      time += 1
      animationId = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [data])

  return (
    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', height: 200, marginBottom: 32, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 16, left: 24, zIndex: 10 }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-main)' }}>Live River Flow Simulation</h2>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Dynamic visualization based on USGS flow rates and stages</p>
      </div>
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: '100%', display: 'block', borderRadius: 'var(--hc-radius)' }} 
      />
    </div>
  )
}
