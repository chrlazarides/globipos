import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Wine, LayoutDashboard, Package, Users, FileText, Tag, BarChart3, Gift, Grape, Settings, Truck, ShoppingCart, CreditCard, Upload, Mail, WifiOff, Download, Smartphone, BookOpen, Receipt, Wallet, PieChart } from "lucide-react";
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

const mainNav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Items", url: "/items", icon: Package },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Email Log", url: "/email-logs", icon: Mail },
];

const salesNav = [
  { title: "Invoices", url: "/invoices", icon: FileText },
  { title: "Credit Notes", url: "/credit-notes", icon: FileText },
  { title: "Proforma", url: "/proforma", icon: FileText },
  { title: "Quotations", url: "/quotations", icon: FileText },
];

const purchasingNav = [
  { title: "Suppliers", url: "/suppliers", icon: Truck },
  { title: "Purchase Invoices", url: "/purchase-invoices", icon: ShoppingCart },
  { title: "Supplier Payments", url: "/supplier-payments", icon: CreditCard },
];

const pricingNav = [
  { title: "Price Contracts", url: "/pricing", icon: Tag },
  { title: "Seasonal Offers", url: "/offers", icon: Gift },
];

const accountingNav = [
  { title: "Chart of Accounts", url: "/accounting/chart-of-accounts", icon: BookOpen },
  { title: "Journal Entries", url: "/accounting/journal-entries", icon: Receipt },
  { title: "Expenses", url: "/accounting/expenses", icon: Wallet },
  { title: "Financial Reports", url: "/accounting/reports", icon: PieChart },
];

const reportNav = [
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

const systemNav = [
  { title: "Import Data", url: "/import", icon: Upload },
  { title: "Settings", url: "/settings", icon: Settings },
];

function NavSection({ label, items }: { label: string; items: typeof mainNav }) {
  const [location] = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild data-active={isActive}>
                  <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </Link>
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

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-sidebar-primary">
            <Grape className="w-4 h-4 text-sidebar-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">VinTrade</span>
            <span className="text-xs text-sidebar-foreground/60">Wholesale Management</span>
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
        <NavSection label="Overview" items={mainNav} />
        <NavSection label="Sales" items={salesNav} />
        <NavSection label="Purchasing" items={purchasingNav} />
        <NavSection label="Pricing" items={pricingNav} />
        <NavSection label="Accounting" items={accountingNav} />
        <NavSection label="Analytics" items={reportNav} />
        <NavSection label="System" items={systemNav} />
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
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
          <Wine className="w-3 h-3" />
          <span>VinTrade v1.0</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
