const CACHE_NAME = 'globipos-terminal-shell-v3';
const STATIC_ASSETS = [
  '/terminal/manifest.json',
  '/terminal/icons/globipos-terminal-192.png',
  '/terminal/icons/globipos-terminal-512.png',
];

async function precacheCurrentBuild() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('/terminal/index.html');
  if (!response.ok) throw new Error(`Unable to precache Terminal shell: ${response.status}`);
  const html = await response.clone().text();
  await cache.put('/terminal/index.html', response.clone());
  await cache.put('/terminal/', response);
  const buildAssets = [...html.matchAll(/(?:src|href)="(\/terminal\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);
  await cache.addAll([...STATIC_ASSETS, ...new Set(buildAssets)]);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await precacheCurrentBuild();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith('globipos-terminal-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () =>
        (await caches.match('/terminal/index.html')) ||
        (await caches.match('/terminal/'))
      )
    );
    return;
  }

  if (url.origin !== self.location.origin || !url.pathname.startsWith('/terminal/')) return;

  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      const response = await fetch(event.request);
      if (response.status === 200 && url.pathname.startsWith('/terminal/assets/')) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    })
  );
});
