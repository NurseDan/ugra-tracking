# Threat Model

## Project Overview

Guadalupe Sentinel is a client-side React 18 / Vite Progressive Web App for monitoring Guadalupe River basin conditions and flood risk. It polls public hydrology and weather APIs directly from the browser, renders dashboards, maps, gauge detail pages, local incident history, browser notifications, offline caches, and optional OpenAI-backed plain-English briefings. There is no production backend or database in the current architecture; the deployed app is static assets plus a service worker.

Production users are members of the public or operators viewing river conditions in a browser or installed PWA. The client and all data fetched from third-party APIs must be treated as untrusted for code execution and display safety, but most hydrologic source data is public.

## Assets

- **OpenAI API key** -- `VITE_OPENAI_API_KEY`, if configured, is a billable credential used for AI briefings and forecasts. Compromise enables unauthorized API use and cost abuse.
- **Application integrity and flood-risk presentation** -- dashboard alerts, gauge detail pages, maps, forecasts, notifications, and offline cache content influence user understanding of potentially dangerous conditions. XSS or cache poisoning could mislead users or execute attacker code.
- **Local user preferences and incident history** -- notification subscriptions, incident logs, map-layer preferences, forecast caches, and gauge history live in `localStorage` and IndexedDB. They are local-only and not authoritative, but should not become script execution vectors.
- **Service worker scope and caches** -- `public/sw.js` controls same-origin navigation fallback, static asset caching, cross-origin public data caching, and notification-click routing. A bug here can persist stale or malicious client behavior longer than ordinary page code.
- **Third-party API data** -- USGS, NWS/weather.gov, AHPS/NOAA, NWM, Open-Meteo, RainViewer, MRMS/Iowa Mesonet, Esri tiles, TWDB, and CORS proxy responses are remote inputs rendered in the app and occasionally sent to OpenAI.

## Trust Boundaries

- **Browser to static app assets** -- users download bundled JavaScript, HTML, icons, and `sw.js` from the deployment origin. No user authentication boundary exists.
- **Browser to third-party APIs** -- the client fetches public hydrologic, weather, map, and radar data directly. Responses are untrusted and must be parsed defensively and rendered through React-safe escaping or trusted map APIs.
- **Browser to OpenAI** -- when an API key is present, client code directly calls `https://api.openai.com/v1/chat/completions` with a bearer token and public hydrology context. This crosses a billing/secret boundary and must not expose secret keys in production.
- **Page to service worker** -- app pages register `/sw.js`; the service worker can intercept same-origin GETs, cache cross-origin data from an allowlisted set of public hosts, and open/navigate windows on notification clicks.
- **Runtime to browser storage** -- localStorage and IndexedDB persist incidents, preferences, history, and forecasts across sessions. Storage is fully controlled by the local browser environment and must not be trusted as server-side state.
- **Production vs development** -- Vite dev server, tests, attached assets, mock helpers, and `import.meta.env.DEV`-gated sample generation are development-only and out of scope unless reachable in a production build. Assume `NODE_ENV=production` for production deployments. Mockup sandbox behavior is out of scope.

## Scan Anchors

- **Production entry points**: `index.html`, `src/main.jsx`, `src/App.jsx`, route components in `src/pages/`, and `public/sw.js`.
- **Highest-risk code areas**: `src/lib/aiBriefing.js` and `src/lib/riseForecast.js` (OpenAI key/use and AI output), `public/sw.js` plus `src/lib/notifications.js` (service worker and notification navigation), data fetch/parsing modules under `src/lib/`, and Leaflet HTML marker creation in `src/components/RiverMap.jsx`.
- **Public surfaces**: all routes (`/`, `/gauge/:id`, `/incidents`) are public and unauthenticated. There are no authenticated or admin routes in the current architecture.
- **Storage surfaces**: `src/lib/gaugeHistory.js`, `src/lib/incidentLog.js`, `src/lib/notifications.js`, and `src/components/MapLayerControls.jsx` use localStorage/IndexedDB only.
- **Dev-only areas**: `src/lib/nwsAlerts.test.mjs`, `attached_assets/`, tests/mocks, documentation, Vite dev server behavior, and `import.meta.env.DEV` gated sample incident generation.

## Threat Categories

### Spoofing

The app has no user accounts, server sessions, or admin functions. Spoofing concerns mainly involve third-party data sources and the optional OpenAI API credential. The app must not present third-party or AI-generated content as authoritative evacuation instructions, and any future backend proxy must authenticate its own secrets and callers appropriately.

### Tampering

All external API responses and browser storage are untrusted. Hydrologic observations, NWS text, forecast values, cached history, and local incident entries must be parsed and rendered without allowing script execution. Forecast and alert calculations must be performed from parsed numeric values rather than executable or HTML content.

### Information Disclosure

The main confidentiality risk is exposing billable credentials in client-side bundles. No `VITE_` environment variable should contain a secret intended to remain private. Public hydrology data can be shown to users, but API keys and internal configuration secrets must not be logged or bundled.

### Denial of Service

The application performs repeated browser-side polling and optional background forecast generation. Public unauthenticated routes must avoid unbounded loops, unbounded storage growth, and excessive third-party API calls. Existing local caches should remain capped, and future server proxies for OpenAI or data aggregation would need rate limiting.

### Elevation of Privilege

There is no local privilege model, but XSS in the public app would let an attacker control the origin, service worker registration context, local caches, local storage, and any exposed client-side OpenAI key. Any use of raw HTML, notification URLs, or service worker navigation must validate or constrain attacker-controlled inputs.
