import { useState, useEffect, useCallback } from "react";
import { Router, Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { getCustomer, getToken, type CustomerSession } from "./lib/auth";
import Login from "./pages/Login";
import Layout from "./pages/Layout";
import type { BasketItem } from "./pages/Basket";

const BASKET_KEY = "globi_basket";

function loadBasket(): BasketItem[] {
  try { return JSON.parse(localStorage.getItem(BASKET_KEY) || "[]"); } catch { return []; }
}

function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  let r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = 0, l = (max + min) / 2;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
  }
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

async function applyBranding() {
  try {
    const res = await fetch("/api/public/branding");
    if (!res.ok) return;
    const data = await res.json();
    if (data.primaryColor) {
      const hsl = hexToHsl(data.primaryColor);
      if (hsl) {
        document.documentElement.style.setProperty("--primary", hsl);
        document.documentElement.style.setProperty("--primary-dark", hsl);
      }
    }
    if (data.companyName) document.title = data.companyName + " Shop";
  } catch { /* branding load failure is non-fatal */ }
}

export default function App() {
  const [customer, setCustomer] = useState<CustomerSession | null>(null);
  const [ready, setReady] = useState(false);
  const [basket, setBasketState] = useState<BasketItem[]>(() => loadBasket());

  const setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>> = useCallback((action) => {
    setBasketState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      try { localStorage.setItem(BASKET_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    applyBranding();
    // Restore session from localStorage on mount
    if (getToken() && getCustomer()) {
      setCustomer(getCustomer());
    }
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        {!customer ? (
          <Login onLogin={(c) => setCustomer(c)} />
        ) : (
          <Layout
            customer={customer}
            onLogout={() => { setCustomer(null); setBasket([]); }}
            basket={basket}
            setBasket={setBasket}
          />
        )}
      </Router>
    </QueryClientProvider>
  );
}
