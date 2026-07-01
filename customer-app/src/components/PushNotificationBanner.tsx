import { Bell, X, Share, ArrowDown } from "lucide-react";
import { useState } from "react";
import { usePushNotifications } from "../hooks/usePushNotifications";

export default function PushNotificationBanner() {
  const { state, subscribe, ios, standalone } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (ios && !standalone) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-50 bg-[hsl(var(--primary))] text-white px-4 py-3 shadow-lg"
        data-testid="banner-ios-install"
      >
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 opacity-70 hover:opacity-100"
          data-testid="button-dismiss-ios-banner"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <Bell className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-snug">Add to Home Screen to enable notifications</p>
            <p className="text-[10px] opacity-80 mt-0.5 leading-snug">
              Tap the <Share className="w-3 h-3 inline-block mx-0.5 -mt-0.5" /> Share button in Safari, then
              <span className="font-semibold"> &ldquo;Add to Home Screen&rdquo;</span>
              <ArrowDown className="w-3 h-3 inline-block mx-0.5 -mt-0.5" />
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (state === "unsupported") return null;
  if (state === "granted") return null;
  if (state === "denied") return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-[hsl(var(--primary))] text-white px-4 py-3 flex items-center gap-3 shadow-lg"
      data-testid="banner-push"
    >
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
        <button
          onClick={() => setDismissed(true)}
          className="opacity-70 hover:opacity-100"
          data-testid="button-dismiss-push"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
