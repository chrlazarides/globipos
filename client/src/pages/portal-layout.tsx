import { useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Grape, LayoutDashboard, ShoppingCart, FileText, Receipt, LogOut, MessageCircle, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Customer, SystemSetting } from "@shared/schema";
import PortalDashboard from "./portal-dashboard";
import PortalShop from "./portal-shop";
import PortalOrders from "./portal-orders";
import PortalStatement from "./portal-statement";
import PortalChatbot from "./portal-chatbot";

interface PortalLayoutProps {
  customer: Customer;
  onLogout: () => void;
}

const navItems = [
  { title: "Overview", url: "/portal", icon: LayoutDashboard },
  { title: "Shop", url: "/portal/shop", icon: ShoppingCart },
  { title: "My Orders", url: "/portal/orders", icon: Receipt },
  { title: "Invoices", url: "/portal/invoices", icon: FileText },
  { title: "Order Assistant", url: "/portal/assistant", icon: MessageCircle },
];

export default function PortalLayout({ customer, onLogout }: PortalLayoutProps) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const companyName = settings.find(s => s.key === "company_name")?.value || "Gastro Nobile";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 overflow-hidden flex-shrink-0 flex items-center justify-center">
              <img src="/logo.png" alt="Logo" className="w-[200%] h-[200%] object-contain" />
            </div>
            <span className="text-sm font-semibold hidden sm:inline">{companyName}</span>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.url || (item.url !== "/portal" && location.startsWith(item.url));
              return (
                <Link key={item.url} href={item.url}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className="toggle-elevate"
                    data-testid={`nav-portal-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <item.icon className="w-4 h-4 mr-1.5" />
                    {item.title}
                  </Button>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">{customer.name}</span>
            <ThemeToggle />
            <Button size="icon" variant="ghost" onClick={onLogout} data-testid="button-portal-logout">
              <LogOut className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              data-testid="button-portal-mobile-menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t p-2">
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/portal" && location.startsWith(item.url));
                return (
                  <Link key={item.url} href={item.url}>
                    <Button
                      variant={isActive ? "secondary" : "ghost"}
                      className="w-full justify-start"
                      onClick={() => setMobileMenuOpen(false)}
                      data-testid={`nav-portal-mobile-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <item.icon className="w-4 h-4 mr-2" />
                      {item.title}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <Switch>
          <Route path="/portal" component={() => <PortalDashboard customer={customer} />} />
          <Route path="/portal/shop" component={() => <PortalShop customer={customer} />} />
          <Route path="/portal/orders" component={() => <PortalOrders customer={customer} />} />
          <Route path="/portal/invoices" component={() => <PortalStatement customer={customer} />} />
          <Route path="/portal/assistant" component={() => <PortalChatbot customer={customer} />} />
        </Switch>
      </main>
    </div>
  );
}
