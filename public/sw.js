/* Guadalupe Sentinel service worker.
 *
 * Two responsibilities:
 *
 * 1. Notification routing — keep a registration alive so
 *    registration.showNotification() and notificationclick can run when the
 *    page is in the background (or installed as a PWA on iOS / Android).
 *
 * 2. PWA app-shell + runtime caching — make the dashboard launchable from
 *    an installed icon even when the device is offline (it will show the
 *    last good shell + the most recently cached USGS / NWS / tile data),
 *    while always preferring fresh data when the network is available.
 *
 * Caches:
 *   - SHELL_CACHE: app HTML/JS/CSS/manifest/icons, populated on install
 *     with the bare entry points and grown lazily by runtime SWR for any
 *     same-origin GET.
 *   - DATA_CACHE: cross-origin GETs that the app makes to public APIs
 *     (USGS, weather.gov, RainViewer index, AHPS, NWM, MRMS, Open-Meteo,
 *     Iowa Mesonet, Canyon Lake). Capped to keep storage small on iOS.
 */

const VERSION = 'v2'
const SHELL_CACHE = `gs-shell-${VERSION}`
const DATA_CACHE = `gs-data-${VERSION}`

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon-180.png',
  '/icons/favicon-32.png'
]

const RUNTIME_HOSTS = new Set([
  'waterservices.usgs.gov',
  'api.weather.gov',
  'api.water.noaa.gov',
  'water.weather.gov',
  'nwmdata.nationalwaterprediction.noaa.gov',
  'api.open-meteo.com',
  'flood-api.open-meteo.com',
  'api.rainviewer.com',
  'mesonet.agron.iastate.edu',
  'server.arcgisonline.com'
])

const RUNTIME_HOST_SUFFIXES = ['.rainviewer.com', '.tile.openstreetmap.org']

function isRuntimeHost(hostname) {
  if (RUNTIME_HOSTS.has(hostname)) return true
  return RUNTIME_HOST_SUFFIXES.some((s) => hostname.endsWith(s))
}

const DATA_CACHE_MAX_ENTRIES = 240

async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    if (keys.length <= max) return
    const overflow = keys.length - max
    for (let i = 0; i < overflow; i++) await cache.delete(keys[i])
  } catch {
    /* ignore */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(PRECACHE_URLS).catch(() => {})
      self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => n.startsWith('gs-') && n !== SHELL_CACHE && n !== DATA_CACHE)
          .map((n) => caches.delete(n))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  const isSameOrigin = url.origin === self.location.origin

  // SPA navigations: network-first, fall back to cached '/' for offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          const cache = await caches.open(SHELL_CACHE)
          cache.put('/', fresh.clone()).catch(() => {})
          return fresh
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (await cache.match('/')) || (await cache.match(req)) || Response.error()
        }
      })()
    )
    return
  }

  if (isSameOrigin) {
    // Stale-while-revalidate for same-origin static assets (JS/CSS/icons).
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE))
    return
  }

  if (isRuntimeHost(url.hostname)) {
    // Network-first for live data, cache as a fallback.
    event.respondWith(networkFirst(req, DATA_CACHE))
  }
})

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req)
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {})
      return res
    })
    .catch(() => null)
  return cached || (await fetchPromise) || Response.error()
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const fresh = await fetch(req)
    if (fresh && (fresh.status === 200 || fresh.type === 'opaque')) {
      cache.put(req, fresh.clone()).catch(() => {})
      trimCache(cacheName, DATA_CACHE_MAX_ENTRIES)
    }
    return fresh
  } catch {
    const cached = await cache.match(req)
    if (cached) return cached
    throw new Error('offline and no cached response')
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const absolute = new URL(targetUrl, self.location.origin).href

      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === self.location.origin) {
            await client.focus()
            if ('navigate' in client) {
              try { await client.navigate(absolute) } catch {}
            }
            return
          }
        } catch {}
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(absolute)
      }
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PING') {
    event.ports?.[0]?.postMessage({ type: 'PONG' })
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
