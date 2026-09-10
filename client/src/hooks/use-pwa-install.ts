import { useState, useEffect, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredPrompt = null;
    notifyListeners();
  });
}

export function usePwaInstall() {
  const [, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setRevision((revision) => revision + 1);
    };
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return false;

    const prompt = deferredPrompt;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;

    if (outcome === "accepted") {
      deferredPrompt = null;
      notifyListeners();
      return true;
    }
    return false;
  }, []);

  return {
    isInstallable: deferredPrompt !== null,
    isInstalled: installed,
    install,
  };
}
