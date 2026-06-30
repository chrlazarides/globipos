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
