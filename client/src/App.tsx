import { useState, useEffect, createContext, useContext, Component } from "react";
import type { ReactNode } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { WhatsAppAlertProvider } from "@/hooks/use-whatsapp-alert";
import { ThemeToggle } from "@/components/theme-toggle";
import { offlineStore } from "@/lib/offline-store";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Items from "@/pages/items";
import Categories from "@/pages/categories";
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
import CustomerPaymentsPage from "@/pages/customer-payments";
import ImportData from "@/pages/import-data";
import EmailLogs from "@/pages/email-logs";
import ChartOfAccounts from "@/pages/chart-of-accounts";
import JournalEntries from "@/pages/journal-entries";
import Expenses from "@/pages/expenses";
import AccountingReports from "@/pages/accounting-reports";
import GeneralLedger from "@/pages/general-ledger";
import AccountingAudit from "@/pages/accounting-audit";
import PdaOperations from "@/pages/pda-operations";
import PortalLogin from "@/pages/portal-login";
import PortalLayout from "@/pages/portal-layout";
import LoginPage from "@/pages/login";
import UsersPage from "@/pages/users";
import ActivityLogsPage from "@/pages/activity-logs";
import DeployGuide from "@/pages/deploy-guide";
import VersionControl from "@/pages/version-control";
import PosLocations from "@/pages/pos-locations";
import PosTerminals from "@/pages/pos-terminals";
import PosLayouts from "@/pages/pos-layouts";
import PosOrders from "@/pages/pos-orders";
import PosRegister from "@/pages/pos-register";
import PosSyncMonitor from "@/pages/pos-sync-monitor";
import ChatPanel from "@/pages/chat-panel";
import FaqEditor from "@/pages/faq-editor";
import CustomerPushPage from "@/pages/customer-push";
import PosPromotions from "@/pages/pos-promotions";
import PosReturns from "@/pages/pos-returns";
import PosShifts from "@/pages/pos-shifts";
import PosCardTerminal from "@/pages/pos-card-terminal";
import PosDownload from "@/pages/pos-download";
import PosLayoutEditor from "@/pages/pos-layout-editor";
import WhatsAppOrders from "@/pages/whatsapp-orders";
import DigitalSignage from "@/pages/signage";
import SignagePlayer from "@/pages/signage-player";
import type { Customer } from "@shared/schema";
import { isPosAdmin, isPosStaff } from "@/lib/pos-permissions";
import { Loader2 } from "lucide-react";

// ─── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">Something went wrong</p>
          <p className="text-sm text-muted-foreground max-w-md">{(this.state.error as Error).message}</p>
          <a href="/" className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Return to Dashboard
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Auth Context ────────────────────────────────────────────────────────────
interface AuthUser { id: string; username: string; email: string | null; role: string; permissions: string[]; }
interface AuthContextValue { user: AuthUser | null; setUser: (u: AuthUser | null) => void; logout: () => void; }
const AuthContext = createContext<AuthContextValue>({ user: null, setUser: () => {}, logout: () => {} });
export const useAuth = () => useContext(AuthContext);

/** Returns true if the user can access a module. Admin/superuser always pass. */
export function hasModuleAccess(user: AuthUser | null, module: string): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "superuser") return true;
  if (!user.permissions || user.permissions.length === 0) return true;
  return user.permissions.includes(module);
}

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
      <Route path="/categories" component={Categories} />
      <Route path="/customers" component={Customers} />
      <Route path="/invoices/new" component={InvoiceForm} />
      <Route path="/invoices/:id/edit" component={InvoiceForm} />
      <Route path="/invoices/:id" component={InvoiceForm} />
      <Route path="/invoices" component={() => <Invoices docType="invoice" />} />
      <Route path="/credit-notes" component={() => <Invoices docType="credit_note" />} />
      <Route path="/proforma" component={() => <Invoices docType="proforma" />} />
      <Route path="/quotations" component={() => <Invoices docType="quotation" />} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/purchase-invoices" component={PurchaseInvoices} />
      <Route path="/supplier-payments" component={SupplierPaymentsPage} />
      <Route path="/customer-payments" component={CustomerPaymentsPage} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/offers" component={Offers} />
      <Route path="/reports" component={Reports} />
      <Route path="/email-logs" component={EmailLogs} />
      <Route path="/accounting/chart-of-accounts" component={ChartOfAccounts} />
      <Route path="/accounting/journal-entries" component={JournalEntries} />
      <Route path="/accounting/expenses" component={Expenses} />
      <Route path="/accounting/reports" component={AccountingReports} />
      <Route path="/accounting/general-ledger/:accountId" component={GeneralLedger} />
      <Route path="/accounting/audit" component={AccountingAudit} />
      <Route path="/pda-operations" component={PdaOperations} />
      <Route path="/import" component={ImportData} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/deploy-guide" component={DeployGuide} />
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/users" component={UsersPage} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/activity-logs" component={ActivityLogsPage} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/version-control" component={VersionControl} />}
      {/* ── POS routes ────────────────────────────────────────────────────────
           Staff (cashier) tier  : register + card-terminal only.
           Admin (management) tier: all other POS screens are admin/superuser.
           See client/src/lib/pos-permissions.ts for the canonical definitions.
      ──────────────────────────────────────────────────────────────────────── */}
      {isPosAdmin(user) && <Route path="/pos/locations" component={PosLocations} />}
      {isPosAdmin(user) && <Route path="/pos/terminals" component={PosTerminals} />}
      {isPosAdmin(user) && <Route path="/pos/layouts" component={PosLayouts} />}
      {isPosAdmin(user) && <Route path="/pos/orders" component={PosOrders} />}
      {isPosStaff(user) && <Route path="/pos/register" component={PosRegister} />}
      {isPosAdmin(user) && <Route path="/pos/promotions" component={PosPromotions} />}
      {isPosAdmin(user) && <Route path="/pos/returns" component={PosReturns} />}
      {isPosAdmin(user) && <Route path="/pos/shifts" component={PosShifts} />}
      {isPosStaff(user) && <Route path="/pos/card-terminal" component={PosCardTerminal} />}
      {isPosAdmin(user) && <Route path="/pos/sync-monitor" component={PosSyncMonitor} />}
      {isPosAdmin(user) && <Route path="/pos/download" component={PosDownload} />}
      {isPosAdmin(user) && <Route path="/pos/layouts/:id/edit" component={PosLayoutEditor} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/chat-panel" component={ChatPanel} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/faq-editor" component={FaqEditor} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/customer-push" component={CustomerPushPage} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/whatsapp-orders" component={WhatsAppOrders} />}
      {(user?.role === "admin" || user?.role === "superuser") && <Route path="/signage" component={DigitalSignage} />}
      <Route component={NotFound} />
    </Switch>
  );
}

function AdminLayout() {
  const style = { "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" };
  return (
    <WhatsAppAlertProvider>
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
              <ErrorBoundary>
                <AdminRouter />
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </WhatsAppAlertProvider>
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
        <LoginPage onLogin={u => setUser({ email: null, permissions: [], ...u })} />
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
  const isSignagePlayer = location.startsWith("/signage/play/");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isSignagePlayer ? (
          <Switch>
            <Route path="/signage/play/:code" component={SignagePlayer} />
          </Switch>
        ) : isPortal ? (
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
