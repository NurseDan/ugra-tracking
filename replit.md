# Guadalupe Sentinel

React + Vite flood monitoring dashboard for the Guadalupe River basin in Texas.
Pulls live USGS gauge readings, NWS alerts, AHPS / NOAA NWM forecasts, Canyon
Lake reservoir status, and animated radar / MRMS rainfall overlays. Renders an
LLM-backed plain-English risk briefing for the basin and per-gauge.

## Architecture

```
src/
  App.jsx                       Top-level data poller (USGS + weather), router,
                                wraps everything in <SentinelProvider>.
  contexts/
    SentinelContext.jsx         Lifts NWS alerts, reservoir status, basin
                                briefing into context. Mounts useAlertNotifier
                                once at app root for cross-page notifications.

  pages/
    Dashboard.jsx               Alerts banner -> basin briefing -> reservoir
                                card -> per-gauge cards -> river map.
    GaugeDetail.jsx             AI briefing card, AHPS chart, NWM chart, NWS
                                alerts touching this gauge, per-gauge notify
                                toggle, flood stage monitor.
    Incidents.jsx               localStorage-backed incident history with
                                filters, stats, CSV export.

  components/
    AppHeader.jsx               Brand + nav (Dashboard / Incidents) + a modal
                                trigger for NotificationSettings.
    NwsAlertsBanner.jsx         Stack of dismissable NWS alert cards.
    BasinBriefingHeader.jsx     Compact header banner for basin AI briefing.
    GaugeBriefingCard.jsx       Per-gauge AI briefing card.
    ReservoirCard.jsx           Canyon Lake elevation / inflow / release.
    AhpsForecastChart.jsx       Observed vs official AHPS forecast SVG chart.
    AhpsForecastSummary.jsx     Inline AHPS crest summary chip (dashboard).
    StreamflowForecastChart.jsx NWM (with Open-Meteo fallback) flow chart.
    AnimatedRadarLayer.jsx      RainViewer animated radar tiles for the map.
    MrmsQpeLayer.jsx            MRMS QPE WMS overlay + legend.
    MapLayerControls.jsx        Layer toggle panel (radar / MRMS window).
    NotificationSettings.jsx    Permission + per-gauge subscription UI.
    RiverMap.jsx                Leaflet map with markers, radar, MRMS, controls.
    Sparkline.jsx               Tiny inline level history chart.

  hooks/
    useNwsAlerts.js             Polls api.weather.gov with backoff + visibility.
    useAhpsForecast.js          Cached AHPS observed+forecast loader.
    useStreamflowForecast.js    NWM with Open-Meteo fallback.
    useGaugeBriefing.js         useGaugeBriefing + useBasinBriefing (LLM).
    useAlertNotifier.js         Fires browser notifications on escalation.

  lib/
    usgs.js, weatherApi.js      Live readings + precipitation forecasts.
    alertEngine.js, surgeEngine.js, alertColors.js
    nwsAlerts.js                api.weather.gov client + alert normalizer.
    ahps.js, nwm.js, openMeteoFlood.js, canyonLake.js
    aiBriefing.js               OpenAI-backed briefing generator (browser).
    radarLayers.js              RainViewer + MRMS tile/WMS helpers.
    notifications.js            Permission + subscription store + service worker.
    incidentLog.js              localStorage incident log + subscribe API.
    formatTime.js               CDT formatting helper.

  config/
    gauges.js, ahpsLids.js, nwmReaches.js
```

## Data flow

1. `App.jsx` polls USGS + Open-Meteo every `REFRESH_MS`, computes alert level,
   surge events, sentinel score, and stamps any escalation into the
   incident log.
2. `<SentinelProvider>` mounts the polling hooks for NWS alerts, Canyon Lake
   reservoir, the basin AI briefing, and the alert notifier — exposing them
   through `useSentinel()` so pages don't prop-drill.
3. `Dashboard` and `GaugeDetail` consume the context; per-gauge alert
   matching (NWS area description vs gauge name/county) is centralized in
   `alertsForGauge()` on the context.

## Required secrets / env vars

| Variable | Purpose | Required? |
| --- | --- | --- |
| `VITE_OPENAI_API_KEY` | Powers the basin + per-gauge AI briefings via the OpenAI Chat Completions API. If missing, briefings render an "AI briefing unavailable" state instead of failing. | Optional |

> **Security note:** any `VITE_`-prefixed env var is inlined into the public
> JS bundle. The current `aiBriefing.js` calls OpenAI directly from the
> browser to match the rest of the app's all-client-side data fetching. For
> a production deployment, replace `createOpenAiProvider` (via
> `setDefaultProvider`) with a thin server proxy so the key stays private.

No other API keys are required — USGS, NWS, NOAA NWM, RainViewer, MRMS
(Iowa Mesonet WMS), Open-Meteo, and AHPS are all public anonymous APIs.

## Notifications

`src/lib/notifications.js` registers `/sw.js` (service worker shipped under
`public/sw.js`) on first load and stores subscription preferences in
localStorage. Notifications fire only when the user has subscribed to a
specific gauge or globally to NWS alerts in the header notifications panel.

## Build / run

- `npm run dev` — Vite dev server.
- `npm run build` — production build to `dist/`.

## Background

The original tasks (#1–#8) shipped each new data source as a self-contained
module. Task #9 (this one) wires those modules into the app shell:
`SentinelContext`, the `/incidents` route, the new header with nav and the
notifications panel, the per-gauge AI briefing + AHPS + NWM panels in
`GaugeDetail`, the per-gauge NWS alert pill on `Dashboard`, and replacing
the static NEXRAD overlay with the animated radar + MRMS controls on the map.
