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

interface LayoutProps {
  customer: CustomerSession;
  onLogout: () => void;
  basket: BasketItem[];
  setBasket: React.Dispatch<React.SetStateAction<BasketItem[]>>;
}

const navItems = [
  { label: "Shop",    path: "/",        icon: Package  },
  { label: "For You", path: "/discover", icon: Sparkles },
  { label: "Basket",  path: "/basket",   icon: ShoppingCart },
  { label: "Orders",  path: "/orders",   icon: Receipt  },
  { label: "Account", path: "/account",  icon: User     },
];

export default function Layout({ customer, onLogout, basket, setBasket }: LayoutProps) {
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
    <div className="min-h-screen bg-[hsl(var(--background))] flex flex-col">
      <PushNotificationBanner />
      {/* Top header */}
      <header className="sticky top-0 z-40 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] safe-top">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "hsl(var(--primary))" }}
            >
              <span className="text-xs font-bold text-white">G</span>
            </div>
            <span className="text-sm font-semibold truncate max-w-[160px]">{customer.name}</span>
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
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 pb-24 pt-4">
        <Switch>
          <Route path="/"        component={() => <Catalog customer={customer} basket={basket} setBasket={setBasket} />} />
          <Route path="/basket"  component={() => <Basket  customer={customer} basket={basket} setBasket={setBasket} />} />
          <Route path="/orders"  component={() => <Orders  customer={customer} />} />
          <Route path="/discover" component={() => <Discover basket={basket} setBasket={setBasket} />} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/account" component={() => <Account customer={customer} />} />
          <Route path="/loyalty" component={() => <Loyalty customer={customer} />} />
        </Switch>
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[hsl(var(--card))] border-t border-[hsl(var(--border))] bottom-nav" data-testid="nav-bottom">
        <div className="max-w-2xl mx-auto flex">
          {navItems.map((item) => {
            const isActive = item.path === "/"
              ? location === "/"
              : location.startsWith(item.path);
            const isBasket = item.path === "/basket";
            return (
              <Link key={item.path} href={item.path} className="flex-1">
                <button
                  className={`w-full flex flex-col items-center py-2.5 gap-0.5 text-xs transition-colors relative ${
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
                </button>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
