/// <reference no-default-lib="true" />
/// <reference lib="es2020" />
/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

declare const self: ServiceWorkerGlobalScope;

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
self.addEventListener("install", (event: ExtendableEvent) => {
  const urls = __WB_MANIFEST.map((entry) =>
    typeof entry === "string" ? entry : entry.url
  ).filter((u) => !isAuthSensitive(u));
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(urls)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION && !k.startsWith("globi-auth-"))
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first; auth-sensitive endpoints are never cached ──────────
self.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // Auth-sensitive API calls: always network-only, never serve from cache
  if (isAuthSensitive(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Public catalog endpoint: stale-while-revalidate (safe to cache, no user data)
  if (url.includes("/api/customer/catalog") || url.includes("/api/public/")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((res) => {
            cache.put(event.request, res.clone()).catch(() => {});
            return res;
          });
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

// ── Background Sync: notify all clients to flush their offline order queue ────
// The SW itself cannot make authenticated API calls (no access to the JWT in
// localStorage), so it posts a message to the active window which handles the
// actual HTTP calls and React Query cache invalidation.
self.addEventListener("sync", (event: SyncEvent) => {
  if (event.tag === "globi-order-sync") {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: "window" }).then((clients) => {
        if (clients.length === 0) return;
        clients.forEach((client) => client.postMessage({ type: "SYNC_OFFLINE_ORDERS" }));
      })
    );
  }
});

// ── Push: show notification ───────────────────────────────────────────────────
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; url?: string } = {};
  try { payload = event.data.json(); } catch { payload = { title: "GlobiPOS", body: event.data.text() }; }

  const title = payload.title || "GlobiPOS";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data?.url as string) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
