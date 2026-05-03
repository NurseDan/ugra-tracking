import React, { createContext, useContext, useMemo } from 'react'
import { GAUGES } from '../config/gauges'
import { useNwsAlerts } from '../hooks/useNwsAlerts'
import { useReservoirStatus } from '../lib/useReservoirStatus'
import { useAlertNotifier } from '../hooks/useAlertNotifier'
import { useBasinBriefing } from '../hooks/useGaugeBriefing'
import { buildGaugeContext } from '../lib/aiBriefing'

const SentinelContext = createContext(null)

function alertTouchesGauge(alert, gauge) {
  if (!alert || !gauge) return false
  if (Array.isArray(alert.gaugeIds) && alert.gaugeIds.includes(gauge.id)) return true
  const text = `${alert.areaDesc || ''} ${alert.headline || ''} ${alert.description || ''}`.toLowerCase()
  const candidates = [gauge.shortName, gauge.name, gauge.county]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase())
  return candidates.some((c) => c && text.includes(c))
}

export function SentinelProvider({ gaugesData, surgeEvents = [], children }) {
  const nws = useNwsAlerts(null, GAUGES)
  const reservoir = useReservoirStatus()

  // Build lightweight per-gauge contexts for the basin briefing. We omit
  // ahps/streamflow forecasts here (those are loaded only when a gauge
  // detail page is opened) — the basin briefing tolerates missing fields.
  const basinContexts = useMemo(() => {
    if (!gaugesData) return []
    return GAUGES.map((g) => {
      const reading = gaugesData[g.id]
      if (!reading) return null
      const gaugeAlerts = (nws.alerts || []).filter((a) => alertTouchesGauge(a, g))
      return buildGaugeContext({
        gauge: g,
        reading,
        alerts: gaugeAlerts,
        rainfall: reading.forecast
          ? {
              next24hInches: reading.forecast.totalInches,
              maxHourlyInches: reading.forecast.maxHourlyInches,
              maxProbability: reading.forecast.maxProbability
            }
          : null
      })
    }).filter(Boolean)
  }, [gaugesData, nws.alerts])

  const basin = useBasinBriefing(basinContexts, {})

  // Mount the notifier once at the app root so it fires regardless of
  // which page is currently visible.
  useAlertNotifier(gaugesData, nws.alerts, { gauges: GAUGES })

  const value = useMemo(
    () => ({
      gaugesData: gaugesData || {},
      surgeEvents,
      gauges: GAUGES,
      nwsAlerts: nws.alerts || [],
      nwsLoading: nws.loading,
      nwsError: nws.error,
      refreshNws: nws.refresh,
      reservoirStatus: reservoir.status,
      reservoirLoading: reservoir.loading,
      reservoirError: reservoir.error,
      reservoirLastUpdated: reservoir.lastUpdated,
      refreshReservoir: reservoir.refresh,
      basinBriefing: basin,
      alertsForGauge: (gaugeId) => {
        const g = GAUGES.find((x) => x.id === gaugeId)
        if (!g) return []
        return (nws.alerts || []).filter((a) => alertTouchesGauge(a, g))
      }
    }),
    [gaugesData, surgeEvents, nws.alerts, nws.loading, nws.error, nws.refresh, reservoir, basin]
  )

  return <SentinelContext.Provider value={value}>{children}</SentinelContext.Provider>
}

export function useSentinel() {
  const ctx = useContext(SentinelContext)
  if (!ctx) throw new Error('useSentinel must be used inside <SentinelProvider>')
  return ctx
}
