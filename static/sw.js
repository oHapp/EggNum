// Service Worker — v1.1.1
// Strategy: network-first for HTML, cache-first for static assets, never cache API
const CACHE_NAME = 'eggnum-v4';
const STATIC_ASSETS = [
  '/static/css/app.css',
  '/static/js/quantity.js',
  '/static/js/app.js',
  '/static/js/history.js',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];

// Install: pre-cache static assets only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW pre-cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches, claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: strategy depends on resource type
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API requests
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // ── Network-first for HTML pages (always get fresh version) ──
  const isHtml = event.request.mode === 'navigate'
              || url.pathname === '/'
              || url.pathname.endsWith('.html');

  if (isHtml) {
    event.respondWith(
      fetch(event.request).then((response) => {
        // Update cache with fresh version
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => {
        // Offline: serve from cache
        return caches.match(event.request);
      })
    );
    return;
  }

  // ── Cache-first for versioned static assets (CSS, JS, icons) ──
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
      return cached || fetched;
    })
  );
});
