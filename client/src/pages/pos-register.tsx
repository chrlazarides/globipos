import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Item, PosLocation, PosTerminal } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  ShoppingCart, CreditCard, Banknote, Trash2, Plus, Minus,
  CheckCircle2, AlertCircle, Loader2, Search, X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";

interface CartLine {
  itemId: string;
  description: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  vatRate: number;
}

interface CardChargeResult {
  success: boolean;
  transactionRef?: string;
  provider?: string;
  message: string;
}

interface CardTerminalStatus {
  activeProvider: string | null;
  jccConfigured: boolean;
  vivaConfigured: boolean;
  worldpayConfigured: boolean;
}

function fmt(n: number) {
  return n.toFixed(2);
}

function CartRow({ line, onQtyChange, onRemove }: {
  line: CartLine;
  onQtyChange: (delta: number) => void;
  onRemove: () => void;
}) {
  const lineTotal = line.unitPrice * line.quantity;
  return (
    <div className="flex items-center gap-2 py-2 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{line.description}</p>
        <p className="text-xs text-muted-foreground">€{fmt(line.unitPrice)} ea · VAT {line.vatRate}%</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onQtyChange(-1)} data-testid={`btn-qty-minus-${line.itemId}`}>
          <Minus className="w-3 h-3" />
        </Button>
        <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onQtyChange(1)} data-testid={`btn-qty-plus-${line.itemId}`}>
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <p className="w-16 text-right text-sm font-semibold shrink-0">€{fmt(lineTotal)}</p>
      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={onRemove} data-testid={`btn-remove-${line.itemId}`}>
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

/**
 * Card payment dialog.
 *
 * State machine:
 *  idle → waiting (charge in flight) → approved | declined
 *
 * The order has already been created as "held" before this dialog opens.
 * On approval  → backend marks it completed; onSuccess() fires.
 * On decline   → onCancel(void=true) fires so the caller can void the held order.
 * On user-cancel before charging → onCancel(void=true) voids the held order.
 */
