/* Guadalupe Sentinel — minimal service worker for notification routing.
 * Intentionally NO offline caching; this SW only exists so that
 * registration.showNotification() can fire when the page isn't focused
 * and so notificationclick can focus/open the right gauge URL.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

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
})
