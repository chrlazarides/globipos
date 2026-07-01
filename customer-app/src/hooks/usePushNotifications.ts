import { useState, useEffect } from "react";
import { apiFetch } from "../lib/queryClient";

export type PushState = "unsupported" | "default" | "granted" | "denied" | "loading";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isInStandaloneMode(): boolean {
  return (
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>("loading");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);

  const ios = isIos();
  const standalone = isInStandaloneMode();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission as PushState);
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((sub) => setSubscription(sub))
    );
  }, []);

  async function subscribe() {
    setState("loading");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("denied"); return; }

      const { publicKey } = await apiFetch<{ publicKey: string }>("/api/customer/push/vapid-public-key");
      if (!publicKey) throw new Error("VAPID key not configured");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await apiFetch("/api/customer/push/subscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.toJSON().keys?.p256dh, auth: sub.toJSON().keys?.auth } }),
      });
      setSubscription(sub);
      setState("granted");
    } catch (err: any) {
      console.error("Push subscribe failed:", err);
      setState(Notification.permission as PushState);
    }
  }

  async function unsubscribe() {
    if (!subscription) return;
    try {
      await apiFetch("/api/customer/push/subscribe", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
      setState("default");
    } catch (err) {
      console.error("Push unsubscribe failed:", err);
    }
  }

  return { state, subscription, subscribe, unsubscribe, ios, standalone };
}
