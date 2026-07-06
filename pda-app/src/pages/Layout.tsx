import { Link, useLocation } from "wouter";
import { ScanBarcode, ClipboardList, Tags, ArrowLeftRight, FileText, LogOut } from "lucide-react";
import { type StaffSession, hasModuleAccess, clearToken } from "@/lib/auth";
import { cn } from "@/lib/cn";
import PriceLookup from "./PriceLookup";
import StockTake from "./StockTake";
import Agoranomia from "./Agoranomia";
import Transfers from "./Transfers";
import InvoiceReceipt from "./InvoiceReceipt";

const NAV = [
  { path: "/lookup", label: "Look-Up", icon: ScanBarcode },
  { path: "/stock-take", label: "Stock Take", icon: ClipboardList },
  { path: "/agoranomia", label: "Labels", icon: Tags },
  { path: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { path: "/receipt", label: "Receipts", icon: FileText },
];

interface LayoutProps {
  staff: StaffSession;
  onLogout: () => void;
}

export default function Layout({ staff, onLogout }: LayoutProps) {
  const [location, setLocation] = useLocation();

  if (location === "/" || location === "") {
    setLocation("/lookup");
  }

  const visibleNav = NAV.filter((n) => hasModuleAccess(staff, "pda_operations"));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="safe-top flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <ScanBarcode className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">GlobiPOS PDA</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" data-testid="text-staff-username">{staff.username}</span>
          <button
            onClick={() => { clearToken(); onLogout(); }}
            className="text-muted-foreground hover:text-destructive"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {location === "/lookup" && <PriceLookup />}
        {location === "/stock-take" && <StockTake />}
        {location === "/agoranomia" && <Agoranomia />}
        {location === "/transfers" && <Transfers />}
        {location === "/receipt" && <InvoiceReceipt />}
      </main>

      <nav className="bottom-nav fixed bottom-0 left-0 right-0 bg-card border-t border-border flex justify-around">
        {visibleNav.map(({ path, label, icon: Icon }) => (
          <Link key={path} href={path}>
            <button
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 px-2 text-xs flex-1",
                location === path ? "text-primary" : "text-muted-foreground"
              )}
              data-testid={`nav-${path.slice(1)}`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          </Link>
        ))}
      </nav>
    </div>
  );
}
