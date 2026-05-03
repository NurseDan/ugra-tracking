# Guadalupe Sentinel

Real-time river monitoring and flood-warning system for the Guadalupe River basin in Texas.
Pulls live USGS gauge readings, NWS alerts, AHPS / NOAA NWM forecasts, Canyon Lake reservoir
status, and animated radar / MRMS rainfall overlays. Renders an LLM-backed plain-English risk
briefing for the basin and per-gauge, and a 72-hour AI-assisted rise forecast per gauge.

## Tech Stack

- **Frontend**: React 18, Vite 6, React Router 7
- **Backend**: Express (API proxy server on port 3001)
- **Mapping**: Leaflet / React-Leaflet with Nexrad radar overlay
- **Icons**: Lucide-React
- **Data Sources**:
  - USGS Waterservices (instantaneous values + daily values, 14-day history)
  - Open-Meteo (precipitation forecast, QPF 72h)
  - NWS / AHPS (flood alerts, official stage forecasts)
  - National Water Model (streamflow forecasts)
  - OpenAI (AI briefings and rise forecast narratives, via server-side proxy)

## Architecture

```
server.js                           Express API proxy (port 3001).
                                    Reads OPENAI_API_KEY from server env
                                    and forwards /api/chat requests to
                                    OpenAI. The key never reaches the browser.

src/
  App.jsx                       Top-level data poller (USGS + weather), router,
                                wraps everything in <SentinelProvider>. Also
                                merges gauge history into IndexedDB and runs
                                background forecast generation.
  contexts/
    SentinelContext.jsx         Lifts NWS alerts, reservoir status, basin
                                briefing into context. Mounts useAlertNotifier
                                once at app root for cross-page notifications.

  pages/
    Dashboard.jsx               Alerts banner -> basin briefing -> reservoir
                                card -> per-gauge cards (with Peak24hBadge) -> river map.
    GaugeDetail.jsx             AI briefing card, AHPS chart, NWM chart, 72h rise
                                forecast panel, 14-day history chart, NWS alerts,
                                per-gauge notify toggle, flood stage monitor.
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
    HistoryChart.jsx            14-day SVG history chart with multi-tier flood
                                threshold lines (Action/Minor/Moderate/Major).
    RiseForecastPanel.jsx       72h rise forecast panel: deterministic + LLM,
                                confidence band, AHPS/NWM fusion, narrative.
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
    useGaugeHistory.js          14-day history fetch + IndexedDB cache hook.

  lib/
    usgs.js                     Live readings + precipitation forecasts + 14-day IV/DV fetch.
    weatherApi.js               Open-Meteo precipitation + QPF 72h (with past 24h rainfall).
    alertEngine.js, surgeEngine.js, alertColors.js
    nwsAlerts.js                api.weather.gov client + alert normalizer.
    ahps.js, nwm.js, openMeteoFlood.js, canyonLake.js
    aiBriefing.js               Briefing generator. Uses createProxyProvider() by default,
                                which POSTs to /api/chat (server-side proxy) so the
                                OpenAI key is never exposed in the browser bundle.
    riseForecast.js             72h rise forecast engine (deterministic + LLM, AHPS/NWM fusion).
    gaugeHistory.js             IndexedDB/localStorage 14-day history persistence + forecast TTL cache.
    radarLayers.js              RainViewer + MRMS tile/WMS helpers.
    notifications.js            Permission + subscription store + service worker.
    incidentLog.js              localStorage incident log + subscribe API.
    formatTime.js               CDT formatting helper.

  config/
    gauges.js, ahpsLids.js, nwmReaches.js
```

## Data flow

1. `App.jsx` polls USGS + Open-Meteo every `REFRESH_MS`, computes alert level,
   surge events, sentinel score, and stamps any escalation into the incident log.
   After each refresh it merges 6h history into IndexedDB and fires
   `backgroundGenerateForecasts` (non-blocking, per-gauge serial with TTL dedup).
2. `<SentinelProvider>` mounts the polling hooks for NWS alerts, Canyon Lake
   reservoir, the basin AI briefing, and the alert notifier — exposing them
   through `useSentinel()` so pages don't prop-drill.
3. `Dashboard` consumes context + `forecasts` prop (cached rise forecasts) to
   render `Peak24hBadge` on each gauge card.
4. `GaugeDetail` consumes context; loads 14-day history via `useGaugeHistory`,
   feeds AHPS peak + NWM peak (from their respective hooks) into `RiseForecastPanel`
   for official-forecast fusion in the rise forecast engine.

## Key Features

