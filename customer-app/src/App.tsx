import { useState, useEffect } from "react";
import { Router, Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { getCustomer, getToken, type CustomerSession } from "./lib/auth";
import Login from "./pages/Login";
import Layout from "./pages/Layout";

export default function App() {
  const [customer, setCustomer] = useState<CustomerSession | null>(null);
  const [ready, setReady] = useState(false);

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
          <Layout customer={customer} onLogout={() => setCustomer(null)} />
        )}
      </Router>
    </QueryClientProvider>
  );
}
