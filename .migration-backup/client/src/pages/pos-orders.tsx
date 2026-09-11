import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PosOrder, PosOrderLine, PosLocation } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShoppingBag, Loader2, Search, Eye, Download } from "lucide-react";
import { format } from "date-fns";

type OrderWithMeta = PosOrder & { locationName?: string; terminalName?: string; lines?: PosOrderLine[] };

function paymentBadge(method: string) {
  const map: Record<string, string> = { cash: "bg-green-100 text-green-800", card: "bg-blue-100 text-blue-800", mixed: "bg-purple-100 text-purple-800" };
  return map[method] || "bg-gray-100 text-gray-800";
}

function statusBadge(status: string) {
  if (status === "voided") return <Badge variant="destructive">Voided</Badge>;
  if (status === "held") return <Badge variant="secondary">Held</Badge>;
  return <Badge variant="default">Completed</Badge>;
}

function OrderDetailDialog({ order, onClose }: { order: OrderWithMeta; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery<OrderWithMeta>({
    queryKey: ["/api/pos/orders", order.id],
  });
  const lines = detail?.lines ?? order.lines ?? [];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            Order {order.orderNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Date</p>
              <p className="font-medium">{format(new Date(order.createdAt), "dd MMM yyyy HH:mm")}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Status</p>
              {statusBadge(order.status)}
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Location / Terminal</p>
              <p className="font-medium">{order.locationName || order.locationId}</p>
              {order.terminalName && <p className="text-xs text-muted-foreground">{order.terminalName}</p>}
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Cashier</p>
              <p className="font-medium">{order.cashierName || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Payment</p>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${paymentBadge(order.paymentMethod)}`}>
                {order.paymentMethod}
              </span>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Customer</p>
              <p className="font-medium">{order.customerId ? (order as any).customerName || order.customerId : "Walk-in"}</p>
            </div>
            {order.paymentMethod === "card" && order.cardTerminalRef && (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Card Ref</p>
                <p className="font-medium font-mono text-sm" data-testid="text-card-terminal-ref">{order.cardTerminalRef}</p>
              </div>
            )}
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit Price</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>
                ) : lines.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground text-xs">No line items</td></tr>
                ) : lines.map((line, i) => (
                  <tr key={line.id ?? i} data-testid={`row-orderline-${line.id ?? i}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{line.description}</div>
                      {line.sku && <div className="text-xs text-muted-foreground">{line.sku}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">€{parseFloat(line.unitPrice).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold">€{parseFloat(line.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-6 text-sm border-t pt-3">
            {order.discountAmount && parseFloat(order.discountAmount) > 0 && (
              <div className="text-muted-foreground">Discount: −€{parseFloat(order.discountAmount).toFixed(2)}</div>
            )}
            {order.vatAmount && parseFloat(order.vatAmount) > 0 && (
              <div className="text-muted-foreground">VAT: €{parseFloat(order.vatAmount).toFixed(2)}</div>
            )}
            <div className="font-bold text-base">Total: €{parseFloat(order.total).toFixed(2)}</div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} data-testid="button-close-order-detail">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PosOrders() {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderWithMeta | null>(null);

  const { data: orders = [], isLoading } = useQuery<OrderWithMeta[]>({ queryKey: ["/api/pos/orders"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const filtered = orders.filter(o => {
    if (locationFilter !== "all" && o.locationId !== locationFilter) return false;
    if (methodFilter !== "all" && o.paymentMethod !== methodFilter) return false;
    if (dateFrom || dateTo) {
      const orderDate = new Date(o.createdAt);
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (orderDate < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (orderDate > to) return false;
      }
    }
    if (search) {
      const q = search.toLowerCase();
      const matchesOrder = o.orderNumber.toLowerCase().includes(q);
      const matchesCashier = (o.cashierName || "").toLowerCase().includes(q);
      const matchesCardRef = (o.cardTerminalRef || "").toLowerCase().includes(q);
      if (!matchesOrder && !matchesCashier && !matchesCardRef) return false;
    }
    if (amountMin || amountMax) {
      const total = parseFloat(o.total || "0");
      if (amountMin && total < parseFloat(amountMin)) return false;
      if (amountMax && total > parseFloat(amountMax)) return false;
    }
    return true;
  });

  const totalRevenue = filtered.filter(o => o.status === "completed").reduce((s, o) => s + parseFloat(o.total || "0"), 0);

  function escapeCsv(value: string) {
    if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  function handleExport() {
    const headers = ["Order #", "Date", "Location/Terminal", "Cashier", "Payment Method", "Total", "Status"];
    const rows = filtered.map(o => {
      const locationLabel = [o.locationName || o.locationId, o.terminalName].filter(Boolean).join(" / ");
      return [
        o.orderNumber,
        format(new Date(o.createdAt), "dd MMM yyyy HH:mm"),
        locationLabel,
        o.cashierName || "—",
        o.paymentMethod,
        parseFloat(o.total).toFixed(2),
        o.status,
      ];
    });
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => escapeCsv(String(cell))).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");
    link.href = url;
    link.download = `pos-orders_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="w-6 h-6" />POS Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Completed bills from all GlobiPOS terminals</p>
        </div>
        <div className="flex items-center gap-4">
          {filtered.length > 0 && (
            <div className="text-right">
              <p className="text-2xl font-bold">€{totalRevenue.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">{filtered.filter(o => o.status === "completed").length} completed orders</p>
            </div>
          )}
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={filtered.length === 0}
            data-testid="button-export-orders"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order #, cashier or card ref…" className="pl-9" data-testid="input-order-search" />
        </div>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All methods" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="card">Card</SelectItem>
            <SelectItem value="mixed">Mixed</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-40"
            aria-label="From date"
            data-testid="input-date-from"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-40"
            aria-label="To date"
            data-testid="input-date-to"
          />
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              data-testid="button-clear-date-filter"
            >
              Clear
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amountMin}
            onChange={e => setAmountMin(e.target.value)}
            placeholder="Min €"
            className="w-28"
            aria-label="Minimum amount"
            data-testid="input-amount-min"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amountMax}
            onChange={e => setAmountMax(e.target.value)}
            placeholder="Max €"
            className="w-28"
            aria-label="Maximum amount"
            data-testid="input-amount-max"
          />
          {(amountMin || amountMax) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setAmountMin(""); setAmountMax(""); }}
              data-testid="button-clear-amount-filter"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No orders found</p>
            <p className="text-sm mt-1">POS orders will appear here once terminals sync their bills.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Order #</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Location / Terminal</th>
                <th className="px-4 py-3 text-left">Cashier</th>
                <th className="px-4 py-3 text-left">Payment</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(o => (
                <tr key={o.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-order-${o.id}`}>
                  <td className="px-4 py-3 font-mono font-medium">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {format(new Date(o.createdAt), "dd MMM yyyy HH:mm")}
                  </td>
                  <td className="px-4 py-3">
                    <div>{o.locationName || o.locationId}</div>
                    {o.terminalName && <div className="text-xs text-muted-foreground">{o.terminalName}</div>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{o.cashierName || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${paymentBadge(o.paymentMethod)}`}>
                      {o.paymentMethod}
                    </span>
                    {o.paymentMethod === "card" && o.cardTerminalRef && (
                      <div className="text-[10px] font-mono text-muted-foreground mt-1" data-testid={`text-card-ref-${o.id}`}>
                        {o.cardTerminalRef}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">€{parseFloat(o.total).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">{statusBadge(o.status)}</td>
                  <td className="px-4 py-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedOrder(o)}
                      data-testid={`button-view-order-${o.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <OrderDetailDialog order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  );
}
