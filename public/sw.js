/*
 * ValencyStudio File Manager — service worker
 * - app shell & assets: network-first with cache fallback (offline shell)
 * - /api/*: NEVER intercepted (always network)
 * Note: network-first everywhere keeps the app fresh even on servers whose
 * static chunk URLs are not content-hashed (dev mode).
 */
const VERSION = 'vs-shell-v3'
const APP_SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/icon.svg', '/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

async function networkFirst(req, cacheFallbacks = [req]) {
  const cache = await caches.open(VERSION)
  try {
    const res = await fetch(req)
    if (res && res.ok && (req.method === 'GET')) {
      cache.put(req, res.clone()).catch(() => undefined)
    }
    return res
  } catch (err) {
    for (const key of cacheFallbacks) {
      const hit = await cache.match(key)
      if (hit) return hit
    }
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // never intercept API traffic
  if (url.searchParams.has('XTransformPort')) return // never intercept gateway-proxied services (socket.io polling)
  if (url.pathname.startsWith('/_next/webpack-hmr')) return

  // navigations — network-first, fall back to cached shell, then offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      networkFirst(req, ['/']).catch(async () => {
        const offline = await caches.match('/offline.html')
        if (offline) return offline
        return new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      })
    )
    return
  }

  // static assets (js/css/icons) — network-first with cache fallback for offline
  event.respondWith(
    networkFirst(req).catch(
      () =>
        new Response('', {
          status: 504,
          headers: { 'Content-Type': 'text/plain' },
        })
    )
  )
})
