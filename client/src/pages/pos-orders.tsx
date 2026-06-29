import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PosOrder, PosLocation } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag, Loader2, Search } from "lucide-react";
import { format } from "date-fns";

function paymentBadge(method: string) {
  const map: Record<string, string> = { cash: "bg-green-100 text-green-800", card: "bg-blue-100 text-blue-800", mixed: "bg-purple-100 text-purple-800" };
  return map[method] || "bg-gray-100 text-gray-800";
}

function statusBadge(status: string) {
  if (status === "voided") return <Badge variant="destructive">Voided</Badge>;
  if (status === "held") return <Badge variant="secondary">Held</Badge>;
  return <Badge variant="default">Completed</Badge>;
}

export default function PosOrders() {
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");

  const { data: orders = [], isLoading } = useQuery<(PosOrder & { locationName?: string; terminalName?: string })[]>({ queryKey: ["/api/pos/orders"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const filtered = orders.filter(o => {
    if (locationFilter && o.locationId !== locationFilter) return false;
    if (methodFilter && o.paymentMethod !== methodFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!o.orderNumber.toLowerCase().includes(q) && !(o.cashierName || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalRevenue = filtered.filter(o => o.status === "completed").reduce((s, o) => s + parseFloat(o.total || "0"), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="w-6 h-6" />POS Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Completed bills from all GlobiPOS terminals</p>
        </div>
        {filtered.length > 0 && (
          <div className="text-right">
            <p className="text-2xl font-bold">€{totalRevenue.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{filtered.filter(o => o.status === "completed").length} completed orders</p>
          </div>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search order # or cashier…" className="pl-9" data-testid="input-order-search" />
        </div>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All locations</SelectItem>
            {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={setMethodFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All methods" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">All methods</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="card">Card</SelectItem>
            <SelectItem value="mixed">Mixed</SelectItem>
          </SelectContent>
        </Select>
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
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">€{parseFloat(o.total).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">{statusBadge(o.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
