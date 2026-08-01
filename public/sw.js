// ── Kindoku Service Worker ──────────────────────────────────────────────
// PORTED AS-IS FROM THE VANILLA VERSION — NEEDS ATTENTION.
//
// This precache list hardcodes filenames like '/kindoku.css' and
// '/kindoku.js'. Vite's production build outputs hashed filenames
// instead (e.g. '/assets/index-a1b2c3.js'), so this list will silently
// fail to cache the real build output once you run `npm run build`.
//
// Two ways to fix this properly (pick one later, not needed for dev):
//   1. Swap this hand-rolled worker for `vite-plugin-pwa`, which
//      generates the precache manifest automatically from your real
//      build output.
//   2. Keep this file, but drop the PRECACHE_ASSETS static list and
//      rely on the runtime cache-as-you-go logic in the fetch handler
//      below (it already caches successful same-origin GETs on the
//      fly) — you'd lose the "available offline on first load" benefit
//      but the rest keeps working.
//
// Leaving as-is for now since it doesn't block local dev with Vite.

const CACHE_NAME = 'kindoku-cache-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/site.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API calls — recommendations must always be fresh
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});
