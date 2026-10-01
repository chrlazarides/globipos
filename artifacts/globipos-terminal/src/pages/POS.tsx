import { useState, useEffect } from "react";
import { LogOut, Settings, Trash2, Search, ArrowRight, X, AlertCircle, Globe, ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import type { TerminalConfig, CashierSession, Category, Product, OrderLine } from "../types";
import { getCategories, getProducts, writeAudit } from "../lib/db";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/BrandLogo";
import { calculateLine, createOrderLine, parseValidCashTender } from "@/lib/pos-calculations";
import { effectivePrice } from "@/lib/pos-calculations";
import { VoucherDialog } from "../components/VoucherDialog";
import { MultiLocationSearch } from "../components/MultiLocationSearch";
import { SyncIndicator } from "../components/SyncIndicator";

interface POSProps {
  config: TerminalConfig;
  session: CashierSession;
  onLogout: () => void;
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-CY", { style: "currency", currency: "EUR" }).format(amount);
}

type ExternalLaunch = { type: "web" | "app" | "server"; target: string };
type ExternalButton = { position: number; label: string; actionCode: string; launch: ExternalLaunch };
type VoucherButton = { position: number; label: string; actionCode: "GIFT_VOUCHER" | "PAY_VOUCHER" };

function validLaunch(value: unknown): value is ExternalLaunch {
  if (!value || typeof value !== "object") return false;
  const launch = value as Record<string, unknown>;
  if (typeof launch.target !== "string" || !launch.target.trim() || launch.target.length > 2048) return false;
  try {
    const url = new URL(launch.target);
    if (url.username || url.password) return false;
    if (launch.type === "web" || launch.type === "server") return ["http:", "https:"].includes(url.protocol);
    return launch.type === "app" && /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
      !["http:", "https:", "file:", "javascript:", "data:", "blob:", "ftp:", "shell:", "cmd:", "powershell:"].includes(url.protocol);
  } catch { return false; }
}

export function POS({ config, session, onLogout }: POSProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  
  const [cart, setCart] = useState<OrderLine[]>([]);
  const [search, setSearch] = useState("");
  const [externalButtons, setExternalButtons] = useState<ExternalButton[]>([]);
  const [voucherButtons, setVoucherButtons] = useState<VoucherButton[]>([]);
  const [voucherMode, setVoucherMode] = useState<"issue" | "redeem" | null>(null);
  const [itemSearchAssigned, setItemSearchAssigned] = useState(false);
  const [stockInAssigned, setStockInAssigned] = useState(false);
  const [stockDialogMode, setStockDialogMode] = useState<"lookup" | "stockIn" | "transfer" | null>(null);
  const [externalPanel, setExternalPanel] = useState<ExternalButton | null>(null);
  const [layoutError, setLayoutError] = useState("");
  const [layoutRefresh, setLayoutRefresh] = useState(0);
  const [launchingCode, setLaunchingCode] = useState<string | null>(null);
  
  const [paying, setPaying] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [checkoutPin, setCheckoutPin] = useState("");
  const [checkoutId, setCheckoutId] = useState(() => crypto.randomUUID());
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [checkoutUncertain, setCheckoutUncertain] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    async function load() {
      const cats = await getCategories();
      const activeCategories = cats.filter((category) => category.active);
      setCategories(activeCategories);
      if (activeCategories.length > 0) setActiveCategory(activeCategories[0].id);
      
      const prods = await getProducts();
      setProducts(prods.filter((product) => product.active));
    }
    void load();
    window.addEventListener("globipos:catalog-updated", load);
    return () => window.removeEventListener("globipos:catalog-updated", load);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    async function loadLayout() {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`${config.server_url}/api/pos/sync/layout-config`, {
          headers: { "X-Terminal-Code": config.terminal_code }, signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) throw new Error(`Layout sync failed (${response.status})`);
        const data = await response.json();
        if (!Array.isArray(data.buttons) || !data.externalTools || typeof data.externalTools !== "object") {
          throw new Error("Invalid layout response");
        }
        const buttons: ExternalButton[] = data.buttons.flatMap((button: any) => {
          const code = typeof button.actionCode === "string" ? button.actionCode.toUpperCase() : "";
          const launch = data.externalTools[code];
          return button.buttonType === "action" && validLaunch(launch) ?
            [{ position: button.position, label: button.label || code, actionCode: code, launch }] : [];
        });
        const approvedCodes: string[] = Array.isArray(data.voucherActions) ? data.voucherActions : [];
        const voucherLayoutButtons: VoucherButton[] = data.buttons.flatMap((button: any) =>
          button.buttonType === "action" &&
          ["GIFT_VOUCHER", "PAY_VOUCHER"].includes(button.actionCode?.toUpperCase()) &&
          approvedCodes.includes(button.actionCode?.toUpperCase()) ?
            [{ position: button.position, label: button.label || button.actionCode, actionCode: button.actionCode.toUpperCase() }] : []);
        if (!controller.signal.aborted) {
          setExternalButtons(buttons.sort((a, b) => a.position - b.position));
          setVoucherButtons(voucherLayoutButtons.sort((a, b) => a.position - b.position));
          setItemSearchAssigned(data.buttons.some((button: any) =>
            button.buttonType === "action" && button.actionCode?.toUpperCase() === "ITEM_SEARCH"));
          setStockInAssigned(data.buttons.some((button: any) =>
            button.buttonType === "action" && button.actionCode?.toUpperCase() === "STOCK_IN"));
          setExternalPanel(current => current && buttons.some(button =>
            button.position === current.position && button.actionCode === current.actionCode &&
            button.launch.type === current.launch.type && button.launch.target === current.launch.target) ? current : null);
          setLayoutError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setExternalButtons([]);
          setVoucherButtons([]);
          setItemSearchAssigned(false);
          setStockInAssigned(false);
          setExternalPanel(null);
          setLayoutError(error instanceof Error ? error.message : "Layout unavailable");
        }
      } finally {
        inFlight = false;
      }
    }
    void loadLayout();
    const refreshInterval = window.setInterval(() => void loadLayout(), 30_000);
    return () => { controller.abort(); window.clearInterval(refreshInterval); };
  }, [config.server_url, config.terminal_code, layoutRefresh]);

  async function openExternal(button: ExternalButton) {
    if (launchingCode) return;
    setLaunchingCode(button.actionCode);
    try {
      // Always check the server again at click time; a previously approved target may have been revoked.
      const response = await fetch(`${config.server_url}/api/pos/sync/layout-config`, {
        headers: { "X-Terminal-Code": config.terminal_code }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not verify the approved target.");
      const data = await response.json();
      const target = data?.externalTools?.[button.actionCode];
      if (!Array.isArray(data?.buttons) || !validLaunch(target) ||
          target.type !== button.launch.type || target.target !== button.launch.target ||
          !data.buttons.some((entry: any) =>
            entry.buttonType === "action" && entry.actionCode?.toUpperCase() === button.actionCode &&
            entry.position === button.position)) {
        throw new Error("This button or external target is no longer approved. Refresh the layout.");
      }
      setExternalPanel(button);
      setLayoutError("");
    } catch (error) {
      setExternalButtons([]);
      setExternalPanel(null);
      setLayoutError(error instanceof Error ? error.message : "Could not verify the approved target.");
      toast({ title: "External button unavailable", description: "The assigned button and target must both be approved. Refresh after an admin reviews them.", variant: "destructive" });
    } finally {
      setLaunchingCode(null);
    }
  }

  async function openVoucher(button: VoucherButton) {
    if (launchingCode) return;
    if (!config.voucher_device_key) {
      toast({ title: "Pair this Terminal first", description: "Ask an administrator for its voucher key, then save it in Terminal Settings.", variant: "destructive" });
      return;
    }
    setLaunchingCode(button.actionCode);
    try {
      const response = await fetch(`${config.server_url}/api/pos/sync/layout-config`, {
        headers: { "X-Terminal-Code": config.terminal_code }, cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not verify this button with the store server.");
      const data = await response.json();
      if (!Array.isArray(data?.voucherActions) || !data.voucherActions.includes(button.actionCode) ||
          !Array.isArray(data?.buttons) || !data.buttons.some((entry: any) =>
            entry.buttonType === "action" && entry.actionCode?.toUpperCase() === button.actionCode &&
            entry.position === button.position)) {
        throw new Error("This voucher function is not approved or assigned to this Terminal.");
      }
      setVoucherMode(button.actionCode === "GIFT_VOUCHER" ? "issue" : "redeem");
    } catch (error) {
      setVoucherButtons([]);
      toast({ title: "Voucher function unavailable",
        description: error instanceof Error ? error.message : "Check the approved layout and online connection.",
        variant: "destructive" });
    } finally {
      setLaunchingCode(null);
    }
  }

  const displayedProducts = products.filter(p => {
    if (!p.active) return false;
    if (search) return p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search));
    return p.category_id === activeCategory;
  });

  const subtotal = cart.reduce((sum, line) => sum + line.line_total, 0);
  const total = subtotal; // Assuming VAT included in line_total for simplicity here

  function addToCart(product: Product) {
    setCheckoutId(crypto.randomUUID());
    setCart(prev => {
      const existing = prev.find(l => l.product_id === product.id);
      if (existing) {
        return prev.map(l => l.product_id === product.id 
          ? calculateLine(l, l.qty + 1)
          : l
        );
      }
      return [...prev, createOrderLine(product, config.price_level, crypto.randomUUID())];
    });
  }

  function removeLine(id: string) {
    setCheckoutId(crypto.randomUUID());
    setCart(prev => prev.filter(l => l.id !== id));
  }

  function changeQty(id: string, delta: number) {
    setCheckoutId(crypto.randomUUID());
    setCart(prev => prev.map(l => {
      if (l.id === id) {
        const newQty = Math.max(1, l.qty + delta);
        return calculateLine(l, newQty);
      }
      return l;
    }));
  }

  async function completePayment(method: string) {
    const cashTender = parseValidCashTender(paymentAmount, total);
    if (checkoutPending || method !== "cash" || cashTender === null) {
      toast({ variant: "destructive", title: "Enter enough cash to cover the total" });
      return;
    }
    if (!navigator.onLine) {
      toast({ variant: "destructive", title: "Online checkout required", description: "Reconnect before completing a sale. Reserved stock cannot be checked offline." });
      return;
    }
    if (!config.voucher_device_key) {
      toast({ variant: "destructive", title: "Pair this Terminal first", description: "An administrator must generate its device key. Save the key in Terminal Settings before selling stock." });
      return;
    }
    if (!/^\d{4,8}$/.test(checkoutPin)) {
      toast({ variant: "destructive", title: "Enter your cashier PIN" });
      return;
    }
    setCheckoutPending(true);
    try {
      const response = await fetch(`${config.server_url}/api/pos/sync/cash-sale`, {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Terminal-Code": config.terminal_code,
          "X-Voucher-Device-Key": config.voucher_device_key },
        body: JSON.stringify({
          orderId: checkoutId,
          lines: cart.map(line => ({ itemId: line.product_id, quantity: line.qty })),
          cashierId: session.cashier_id, pin: checkoutPin,
          expectedTotalCents: Math.round(total * 100), cashTenderCents: Math.round(cashTender * 100),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || `Checkout failed (${response.status})`);
      if (!data || typeof data.orderNumber !== "string") throw new Error("Checkout was accepted but the receipt was incomplete. Retry the same sale.");
      void writeAudit("sale", "order", data.orderNumber, `Online cash sale for ${formatMoney(total)}`, session.cashier_id, session.cashier_name)
        .catch((error) => console.error("Failed to queue sale audit record", error));
      toast({
        title: "Payment successful",
        description: `Order ${data.orderNumber} completed online.`,
      });
      setCart([]);
      setPaying(false);
      setPaymentAmount("");
      setCheckoutPin("");
      setCheckoutUncertain(false);
      setCheckoutId(crypto.randomUUID());
    } catch (e: any) {
      if (e instanceof TypeError || /receipt was incomplete/.test(e?.message ?? "")) setCheckoutUncertain(true);
      toast({
        variant: "destructive",
        title: "Sale not confirmed",
        description: `${e.message || "Connection failed."} Keep this sale open and retry with the same details; do not collect payment twice.`,
      });
    } finally {
      setCheckoutPending(false);
    }
  }

  const cashTender = parseValidCashTender(paymentAmount, total);

  if (paying) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="h-16 bg-card border-b border-border flex items-center px-6">
          <button onClick={() => setPaying(false)} disabled={checkoutPending || checkoutUncertain}
            title={checkoutUncertain ? "Retry this sale before leaving; its server status is unknown" : "Back to cart"}
            className="mr-4 p-2 bg-input rounded-full text-foreground hover:bg-input/80 disabled:opacity-40">
            <X className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-bold">Payment</h1>
        </header>
        
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="text-center mb-8">
            <p className="text-muted-foreground text-lg mb-2">Total Due</p>
            <p className="text-6xl font-bold text-foreground tracking-tight">{formatMoney(total)}</p>
          </div>
          
          <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-xl mb-8">
            <label className="block text-sm font-medium text-muted-foreground mb-2">Amount Tendered</label>
            <div className="flex items-center gap-3">
              <input 
                type="number" 
                min="0"
                step="0.01"
                value={paymentAmount}
                onChange={e => { if (!checkoutUncertain) setPaymentAmount(e.target.value); }}
                readOnly={checkoutUncertain}
                placeholder={total.toString()}
                className="flex-1 bg-input text-foreground text-2xl p-4 rounded-xl outline-none focus:ring-2 focus:ring-primary"
              />
              <button 
                onClick={() => { if (!checkoutUncertain) setPaymentAmount(total.toString()); }}
                disabled={checkoutUncertain}
                className="bg-secondary text-secondary-foreground px-4 py-4 rounded-xl font-semibold"
              >
                Exact
              </button>
            </div>
            
            {parseFloat(paymentAmount) >= total && (
              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <p className="text-sm text-green-500 font-medium">Change Due</p>
                <p className="text-2xl text-green-400 font-bold">{formatMoney(parseFloat(paymentAmount) - total)}</p>
              </div>
            )}
            <label className="mt-4 block text-sm">Cashier PIN for online stock check
              <input type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={8}
                value={checkoutPin} onChange={event => setCheckoutPin(event.target.value)}
                className="mt-1 w-full rounded-lg bg-input p-3" />
            </label>
            {checkoutUncertain && <p role="alert" className="mt-3 rounded-lg bg-amber-500/15 p-3 text-sm text-amber-300">
              The server may have completed this sale. Retry with the same order ID; the server will return the original receipt rather than charge twice.
            </p>}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-md">
            <button 
              onClick={() => completePayment("cash")}
              disabled={cashTender === null || checkoutPending || !/^\d{4,8}$/.test(checkoutPin)}
              className="py-5 bg-primary text-primary-foreground text-lg font-bold rounded-xl active:scale-95 transition-transform disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkoutPending ? "Checking stock…" : checkoutUncertain ? "Retry same sale" : "Cash · online"}
            </button>
            <button 
              disabled
              title="Card terminal integration unavailable in browser version"
              className="py-5 bg-secondary text-secondary-foreground text-lg font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50 cursor-not-allowed flex flex-col items-center justify-center gap-1"
            >
              <span>Card</span>
              <span className="text-xs font-normal opacity-70">(Unavailable in browser)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {stockDialogMode && <MultiLocationSearch config={config} session={session} initialMode={stockDialogMode}
        onClose={() => setStockDialogMode(null)} />}
      {voucherMode && <VoucherDialog mode={voucherMode} config={config} session={session} cart={cart} total={total}
        onClose={() => setVoucherMode(null)}
        onRedeemed={orderNumber => {
          setCart([]);
          void writeAudit("voucher_redemption", "order", orderNumber, "Online voucher sale completed", session.cashier_id, session.cashier_name)
            .catch(error => console.error("Failed to queue voucher audit record", error));
          toast({ title: "Voucher payment completed", description: `Order ${orderNumber} recorded online.` });
        }} />}
      {/* Top Header */}
      <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0">
        <SyncIndicator />
        <div className="flex items-center gap-3">
          <BrandLogo compact />
          <div className="ml-2">
            <h1 className="text-sm font-bold text-foreground leading-none">{config.terminal_name}</h1>
            <p className="text-xs text-muted-foreground">{session.cashier_name}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Link href="/settings" className="p-2 text-muted-foreground hover:bg-input rounded-full transition-colors">
            <Settings className="w-5 h-5" />
          </Link>
          <button onClick={onLogout} className="p-2 text-destructive hover:bg-destructive/10 rounded-full transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Ticket */}
        <div className="w-96 flex flex-col bg-card border-r border-border shrink-0">
          {externalPanel && (
            <div className="flex flex-col min-h-0 flex-1 border-b" data-testid="terminal-external-journal">
              <div className="flex items-center gap-2 px-3 py-2 border-b text-sm">
                <Globe className="h-4 w-4" /><strong className="truncate flex-1">{externalPanel.label}</strong>
                <button aria-label="Close external panel" onClick={() => setExternalPanel(null)}><X className="h-4 w-4" /></button>
              </div>
              {externalPanel.launch.type === "app" ? (
                <div className="space-y-3 p-4 text-sm">
                  <p>The app opens outside the journal if this POS device has a handler registered for its link.</p>
                  <a href={externalPanel.launch.target} className="inline-flex gap-2 rounded bg-primary px-3 py-2 text-primary-foreground">
                    <ExternalLink className="h-4 w-4" />Launch app
                  </a>
                </div>
              ) : (
                <>
                  <iframe key={externalPanel.launch.target} title={externalPanel.label} src={externalPanel.launch.target}
                    sandbox={new URL(externalPanel.launch.target).origin === window.location.origin
                      ? "allow-forms allow-scripts allow-popups"
                      : "allow-forms allow-scripts allow-same-origin allow-popups"}
                    referrerPolicy="no-referrer" className="min-h-[200px] flex-1 w-full bg-white" />
                  <a href={externalPanel.launch.target} target="_blank" rel="noopener noreferrer"
                    className="px-3 py-2 text-xs underline">Open in new tab if this site blocks embedding</a>
                </>
              )}
            </div>
          )}
          <div className={`${externalPanel ? "max-h-40" : "flex-1"} min-h-0 overflow-y-auto p-2`}>
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <p>No items in cart</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {cart.map(line => (
                  <div key={line.id} className="bg-background border border-border p-3 rounded-lg flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-foreground text-sm line-clamp-2 pr-2">{line.description}</span>
                      <span className="font-bold text-foreground">{formatMoney(line.line_total)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 bg-input rounded-lg overflow-hidden">
                        <button onClick={() => changeQty(line.id, -1)} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">-</button>
                        <span className="w-6 text-center text-sm font-medium">{line.qty}</span>
                        <button onClick={() => changeQty(line.id, 1)} className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground">+</button>
                      </div>
                      <button onClick={() => removeLine(line.id)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="p-4 bg-background border-t border-border space-y-3">
            <div className="flex justify-between text-muted-foreground text-sm">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between text-foreground text-2xl font-bold pb-2">
              <span>Total</span>
              <span>{formatMoney(total)}</span>
            </div>
            
            <button 
              onClick={() => setPaying(true)}
              disabled={cart.length === 0}
              className="w-full py-4 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              Pay {formatMoney(total)} <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Right Panel: Catalog */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-card">
            <span className="text-xs font-medium text-muted-foreground">Layout tools</span>
            {externalButtons.map(button => (
              <button key={`${button.position}-${button.actionCode}`} type="button"
                onClick={() => void openExternal(button)} disabled={launchingCode !== null}
                className="rounded border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
                data-testid={`terminal-external-${button.actionCode}`}>{button.label}</button>
            ))}
            {voucherButtons.map(button => (
              <button key={`${button.position}-${button.actionCode}`} type="button"
                onClick={() => void openVoucher(button)} disabled={launchingCode !== null}
                className="rounded border border-emerald-400 bg-emerald-950/40 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-900/50"
                data-testid={`terminal-voucher-${button.actionCode}`}>{button.label}</button>
            ))}
            {itemSearchAssigned && <button type="button" onClick={() => setStockDialogMode("lookup")}
              className="rounded border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
              data-testid="terminal-item-search">Search Items · all shops</button>}
            {stockInAssigned && <button type="button" onClick={() => setStockDialogMode("stockIn")}
              className="rounded border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
              data-testid="terminal-stock-in">Stock In</button>}
            {(itemSearchAssigned || stockInAssigned) && <button type="button" onClick={() => setStockDialogMode("transfer")}
              className="rounded border border-border px-3 py-2 text-xs font-medium hover:bg-accent"
              data-testid="terminal-stock-transfer">Stock Transfer</button>}
            {!externalButtons.length && !voucherButtons.length && !itemSearchAssigned && !stockInAssigned && <span className="text-xs text-muted-foreground">
              {layoutError ? "Layout tools unavailable" : "No approved tools assigned"}
            </span>}
            <button type="button" className="ml-auto p-1" aria-label="Refresh layout tools" title={layoutError || "Refresh layout tools"}
              onClick={() => setLayoutRefresh(value => value + 1)}><RefreshCw className="h-4 w-4" /></button>
          </div>
          <div className="p-3 border-b border-border bg-card flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input 
                type="text" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search products..."
                className="w-full bg-input text-foreground text-sm rounded-lg pl-9 pr-4 py-2 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <button type="button" onClick={() => setStockDialogMode("lookup")}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-input"
              data-testid="terminal-other-shops">Other shops &amp; reserve</button>
          </div>
          
          {!search && (
            <div className="px-3 pt-3 flex gap-2 overflow-x-auto scrollbar-thin shrink-0">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    activeCategory === cat.id 
                      ? "bg-primary text-primary-foreground" 
                      : "bg-card text-foreground border border-border hover:bg-accent"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {displayedProducts.map(p => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="bg-card border border-border hover:border-primary/50 hover:bg-accent/50 rounded-xl p-3 flex flex-col text-left aspect-square transition-colors active:scale-95"
                >
                  <div className="flex-1">
                    <span className="text-sm font-medium text-foreground line-clamp-3">{p.name}</span>
                    {p.sku && <span className="text-xs text-muted-foreground block mt-1">{p.sku}</span>}
                  </div>
                  <div className="text-primary font-bold mt-2">
                    {formatMoney(effectivePrice(p, config.price_level))}
                  </div>
                </button>
              ))}
              {displayedProducts.length === 0 && (
                <div className="col-span-full py-12 text-center text-muted-foreground flex flex-col items-center">
                  <AlertCircle className="w-8 h-8 mb-2 opacity-50" />
                  <p>No products found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
