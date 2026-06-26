import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const LOGO_VERSION_KEY = "__logo_version__";

// Returns a cache-busted logo URL. Re-evaluates whenever invalidateLogoSrc() is called.
export function useLogoSrc(): string {
  const [version, setVersion] = useState<number>(() => {
    try { return Number(sessionStorage.getItem(LOGO_VERSION_KEY) || "0"); } catch { return 0; }
  });

  useEffect(() => {
    const handler = () => {
      const next = Date.now();
      try { sessionStorage.setItem(LOGO_VERSION_KEY, String(next)); } catch { /* ignore */ }
      setVersion(next);
    };
    window.addEventListener("logo-updated", handler);
    return () => window.removeEventListener("logo-updated", handler);
  }, []);

  return `/api/public/logo?v=${version}`;
}

// Call this after uploading or removing the logo to refresh all logo images everywhere.
export function invalidateLogoSrc() {
  window.dispatchEvent(new CustomEvent("logo-updated"));
}