function CardPaymentDialog({
  open,
  total,
  orderId,
  onSuccess,
  onCancel,
}: {
  open: boolean;
  total: number;
  orderId: string;
  onSuccess: (ref: string, provider: string) => void;
  onCancel: (voidOrder: boolean) => void;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<"idle" | "waiting" | "approved" | "declined">("idle");
  const [result, setResult] = useState<CardChargeResult | null>(null);

  const chargeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/pos/card-terminal/charge", {
        amount: total,
        orderId,
        currency: "EUR",
      }).then(r => r.json() as Promise<CardChargeResult>),
    onMutate: () => setPhase("waiting"),
    onSuccess: (data) => {
      setResult(data);
      if (data.success) {
        setPhase("approved");
        onSuccess(data.transactionRef!, data.provider!);
      } else {
        setPhase("declined");
        toast({ variant: "destructive", title: "Payment declined", description: data.message });
      }
    },
    onError: (e: any) => {
      setPhase("declined");
      setResult({ success: false, message: e.message });
      toast({ variant: "destructive", title: "Terminal error", description: e.message });
    },
  });

  const reset = () => {
    setPhase("idle");
    setResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={o => {
      if (!o && phase !== "waiting") {
        reset();
        onCancel(phase !== "approved");
      }
    }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Card Payment
          </DialogTitle>
          <DialogDescription>
            Amount due: <span className="font-bold text-foreground">€{fmt(total)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {phase === "idle" && (
            <>
              <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-6">
                <CreditCard className="w-10 h-10 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-medium">Ready to charge terminal</p>
                <p className="text-sm text-muted-foreground">The customer should present their card when prompted on the terminal.</p>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={() => chargeMutation.mutate()}
                data-testid="btn-initiate-card-charge"
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Charge €{fmt(total)}
              </Button>
              <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => { reset(); onCancel(true); }} data-testid="btn-card-cancel-before">
                Cancel
              </Button>
            </>
          )}

          {phase === "waiting" && (
            <>
              <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-6 animate-pulse">
                <CreditCard className="w-10 h-10 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold">Waiting for terminal…</p>
                <p className="text-sm text-muted-foreground">Ask the customer to tap, insert, or swipe their card. Do not close this window.</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Polling terminal (up to 60s)
              </div>
            </>
          )}

          {phase === "approved" && (
            <>
              <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-6">
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold text-green-700 dark:text-green-400">Payment Approved!</p>
                <p className="text-sm text-muted-foreground">Provider: <span className="uppercase font-medium">{result?.provider}</span></p>
                <p className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded mt-1">
                  Ref: {result?.transactionRef}
                </p>
              </div>
              <Button className="w-full" onClick={() => { reset(); onCancel(false); }} data-testid="btn-card-done">
                Done — Start New Sale
              </Button>
            </>
          )}

          {phase === "declined" && (
            <>
              <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-6">
                <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold text-red-700 dark:text-red-400">Payment Failed</p>
                <p className="text-sm text-muted-foreground">{result?.message}</p>
              </div>
              <div className="flex gap-2 w-full">
                <Button variant="outline" className="flex-1" onClick={reset} data-testid="btn-card-retry">
                  Retry
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => { reset(); onCancel(true); }} data-testid="btn-card-cancel-after-decline">
                  Cancel Sale
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PosRegister() {
  const { toast } = useToast();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState<string>("");
  const [terminalId, setTerminalId] = useState<string>("");
  const [cashierName] = useState("Cashier");
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [heldOrderId, setHeldOrderId] = useState<string | undefined>();
  const [heldOrderTotal, setHeldOrderTotal] = useState(0);
  const [lastApproval, setLastApproval] = useState<{ ref: string; provider: string } | null>(null);

  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"], staleTime: 60000 });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"], staleTime: 60000 });
  const { data: terminals = [] } = useQuery<PosTerminal[]>({ queryKey: ["/api/pos/terminals"], staleTime: 60000 });
  const { data: terminalStatus } = useQuery<CardTerminalStatus>({
    queryKey: ["/api/pos/card-terminal/status"],
    staleTime: 30000,
  });

  const filteredTerminals = locationId ? terminals.filter(t => t.locationId === locationId) : terminals;
  const cardConfigured = !!(terminalStatus?.activeProvider);

  const filteredItems = items.filter(i =>
    !search ||
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.sku || "").toLowerCase().includes(search.toLowerCase()) ||
    (i.barcode || "").includes(search)
  ).slice(0, 40);

  const addToCart = useCallback((item: Item) => {
    setCart(prev => {
      const existing = prev.find(l => l.itemId === item.id);
      if (existing) {
        return prev.map(l => l.itemId === item.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        itemId: item.id,
        description: item.name,
        sku: item.sku || "",
        unitPrice: parseFloat(item.price1 || "0"),
        quantity: 1,
        vatRate: parseFloat((item as any).vatRate || "0"),
      }];
    });
  }, []);

  const changeQty = (itemId: string, delta: number) => {
    setCart(prev =>
      prev.map(l => l.itemId === itemId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => prev.filter(l => l.itemId !== itemId));
  };

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const vatAmount = cart.reduce((s, l) => s + l.unitPrice * l.quantity * (l.vatRate / 100), 0);
  const total = subtotal + vatAmount;

  const voidOrderMutation = useMutation({
    mutationFn: (orderId: string) =>
      apiRequest("PATCH", `/api/pos/orders/${orderId}/void`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders"] });
    },
  });

  // Creates a cash order (completed immediately) or a card order (held, awaiting terminal)
  const createOrderMutation = useMutation({
    mutationFn: async (paymentMethod: "cash" | "card") => {
      if (!locationId || !terminalId) throw new Error("Select a location and terminal first.");
      const res = await apiRequest("POST", "/api/pos/orders", {
        orderNumber: `WEB-${Date.now()}`,
        terminalId,
        locationId,
        cashierName,
        paymentMethod,
        subtotal: fmt(subtotal),
        vatAmount: fmt(vatAmount),
        discountAmount: "0",
        total: fmt(total),
        // Card orders start as held/unpaid — the terminal charge endpoint marks them completed
        amountTendered: paymentMethod === "cash" ? fmt(total) : "0",
        changeDue: "0",
        status: paymentMethod === "cash" ? "completed" : "held",
        receiptPrinted: false,
        lines: cart.map(l => ({
          itemId: l.itemId,
          description: l.description,
          sku: l.sku,
          quantity: String(l.quantity),
          unitPrice: fmt(l.unitPrice),
          vatRate: fmt(l.vatRate),
          discountPercent: "0",
          total: fmt(l.unitPrice * l.quantity),
        })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create order");
      return data;
    },
    onSuccess: (order, paymentMethod) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders"] });
      if (paymentMethod === "cash") {
        toast({ title: "Order completed", description: `Cash sale: €${fmt(total)}` });
        setCart([]);
        setLastApproval(null);
      } else {
        // Open card dialog with the held order ready for terminal charge
        setHeldOrderId(order.id);
        setHeldOrderTotal(total);
        setCardDialogOpen(true);
      }
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Order error", description: e.message }),
  });

  const handleCashPay = () => {
    if (cart.length === 0) return toast({ variant: "destructive", title: "Cart is empty" });
    createOrderMutation.mutate("cash");
  };

  const handleCardPay = () => {
    if (cart.length === 0) return toast({ variant: "destructive", title: "Cart is empty" });
    if (!cardConfigured) {
      return toast({ variant: "destructive", title: "No terminal configured", description: "Go to POS → Card Terminal to set up a payment provider." });
    }
    createOrderMutation.mutate("card");
  };

  const handleCardDialogClose = (voidOrder: boolean) => {
    if (voidOrder && heldOrderId) {
      voidOrderMutation.mutate(heldOrderId);
    }
    setCardDialogOpen(false);
    setHeldOrderId(undefined);
    setHeldOrderTotal(0);
  };

  const handleCardApproved = (ref: string, provider: string) => {
    setLastApproval({ ref, provider });
    setCart([]);
    queryClient.invalidateQueries({ queryKey: ["/api/pos/orders"] });
    toast({ title: "Card payment approved", description: `Ref: ${ref} (${provider.toUpperCase()})` });
  };

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <PageHeader
        title="POS Register"
        subtitle="Quick sale — select items, then pay by cash or card"
        icon={<ShoppingCart className="w-5 h-5" />}
      />

      {/* Context selectors */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <Select value={locationId} onValueChange={v => { setLocationId(v); setTerminalId(""); }} data-testid="select-location">
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select location…" />
            </SelectTrigger>
            <SelectContent>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <Select value={terminalId} onValueChange={setTerminalId} disabled={!locationId} data-testid="select-terminal">
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select terminal…" />
            </SelectTrigger>
            <SelectContent>
              {filteredTerminals.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="shrink-0">
          {cardConfigured
            ? <Badge variant="default" className="h-9 px-3 flex items-center gap-1.5 rounded-md text-xs">
                <CreditCard className="w-3.5 h-3.5" />
                {terminalStatus?.activeProvider?.toUpperCase()} ready
              </Badge>
            : <Badge variant="secondary" className="h-9 px-3 flex items-center gap-1.5 rounded-md text-xs">
                <CreditCard className="w-3.5 h-3.5" />
                No terminal configured
              </Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Item catalogue */}
        <div className="lg:col-span-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search items by name, SKU, or barcode…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9"
              data-testid="input-item-search"
            />
            {search && (
              <button className="absolute right-3 top-2.5" onClick={() => setSearch("")} data-testid="btn-clear-search">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {filteredItems.map(item => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className="text-left rounded-lg border bg-card hover:bg-accent hover:border-primary transition-colors p-3 space-y-1 cursor-pointer"
                data-testid={`btn-item-${item.id}`}
              >
                <p className="text-sm font-medium leading-tight line-clamp-2">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.sku}</p>
                <p className="text-sm font-bold text-primary">€{parseFloat(item.price1 || "0").toFixed(2)}</p>
              </button>
            ))}
            {filteredItems.length === 0 && (
              <div className="col-span-full text-center py-8 text-muted-foreground text-sm">
                No items found
              </div>
            )}
          </div>
        </div>

        {/* Cart & payment */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                Order ({cart.length} line{cart.length !== 1 ? "s" : ""})
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Tap items to add them</p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {cart.map(line => (
                    <CartRow
                      key={line.itemId}
                      line={line}
                      onQtyChange={d => changeQty(line.itemId, d)}
                      onRemove={() => removeFromCart(line.itemId)}
                    />
                  ))}
                </div>
              )}

              <Separator />

              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>€{fmt(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>VAT</span>
                  <span>€{fmt(vatAmount)}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t pt-1">
                  <span>Total</span>
                  <span>€{fmt(total)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button
                  variant="outline"
                  className="h-12 flex flex-col gap-0.5"
                  onClick={handleCashPay}
                  disabled={cart.length === 0 || createOrderMutation.isPending || !locationId || !terminalId}
                  data-testid="btn-pay-cash"
                >
                  <Banknote className="w-4 h-4" />
                  <span className="text-xs">Cash</span>
                </Button>
                <Button
                  className="h-12 flex flex-col gap-0.5"
                  onClick={handleCardPay}
                  disabled={cart.length === 0 || createOrderMutation.isPending || !locationId || !terminalId || !cardConfigured}
                  data-testid="btn-pay-card"
                >
                  {createOrderMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CreditCard className="w-4 h-4" />
                  )}
                  <span className="text-xs">Card</span>
                </Button>
              </div>

              {(!locationId || !terminalId) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                  Select a location and terminal above to enable payment
                </p>
              )}

              {!cardConfigured && (
                <p className="text-xs text-muted-foreground text-center">
                  Card payments disabled — configure a terminal provider in POS → Card Terminal
                </p>
              )}

              {lastApproval && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-2 text-xs text-center space-y-0.5">
                  <p className="font-medium text-green-700 dark:text-green-400">Last: Card approved ✓</p>
                  <p className="font-mono text-muted-foreground">{lastApproval.ref} ({lastApproval.provider.toUpperCase()})</p>
                </div>
              )}

              {cart.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive text-xs"
                  onClick={() => setCart([])}
                  data-testid="btn-clear-cart"
                >
                  Clear cart
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {cardDialogOpen && heldOrderId && (
        <CardPaymentDialog
          open={cardDialogOpen}
          total={heldOrderTotal}
          orderId={heldOrderId}
          onSuccess={(ref, provider) => {
            handleCardApproved(ref, provider);
          }}
          onCancel={(voidOrder) => {
            handleCardDialogClose(voidOrder);
          }}
        />
      )}
    </div>
  );
}
