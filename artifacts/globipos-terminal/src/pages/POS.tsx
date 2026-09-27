import { useState, useEffect } from "react";
import { LogOut, Settings, Trash2, Search, ArrowRight, X, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import type { TerminalConfig, CashierSession, Category, Product, OrderLine, Order } from "../types";
import { getCategories, getProducts, saveOrder, writeAudit } from "../lib/db";
import { useToast } from "@/hooks/use-toast";
import { BrandLogo } from "@/components/BrandLogo";
import { calculateLine, createOrderLine, parseValidCashTender } from "@/lib/pos-calculations";
import { createOrderNumber, effectivePrice } from "@/lib/pos-calculations";
import { flushOutbox } from "@/lib/sync";
import { isQuotaError } from "@/lib/storage";

interface POSProps {
  config: TerminalConfig;
  session: CashierSession;
  onLogout: () => void;
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-CY", { style: "currency", currency: "EUR" }).format(amount);
}

export function POS({ config, session, onLogout }: POSProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  
  const [cart, setCart] = useState<OrderLine[]>([]);
  const [search, setSearch] = useState("");
  
  const [paying, setPaying] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  
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
    load();
  }, []);

  const displayedProducts = products.filter(p => {
    if (!p.active) return false;
    if (search) return p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search));
    return p.category_id === activeCategory;
  });

  const subtotal = cart.reduce((sum, line) => sum + line.line_total, 0);
  const total = subtotal; // Assuming VAT included in line_total for simplicity here

  function addToCart(product: Product) {
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
    setCart(prev => prev.filter(l => l.id !== id));
  }

  function changeQty(id: string, delta: number) {
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
    if (method === "cash" && cashTender === null) {
      toast({ variant: "destructive", title: "Enter enough cash to cover the total" });
      return;
    }
    const order: Order = {
      id: crypto.randomUUID(),
      order_number: createOrderNumber(config.terminal_code, Date.now(), crypto.randomUUID()),
      status: "completed",
      cashier_id: session.cashier_id,
      cashier_name: session.cashier_name,
      price_level: config.price_level,
      order_discount_pct: 0,
      order_discount_fixed: 0,
      surcharge_pct: 0,
      surcharge_amount: 0,
      subtotal,
      discount_amount: 0,
      vat_amount: cart.reduce((sum, line) => sum + line.vat_amount, 0),
      total,
      payment_method: method,
      amount_tendered: cashTender ?? total,
      change_due: Math.max(0, (cashTender ?? total) - total),
      created_at: new Date().toISOString(),
    };
    
    // Associate lines
    const finalLines = cart.map(l => ({ ...l, order_id: order.id }));
    
    try {
      setStorageWarning(null);
      await saveOrder(order, finalLines);
      void writeAudit("sale", "order", order.id, `Sale for ${formatMoney(total)}`, session.cashier_id, session.cashier_name)
        .catch((error) => console.error("Failed to queue sale audit record", error));
      if (navigator.onLine) void flushOutbox();
      
      toast({
        title: "Payment successful",
        description: `Order ${order.order_number} saved to outbox.`,
      });
      setCart([]);
      setPaying(false);
      setPaymentAmount("");
    } catch (e: any) {
      if (isQuotaError(e)) setStorageWarning(e.message);
      toast({
        variant: "destructive",
        title: "Error saving order",
        description: e.message,
      });
    }
  }

  const cashTender = parseValidCashTender(paymentAmount, total);

  if (paying) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <header className="h-16 bg-card border-b border-border flex items-center px-6">
          <button onClick={() => setPaying(false)} className="mr-4 p-2 bg-input rounded-full text-foreground hover:bg-input/80">
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
                onChange={e => setPaymentAmount(e.target.value)}
                placeholder={total.toString()}
                className="flex-1 bg-input text-foreground text-2xl p-4 rounded-xl outline-none focus:ring-2 focus:ring-primary"
              />
              <button 
                onClick={() => setPaymentAmount(total.toString())}
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
          </div>
          {storageWarning && (
            <p role="alert" data-testid="warning-order-storage-full" className="w-full max-w-md mb-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-sm text-destructive">
              <AlertCircle className="inline w-4 h-4 mr-2" />{storageWarning}
            </p>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-md">
            <button 
              onClick={() => completePayment("cash")}
              disabled={cashTender === null}
              className="py-5 bg-primary text-primary-foreground text-lg font-bold rounded-xl active:scale-95 transition-transform disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cash
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
      {/* Top Header */}
      <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0">
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
          <div className="flex-1 overflow-y-auto p-2">
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
