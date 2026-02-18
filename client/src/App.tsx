import { useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Items from "@/pages/items";
import Customers from "@/pages/customers";
import Invoices from "@/pages/invoices";
import InvoiceForm from "@/pages/invoice-form";
import Pricing from "@/pages/pricing";
import Offers from "@/pages/offers";
import Reports from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import PortalLogin from "@/pages/portal-login";
import PortalLayout from "@/pages/portal-layout";
import type { Customer } from "@shared/schema";

function AdminRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/items" component={Items} />
      <Route path="/customers" component={Customers} />
      <Route path="/invoices" component={() => <Invoices docType="invoice" />} />
      <Route path="/credit-notes" component={() => <Invoices docType="credit_note" />} />
      <Route path="/proforma" component={() => <Invoices docType="proforma" />} />
      <Route path="/invoices/new" component={InvoiceForm} />
      <Route path="/invoices/:id/edit" component={InvoiceForm} />
      <Route path="/invoices/:id" component={InvoiceForm} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/offers" component={Offers} />
      <Route path="/reports" component={Reports} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 py-2 border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-y-auto">
            <AdminRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function PortalWrapper() {
  const [portalCustomer, setPortalCustomer] = useState<Customer | null>(() => {
    const saved = sessionStorage.getItem("portal_customer");
    return saved ? JSON.parse(saved) : null;
  });

  const handleLogin = (customer: Customer) => {
    setPortalCustomer(customer);
    sessionStorage.setItem("portal_customer", JSON.stringify(customer));
  };

  const handleLogout = () => {
    setPortalCustomer(null);
    sessionStorage.removeItem("portal_customer");
  };

  if (!portalCustomer) {
    return <PortalLogin onLogin={handleLogin} />;
  }

  return <PortalLayout customer={portalCustomer} onLogout={handleLogout} />;
}

function App() {
  const [location] = useLocation();
  const isPortal = location.startsWith("/portal");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isPortal ? <PortalWrapper /> : <AdminLayout />}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
