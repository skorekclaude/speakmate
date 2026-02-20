/**
 * ALLMA — Service Worker
 *
 * Caching strategy:
 * - Install: pre-cache app shell (HTML, CSS, JS, offline page)
 * - API calls (/api/*): network-only (auth, SSE stream — never cache)
 * - Static assets (/assets/*, /icons/*): cache-first
 * - Google Fonts: stale-while-revalidate
 * - Navigation offline: show /offline.html
 */

const CACHE_NAME = 'allma-v2';

const STATIC_ASSETS = [
  '/',
  '/chat',
  '/guide',
  '/privacy',
  '/terms',
  '/assets/style.css',
  '/assets/chat.js',
  '/manifest.json',
  '/offline.html',
];

// ── Install: pre-cache shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: route requests ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // ── API calls: network-only ──
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhook/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // ── Google Fonts: stale-while-revalidate ──
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(
      caches.open('allma-fonts').then(async (cache) => {
        const cached = await cache.match(event.request);
        const networkPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => null);

        return cached || (await networkPromise) || new Response('', { status: 503 });
      })
    );
    return;
  }

  // ── Static assets + pages: cache-first with network fallback ──
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cache successful static asset responses
          if (
            response.ok &&
            (url.pathname.startsWith('/assets/') ||
              url.pathname.startsWith('/icons/'))
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Navigation requests: show offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
          return new Response('Offline', { status: 503 });
        });
    })
  );
});