- **Live USGS data**: 6-hour instantaneous values refreshed every 5 minutes
- **14-day history**: IndexedDB-persisted rolling window, fetched on gauge detail view
- **Rise rate alerts**: 5-min, 15-min, 60-min rise rates mapped to GREEN/YELLOW/ORANGE/RED/BLACK
- **Surge detection**: Upstream surge events propagated to downstream gauge cards
- **72h Rise Forecast**: Deterministic trend + QPF model with AHPS/NWM fusion + optional LLM narrative
- **Forecast caching**: 15-minute TTL per gauge in localStorage, refreshed on visibility change
- **Dashboard peak badges**: Next 24h peak stage from cached forecast shown on each gauge card
- **Multi-tier flood thresholds**: Action/Minor/Moderate/Major lines on history chart (from AHPS or derived)
- **AI briefings**: Per-gauge and basin-wide risk narratives via OpenAI (server-side proxy, requires OPENAI_API_KEY in Secrets)
- **Official forecasts**: AHPS stage and NWM streamflow overlays on gauge detail
- **NWS alerts**: Real-time NWS alerts matched to gauges, dismissable banner on dashboard
- **Notifications**: Per-gauge browser push notifications on alert escalation
- **Incidents log**: localStorage-backed alert escalation history with CSV export
- **Reservoir status**: Canyon Lake elevation / inflow / release card
- **Animated radar**: RainViewer animated radar tiles + MRMS QPE overlay

## Required secrets / env vars

| Variable | Purpose | Required? |
| --- | --- | --- |
| `OPENAI_API_KEY` | Powers the basin + per-gauge AI briefings and LLM-assisted rise forecast narratives via the server-side proxy (`server.js`). The key is read only by the Express server and never sent to the browser. If missing, briefings and LLM forecasts degrade gracefully. | Optional |

> **Security:** `OPENAI_API_KEY` is a plain (non-`VITE_`-prefixed) env var, so
> Vite never inlines it into the public JS bundle. All OpenAI calls go through
> the `/api/chat` Express proxy endpoint in `server.js`, which holds the key
> server-side only. The browser bundle contains no credentials.

No other API keys are required — USGS, NWS, NOAA NWM, RainViewer, MRMS
(Iowa Mesonet WMS), Open-Meteo, and AHPS are all public anonymous APIs.

## Notifications

`src/lib/notifications.js` registers `/sw.js` (service worker shipped under
`public/sw.js`) on first load and stores subscription preferences in
localStorage. Notifications fire only when the user has subscribed to a
specific gauge or globally to NWS alerts in the header notifications panel.

## Build / run

- `npm run dev` — starts Express API proxy (port 3001) + Vite dev server (port 5000).
- `npm run build` — production build to `dist/`.
- `npm run server` — run the Express proxy server only (for production alongside a static host).

## PWA / iOS install

The app is a Progressive Web App and is installable on both desktop browsers
and iOS / Android, sharing the same React/Vite codebase.

- `index.html` ships the PWA `<link rel="manifest">`, `theme-color`,
  `apple-touch-icon`, and `apple-mobile-web-app-*` meta tags so Safari treats
  "Add to Home Screen" as a real installable app (full-screen, dark status
  bar, custom icon).
- `public/manifest.webmanifest` declares the app identity, icons (SVG +
  192/512 PNG, plus 192/512 maskable PNG for Android adaptive icons),
  brand colors, `display: standalone`, and an `/incidents` shortcut.
- Icons live under `public/icons/` and are rendered from `public/icon.svg`
  and `public/icon-maskable.svg` via ImageMagick (`convert`) at build/setup
  time.
- `public/sw.js` was upgraded from a notification-only worker to a real
  PWA service worker:
  - Pre-caches the app shell (`/`, manifest, icons) on install.
  - Stale-while-revalidate for same-origin static assets.
  - Network-first with cache fallback for the public APIs the app calls
    (USGS, weather.gov, AHPS, NWM, Open-Meteo, RainViewer, MRMS, Esri
    basemap tiles, Canyon Lake), capped to ~240 entries to respect iOS
    storage limits.
  - Navigation requests fall back to the cached `/` so the app launches
    offline from the home-screen icon.

### Install instructions for end users

- **iOS Safari** — open the site, tap the Share button, choose
  "Add to Home Screen". Launch from the home-screen icon for a
  full-screen experience with notifications.
- **Android Chrome** — tap the menu, then "Install app" / "Add to
  Home Screen".
- **Desktop Chrome / Edge** — click the install icon in the URL bar.

### Native iOS app (future)

To later ship to the App Store without rewriting the app, wrap the same
build with [Capacitor](https://capacitorjs.com/) (`npx cap add ios`,
point it at `dist/`). This requires an Apple Developer account. The
PWA is the production target today; the Capacitor wrapper is a deferred
follow-up.

## Background

The original tasks (#1–#8) shipped each new data source as a self-contained
module. Task #9 wires those modules into the app shell: `SentinelContext`,
the `/incidents` route, the new header with nav and the notifications panel,
the per-gauge AI briefing + AHPS + NWM panels in `GaugeDetail`, the per-gauge
NWS alert pill on `Dashboard`, and replacing the static NEXRAD overlay with
the animated radar + MRMS controls on the map. Task #10 adds 14-day history
persistence, the 72h rise forecast engine, dashboard peak badges, and
multi-tier flood threshold lines. Task #15 moves the OpenAI API key
server-side: all LLM calls now go through the Express proxy in `server.js`,
eliminating the `VITE_OPENAI_API_KEY` credential exposure in the public bundle.
