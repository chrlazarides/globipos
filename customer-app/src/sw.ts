/// <reference no-default-lib="true" />
/// <reference lib="es2020" />
/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

const CACHE_VERSION = "globi-static-v1";

// Auth-scoped cache: keyed by token prefix so different customers never share entries
function authCacheKey(token: string) {
  return `globi-auth-${token.slice(-16)}-v1`;
}

declare const __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;

// URLs that MUST NOT be cached (auth-sensitive account/order data)
const NO_CACHE_PATTERNS = [
  /\/api\/customer\/me/,
  /\/api\/customer\/account/,
  /\/api\/customer\/orders/,
  /\/api\/customer\/invoices/,
  /\/api\/customer\/statement/,
  /\/api\/customer\/loyalty/,
  /\/api\/customer\/push/,
];

function isAuthSensitive(url: string): boolean {
  return NO_CACHE_PATTERNS.some((p) => p.test(url));
}

// ── Install: precache static assets only ─────────────────────────────────────
self.addEventListener("install", (event) => {
  const e = event as ExtendableEvent;
  const sw = self as unknown as ServiceWorkerGlobalScope;
  const urls = __WB_MANIFEST.map((entry) =>
    typeof entry === "string" ? entry : entry.url
  ).filter((u) => !isAuthSensitive(u));
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(urls)).then(() => sw.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const e = event as ExtendableEvent;
  const sw = self as unknown as ServiceWorkerGlobalScope;
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION && !k.startsWith("globi-auth-"))
            .map((k) => caches.delete(k))
      ))
      .then(() => sw.clients.claim())
  );
});

// ── Fetch: network-first; auth-sensitive endpoints are never cached ──────────
self.addEventListener("fetch", (event) => {
  const e = event as FetchEvent;
  if (e.request.method !== "GET") return;

  const url = e.request.url;

  // Auth-sensitive API calls: always network-only, never serve from cache
  if (isAuthSensitive(url)) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Public catalog endpoint: stale-while-revalidate (safe to cache, no user data)
  if (url.includes("/api/customer/catalog") || url.includes("/api/public/")) {
    e.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(e.request).then((cached) => {
          const networkFetch = fetch(e.request).then((res) => {
            cache.put(e.request, res.clone()).catch(() => {});
            return res;
          });
          return cached ?? networkFetch;
        })
      )
    );
    return;
  }

  // Static assets: network-first, cache fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(e.request, clone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? Response.error()))
  );
});

// ── Push: show notification ───────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const e = event as PushEvent;
  if (!e.data) return;
  let payload: { title?: string; body?: string; url?: string } = {};
  try { payload = e.data.json(); } catch { payload = { title: "GlobiPOS", body: e.data.text() }; }

  const sw = self as unknown as ServiceWorkerGlobalScope;
  const title = payload.title || "GlobiPOS";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/" },
  };

  (e as ExtendableEvent).waitUntil(sw.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  const e = event as NotificationEvent;
  const sw = self as unknown as ServiceWorkerGlobalScope;
  e.notification.close();
  const url = (e.notification.data?.url as string) || "/";
  e.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return sw.clients.openWindow(url);
    })
  );
});
