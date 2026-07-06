/// <reference no-default-lib="true" />
/// <reference lib="es2020" />
/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "globi-pda-static-v1";

declare const __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;

// URLs that MUST NOT be cached (auth-sensitive staff data / mutating endpoints)
const NO_CACHE_PATTERNS = [
  /\/api\/auth\//,
  /\/api\/users/,
  /\/api\/pda\/stock-take/,
  /\/api\/pda\/transfers/,
  /\/api\/pda\/agoranomia/,
  /\/api\/invoices/,
];

function isAuthSensitive(url: string): boolean {
  return NO_CACHE_PATTERNS.some((p) => p.test(url));
}

self.addEventListener("install", (event: ExtendableEvent) => {
  const urls = __WB_MANIFEST.map((entry) =>
    typeof entry === "string" ? entry : entry.url
  ).filter((u) => !isAuthSensitive(u));
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(urls)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  if (isAuthSensitive(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Item catalog: safe to cache for offline barcode look-up
  if (url.includes("/api/items")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((res) => {
            cache.put(event.request, res.clone()).catch(() => {});
            return res;
          }).catch(() => cached ?? Response.error());
          return cached ?? networkFetch;
        })
      )
    );
    return;
  }

  // Static assets: network-first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r ?? Response.error()))
  );
});
