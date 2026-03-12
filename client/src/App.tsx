import { useState, useEffect, createContext, useContext } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { offlineStore } from "@/lib/offline-store";
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
import Suppliers from "@/pages/suppliers";
import PurchaseInvoices from "@/pages/purchase-invoices";
import SupplierPaymentsPage from "@/pages/supplier-payments";
import ImportData from "@/pages/import-data";
import EmailLogs from "@/pages/email-logs";
import ChartOfAccounts from "@/pages/chart-of-accounts";
import JournalEntries from "@/pages/journal-entries";
import Expenses from "@/pages/expenses";
import AccountingReports from "@/pages/accounting-reports";
import GeneralLedger from "@/pages/general-ledger";
import PortalLogin from "@/pages/portal-login";
import PortalLayout from "@/pages/portal-layout";
import LoginPage from "@/pages/login";
import UsersPage from "@/pages/users";
import ActivityLogsPage from "@/pages/activity-logs";
import type { Customer } from "@shared/schema";
import { Loader2 } from "lucide-react";

// ─── Auth Context ────────────────────────────────────────────────────────────
interface AuthUser { id: string; username: string; email: string | null; role: string; }
interface AuthContextValue { user: AuthUser | null; setUser: (u: AuthUser | null) => void; logout: () => void; }
const AuthContext = createContext<AuthContextValue>({ user: null, setUser: () => {}, logout: () => {} });
export const useAuth = () => useContext(AuthContext);

// ─── Offline Data Sync ───────────────────────────────────────────────────────
function OfflineDataSync() {
  const { data: items } = useQuery<any[]>({ queryKey: ["/api/items"] });
  const { data: customers } = useQuery<any[]>({ queryKey: ["/api/customers"] });
  const { data: categories } = useQuery<any[]>({ queryKey: ["/api/categories"] });
  const { data: contracts } = useQuery<any[]>({ queryKey: ["/api/price-contracts"] });
  const { data: settings } = useQuery<any[]>({ queryKey: ["/api/settings"] });
  const { data: suppliers } = useQuery<any[]>({ queryKey: ["/api/suppliers"] });
  const { data: purchaseInvoices } = useQuery<any[]>({ queryKey: ["/api/purchase-invoices"] });

  useEffect(() => { if (items && items.length > 0) offlineStore.cacheItems(items).catch(() => {}); }, [items]);
  useEffect(() => { if (customers && customers.length > 0) offlineStore.cacheCustomers(customers).catch(() => {}); }, [customers]);
  useEffect(() => { if (categories && categories.length > 0) offlineStore.cacheCategories(categories).catch(() => {}); }, [categories]);
  useEffect(() => { if (contracts && contracts.length > 0) offlineStore.cachePriceContracts(contracts).catch(() => {}); }, [contracts]);
  useEffect(() => { if (settings && settings.length > 0) offlineStore.cacheSettings(settings).catch(() => {}); }, [settings]);
  useEffect(() => { if (suppliers && suppliers.length > 0) offlineStore.cacheSuppliers(suppliers).catch(() => {}); }, [suppliers]);
  useEffect(() => { if (purchaseInvoices && purchaseInvoices.length > 0) offlineStore.cachePurchaseInvoices(purchaseInvoices).catch(() => {}); }, [purchaseInvoices]);

  return null;
}

// ─── Admin Routes ────────────────────────────────────────────────────────────
function AdminRouter() {
  const { user } = useAuth();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/items" component={Items} />
      <Route path="/customers" component={Customers} />
      <Route path="/invoices" component={() => <Invoices docType="invoice" />} />
      <Route path="/credit-notes" component={() => <Invoices docType="credit_note" />} />
      <Route path="/proforma" component={() => <Invoices docType="proforma" />} />
      <Route path="/quotations" component={() => <Invoices docType="quotation" />} />
      <Route path="/invoices/new" component={InvoiceForm} />
      <Route path="/invoices/:id/edit" component={InvoiceForm} />
      <Route path="/invoices/:id" component={InvoiceForm} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/purchase-invoices" component={PurchaseInvoices} />
      <Route path="/supplier-payments" component={SupplierPaymentsPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/offers" component={Offers} />
      <Route path="/reports" component={Reports} />
      <Route path="/email-logs" component={EmailLogs} />
      <Route path="/accounting/chart-of-accounts" component={ChartOfAccounts} />
      <Route path="/accounting/journal-entries" component={JournalEntries} />
      <Route path="/accounting/expenses" component={Expenses} />
      <Route path="/accounting/reports" component={AccountingReports} />
      <Route path="/accounting/general-ledger/:accountId" component={GeneralLedger} />
      <Route path="/import" component={ImportData} />
      <Route path="/settings" component={SettingsPage} />
      {user?.role === "admin" && <Route path="/users" component={UsersPage} />}
      {user?.role === "admin" && <Route path="/activity-logs" component={ActivityLogsPage} />}
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout() {
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <OfflineDataSync />
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

// ─── Portal ──────────────────────────────────────────────────────────────────
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

  if (!portalCustomer) return <PortalLogin onLogin={handleLogin} />;
  return <PortalLayout customer={portalCustomer} onLogout={handleLogout} />;
}

// ─── Auth Gate ───────────────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(u => { setUser(u); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setUser(null);
    queryClient.clear();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthContext.Provider value={{ user, setUser, logout }}>
        <LoginPage onLogin={u => setUser(u)} />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── App Root ────────────────────────────────────────────────────────────────
function App() {
  const [location] = useLocation();
  const isPortal = location.startsWith("/portal");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isPortal ? (
          <PortalWrapper />
        ) : (
          <AuthGate>
            <AdminLayout />
          </AuthGate>
        )}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
