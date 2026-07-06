import { useState, useEffect } from "react";
import { Router } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { getStaff, getToken, type StaffSession } from "./lib/auth";
import Login from "./pages/Login";
import Layout from "./pages/Layout";

export default function App() {
  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (getToken() && getStaff()) {
      setStaff(getStaff());
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
        {!staff ? (
          <Login onLogin={(s) => setStaff(s)} />
        ) : (
          <Layout staff={staff} onLogout={() => setStaff(null)} />
        )}
      </Router>
    </QueryClientProvider>
  );
}
