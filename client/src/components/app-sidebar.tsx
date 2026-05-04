import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Wine, LayoutDashboard, Package, Users, FileText, Tag, BarChart3, Gift, Settings, Truck, ShoppingCart, CreditCard, Upload, Mail, WifiOff, Download, Smartphone, BookOpen, Receipt, Wallet, PieChart, ShieldCheck, Activity, LogOut, UserCircle, Banknote, ClipboardList } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { offlineStore } from "@/lib/offline-store";
import { useAuth, hasModuleAccess } from "@/App";
import type { SystemSetting } from "@shared/schema";

// Module keys used in the permissions system
const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, module: "dashboard" },
  { title: "Items", url: "/items", icon: Package, module: "items" },
  { title: "Customers", url: "/customers", icon: Users, module: "customers" },
  { title: "Customer Statements", url: "/reports?tab=statements", icon: ClipboardList, module: "statements" },
  { title: "Email Log", url: "/email-logs", icon: Mail, module: "email_logs" },
];

const salesNav = [
  { title: "Invoices", url: "/invoices", icon: FileText, module: "invoices" },
  { title: "Credit Notes", url: "/credit-notes", icon: FileText, module: "invoices" },
  { title: "Proforma", url: "/proforma", icon: FileText, module: "invoices" },
  { title: "Quotations", url: "/quotations", icon: FileText, module: "invoices" },
  { title: "Customer Payments", url: "/customer-payments", icon: Banknote, module: "payments" },
];

const purchasingNav = [
  { title: "Suppliers", url: "/suppliers", icon: Truck, module: "suppliers" },
  { title: "Purchase Invoices", url: "/purchase-invoices", icon: ShoppingCart, module: "suppliers" },
  { title: "Supplier Payments", url: "/supplier-payments", icon: CreditCard, module: "suppliers" },
];

const pricingNav = [
  { title: "Price Contracts", url: "/pricing", icon: Tag, module: "pricing" },
  { title: "Seasonal Offers", url: "/offers", icon: Gift, module: "pricing" },
];

const accountingNav = [
  { title: "Chart of Accounts", url: "/accounting/chart-of-accounts", icon: BookOpen, module: "accounting" },
  { title: "Journal Entries", url: "/accounting/journal-entries", icon: Receipt, module: "accounting" },
  { title: "Expenses", url: "/accounting/expenses", icon: Wallet, module: "accounting" },
  { title: "Financial Reports", url: "/accounting/reports", icon: PieChart, module: "accounting" },
  { title: "Audit Grid", url: "/accounting/audit", icon: ShieldCheck, module: "accounting" },
];

const reportNav = [
  { title: "Reports", url: "/reports", icon: BarChart3, module: "reports" },
];

const systemNav = [
  { title: "Import Data", url: "/import", icon: Upload, module: "import" },
  { title: "Settings", url: "/settings", icon: Settings, module: "_settings" },
];

const adminNav = [
  { title: "Activity Log", url: "/activity-logs", icon: Activity, module: "_admin" },
];

type NavItem = { title: string; url: string; icon: any; module: string };

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const [location] = useLocation();
  if (items.length === 0) return null;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const itemPath = item.url.split("?")[0];
            const itemQuery = item.url.includes("?") ? item.url.split("?")[1] : null;
            const [locPath, locQuery] = [location.split("?")[0], location.includes("?") ? location.split("?")[1] : ""];
            const isActive = itemQuery
              ? locPath === itemPath && locQuery.includes(itemQuery)
              : location === item.url || (item.url !== "/" && locPath.startsWith(itemPath));
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  data-active={isActive}
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.href = item.url;
                  }}
                  data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);
  const { isInstallable, isInstalled, install } = usePwaInstall();
  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const companyName = settings.find(s => s.key === "company_name")?.value || "VINERIA DI MARE Trading";
  const { user, logout } = useAuth();

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const checkPending = () => {
      offlineStore.getPendingInvoices().then(p => setPendingCount(p.length)).catch(() => {});
    };
    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
    };
  }, []);

  // Filter each section based on the user's permitted modules
  const isAdmin = user?.role === "admin" || user?.role === "superuser";
  const filter = (items: NavItem[]) => items.filter(i => hasModuleAccess(user, i.module));

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 overflow-hidden flex-shrink-0 flex items-center justify-center">
            <img src="/logo.png" alt="Logo" className="w-[200%] h-[200%] object-contain" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground leading-tight">{companyName}</span>
            <span className="text-xs text-sidebar-foreground/60">Food &amp; Beverage Wholesale</span>
          </div>
        </div>
        {!isOnline && (
          <div className="flex items-center gap-1.5 mt-2 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/50" data-testid="sidebar-offline-badge">
            <WifiOff className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Offline Mode</span>
          </div>
        )}
        {pendingCount > 0 && (
          <div className="flex items-center gap-1.5 mt-1 px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50" data-testid="sidebar-pending-badge">
            <span className="text-xs text-blue-700 dark:text-blue-300">{pendingCount} pending sync</span>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <NavSection label="Overview" items={filter(mainNav)} />
        <NavSection label="Sales" items={filter(salesNav)} />
        <NavSection label="Purchasing" items={filter(purchasingNav)} />
        <NavSection label="Pricing" items={filter(pricingNav)} />
        <NavSection label="Accounting" items={filter(accountingNav)} />
        <NavSection label="Analytics" items={filter(reportNav)} />
        <NavSection label="System" items={filter(systemNav)} />
        {isAdmin && <NavSection label="Admin" items={adminNav} />}
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-2">
        {isInstallable && !isInstalled && (
          <button
            onClick={install}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs font-medium bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 transition-opacity"
            data-testid="button-install-app"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install App</span>
          </button>
        )}
        {isInstalled && (
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-100 dark:bg-green-900/50" data-testid="badge-app-installed">
            <Smartphone className="w-3 h-3 text-green-600 dark:text-green-400" />
            <span className="text-xs text-green-700 dark:text-green-300">App Installed</span>
          </div>
        )}
        {user && (
          <div className="border-t border-sidebar-border pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <UserCircle className="w-4 h-4 text-sidebar-foreground/60 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-sidebar-foreground truncate">{user.username}</div>
                  <div className="text-xs text-sidebar-foreground/50 capitalize">{user.role}</div>
                </div>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                data-testid="button-logout"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
          <Wine className="w-3 h-3" />
          <span>{companyName} v1.0</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
