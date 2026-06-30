/// <reference no-default-lib="true" />
/// <reference lib="es2020" />
/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

const CACHE_VERSION = "globi-v1";

declare const __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;

// ── Install: precache all assets injected by vite-plugin-pwa ────────────────
self.addEventListener("install", (event) => {
  const e = event as ExtendableEvent;
  const urls = __WB_MANIFEST.map((entry) =>
    typeof entry === "string" ? entry : entry.url
  );
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(urls)).then(() => (self as unknown as ServiceWorkerGlobalScope).skipWaiting())
  );
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const e = event as ExtendableEvent;
  const sw = self as unknown as ServiceWorkerGlobalScope;
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => sw.clients.claim())
  );
});

// ── Fetch: network-first, fall back to cache ────────────────────────────────
self.addEventListener("fetch", (event) => {
  const e = event as FetchEvent;
  if (e.request.method !== "GET") return;
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

// ── Push: show notification ─────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const e = event as PushEvent;
  if (!e.data) return;
  let payload: { title?: string; body?: string; url?: string } = {};
  try { payload = e.data.json(); } catch { payload = { title: "GlobiPOS", body: e.data.text() }; }

  const sw = self as unknown as ServiceWorkerGlobalScope;
  const title = payload.title || "GlobiPOS";
  const options: NotificationOptions = {
    body: payload.body || "",
    icon: "/icons/icon.svg",
    badge: "/icons/icon.svg",
    data: { url: payload.url || "/" },
  };

  (e as ExtendableEvent).waitUntil(sw.registration.showNotification(title, options));
});

// ── Notification click: focus or open window ────────────────────────────────
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
