import { Switch, Route, Link, useLocation } from "wouter";
import { type CustomerSession, clearToken } from "../lib/auth";
import { queryClient } from "../lib/queryClient";
import Catalog from "./Catalog";
import Basket, { type BasketItem } from "./Basket";
import Orders from "./Orders";
import Account from "./Account";
import Loyalty from "./Loyalty";
import Discover from "./Discover";
import Notifications, { type CustomerNotification } from "./Notifications";
import PushNotificationBanner from "../components/PushNotificationBanner";
import { ShoppingCart, Package, Receipt, User, Sparkles, LogOut, Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { BrandingConfig } from "../lib/branding";

interface LayoutProps {
  customer: CustomerSession;
  onLogout: () => void;
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
  branding: BrandingConfig;
}

const navItems = [
  { label: "Shop",    path: "/",        icon: Package  },
  { label: "For You", path: "/discover", icon: Sparkles },
  { label: "Basket",  path: "/basket",   icon: ShoppingCart },
  { label: "Orders",  path: "/orders",   icon: Receipt  },
  { label: "Account", path: "/account",  icon: User     },
];

export default function Layout({ customer, onLogout, basket, setBasket, branding }: LayoutProps) {
  const [location] = useLocation();

  const totalItems = basket.reduce((s, i) => s + i.quantity, 0);
  const { data: notifications = [] } = useQuery<CustomerNotification[]>({ queryKey: ["/api/customer/notifications"] });
  const unreadNotifications = notifications.filter((n) => !n.read && !n.readAt).length;

  function handleLogout() {
    clearToken();
    queryClient.clear();
    onLogout();
  }

  return (
    <div className={`min-h-[100dvh] bg-[hsl(var(--background))] flex flex-col grain ${branding.storefrontTemplate === "classic" ? "classic-storefront" : "fresh-storefront"}`}>
      <PushNotificationBanner />
      {/* Top header */}
      <header className="sticky top-0 z-40 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] safe-top">
        <div className="max-w-6xl mx-auto w-full px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--primary))" }}
            >
              {branding.logoUrl ? <img src={branding.logoUrl} alt="" className="w-7 h-7 object-contain" /> : <span className="text-xs font-bold text-white">G</span>}
            </div>
            <div>
              <span className="font-display text-lg font-bold leading-none block">{branding.companyName}</span>
              <span className="text-[10px] uppercase tracking-[.18em] text-[hsl(var(--muted-foreground))]">Good food, close to home</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/notifications" className="relative p-1 text-[hsl(var(--muted-foreground))]" aria-label="Notifications">
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: "hsl(var(--primary))" }}>{unreadNotifications > 9 ? "9+" : unreadNotifications}</span>}
            </Link>
            <button onClick={handleLogout} className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors" data-testid="button-logout">
              <LogOut className="w-3.5 h-3.5" /><span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 md:px-8 pb-24 pt-5 md:pt-8">
        <Switch>
           <Route path="/"        component={() => <Catalog customer={customer} basket={basket} setBasket={setBasket} branding={branding} />} />
           <Route path="/basket"  component={() => <Basket  customer={customer} basket={basket} setBasket={setBasket} branding={branding} />} />
          <Route path="/orders"  component={() => <Orders  customer={customer} />} />
          <Route path="/discover" component={() => <Discover basket={basket} setBasket={setBasket} />} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/account" component={() => <Account customer={customer} />} />
          <Route path="/loyalty" component={() => <Loyalty customer={customer} />} />
        </Switch>
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[hsl(var(--card))]/95 backdrop-blur border-t border-[hsl(var(--border))] bottom-nav md:top-20 md:bottom-auto md:left-auto md:right-8 md:border md:rounded-full md:shadow-lg md:px-2" data-testid="nav-bottom">
        <div className="max-w-2xl mx-auto flex">
          {navItems.map((item) => {
            const isActive = item.path === "/"
              ? location === "/"
              : location.startsWith(item.path);
            const isBasket = item.path === "/basket";
            return (
              <Link key={item.path} href={item.path} className={`flex-1 flex flex-col items-center py-2.5 px-3 gap-0.5 text-xs transition-colors relative ${
                    isActive
                      ? "text-[hsl(var(--primary))]"
                      : "text-[hsl(var(--muted-foreground))]"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <div className="relative">
                    <item.icon className="w-5 h-5" />
                    {isBasket && totalItems > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: "hsl(var(--primary))" }}>
                        {totalItems > 9 ? "9+" : totalItems}
                      </span>
                    )}
                  </div>
                  <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
