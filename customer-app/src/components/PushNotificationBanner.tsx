import { Bell, BellOff, X } from "lucide-react";
import { useState } from "react";
import { usePushNotifications } from "../hooks/usePushNotifications";

export default function PushNotificationBanner() {
  const { state, subscribe, unsubscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || state === "unsupported" || state === "loading" || state === "granted") return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center gap-3 shadow-lg" data-testid="banner-push">
      <Bell className="w-4 h-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold">Enable notifications</p>
        <p className="text-[10px] opacity-80">Get updates on your order status</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={subscribe}
          className="px-3 py-1.5 rounded-lg bg-white text-[hsl(var(--primary))] text-xs font-semibold hover:bg-white/90 transition-opacity"
          data-testid="button-enable-push"
        >
          Enable
        </button>
        <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
