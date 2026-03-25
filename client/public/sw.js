const CACHE_NAME = 'vintrade-v13';
const API_CACHE_NAME = 'vintrade-api-v13';

// Only cache versioned static assets (JS/CSS bundles with content hashes).
// NEVER cache HTML — it must always be fetched fresh so new deployments work.
const ASSET_PATTERN = /\/assets\/.+\.(js|css|woff2?|ttf|png|svg|ico)(\?.*)?$/;

const CACHEABLE_API_ROUTES = [
  '/api/items',
  '/api/customers',
  '/api/categories',
  '/api/settings',
  '/api/price-contracts',
  '/api/suppliers',
  '/api/purchase-invoices',
  '/api/seasonal-offers',
  '/api/items/brands'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') {
    return;
  }

  // Cacheable API routes: network-first, fall back to cache
  const isCacheableApi = CACHEABLE_API_ROUTES.some((route) =>
    url.pathname === route || url.pathname.startsWith(route + '/')
  );
  if (isCacheableApi) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(API_CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // All other API routes: always network, never cache
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Versioned static assets (JS/CSS bundles): cache-first (they have content hashes)
  if (ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages (index.html and all routes): ALWAYS network, never serve from cache.
  // This ensures new deployments reach users immediately.
  event.respondWith(
    fetch(event.request).catch(() => caches.match('/'))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
