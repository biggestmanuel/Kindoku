// ── Kindoku Service Worker ──────────────────────────────────────────────
// Strategy:
//   - Navigations (HTML): network-first, falling back to the cached shell when
//     offline. Cache-first was serving a stale index.html indefinitely: the
//     cached document references hashed-by-content CSS/JS names that only
//     change on deploy, so users could be stuck on an old build for as long as
//     their cache entry lived.
//   - Static assets (CSS/JS/icons): stale-while-revalidate — instant from cache
//     while a background fetch refreshes the entry for next time.
//   - /api/* calls (AI recs, AniList enrichment): always network, never cached
//     (recommendations should always be fresh).
//
// Bump CACHE_NAME whenever the app shell changes so existing installs pick up
// the new build immediately.
//
// Raised to v4 when kindoku.js gained the degraded-catalogue message. It went
// un-bumped through several earlier edits to the app shell, which is exactly the
// drift the rule above exists to prevent — stale-while-revalidate means returning
// visitors would have loaded the previous build first and corrected on the next
// navigation. `service-worker.test.mjs` cannot catch this: it checks the precache
// list is complete, not that the version was incremented.

const CACHE_NAME = 'kindoku-cache-v4';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './kindoku.css',
  './kindoku.js',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './favicon-48x48.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './site.webmanifest',
];

// ── Install: pre-cache the app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // `reload` bypasses the HTTP cache so a deploy is never pre-cached stale.
      cache.addAll(
        PRECACHE_ASSETS.map((asset) => new Request(asset, { cache: 'reload' }))
      )
    )
  );
  self.skipWaiting();
});

// ── Activate: clean up old cache versions ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function cacheResponse(request, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, copy))
    .catch(() => {
      // A quota error must never fail the fetch that is being served.
    });
}

// ── Fetch ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls — recommendations must always be fresh. Note this
  // check precedes the GET guard so a POST to /api/ is explicitly passed
  // through rather than falling through to the browser unhandled.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Only GET requests are candidates for caching; everything else is left to
  // the browser untouched.
  if (request.method !== 'GET') return;

  // Cross-origin requests (Google Fonts) are left entirely alone: caching them
  // opaquely wastes quota and they are already served from a CDN.
  if (url.origin !== self.location.origin) return;

  // ── Navigations: network-first ──
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          cacheResponse(request, response);
          return response;
        })
        .catch(() =>
          caches
            .match('./index.html')
            .then((cached) => cached || caches.match('./'))
        )
    );
    return;
  }

  // ── Static assets: stale-while-revalidate ──
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          cacheResponse(request, response);
          return response;
        })
        .catch(() => cached);

      // `cached` is served immediately; `network` refreshes the cache entry for
      // the next visit. `network` is not returned directly so a slow network
      // never delays paint.
      return cached || network;
    })
  );
});