import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCcw, Eye, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { PosReturnOrder } from "@shared/schema";

type ReturnWithLines = PosReturnOrder & { lines?: any[] };

function methodBadge(method: string) {
  const map: Record<string, string> = {
    cash: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    card: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    store_credit: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    exchange: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  };
  const label = { cash: "Cash", card: "Card", store_credit: "Store Credit", exchange: "Exchange" }[method] ?? method;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[method] ?? "bg-muted"}`}>{label}</span>;
}

function statusBadge(status: string) {
  if (status === "voided") return <Badge variant="destructive">Voided</Badge>;
  if (status === "pending") return <Badge variant="secondary">Pending</Badge>;
  return <Badge variant="default">Completed</Badge>;
}

function ReturnDetailDialog({ ret, onClose }: { ret: ReturnWithLines; onClose: () => void }) {
  const { data, isLoading } = useQuery<ReturnWithLines>({
    queryKey: ["/api/pos/returns", ret.id],
  });
  const lines = data?.lines ?? ret.lines ?? [];

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Return {ret.originalOrderNumber ? `for Order ${ret.originalOrderNumber}` : ret.id.slice(0, 8)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Date</p>
              <p className="font-medium">{format(new Date(ret.createdAt), "dd MMM yyyy HH:mm")}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Status</p>
              {statusBadge(ret.status)}
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Cashier</p>
              <p className="font-medium">{ret.cashierName}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Refund Method</p>
              {methodBadge(ret.refundMethod)}
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Refund Total</p>
              <p className="font-bold text-lg">€{parseFloat(String(ret.refundTotal)).toFixed(2)}</p>
            </div>
            {ret.notes && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Notes</p>
                <p>{ret.notes}</p>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Returned Items</p>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No line items</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Item</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Qty</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Unit</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Total</th>
                      <th className="text-center px-3 py-2 font-medium text-muted-foreground">Restocked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((line: any, i: number) => (
                      <tr key={line.id ?? i}>
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="px-3 py-2 text-right">{line.qty}</td>
                        <td className="px-3 py-2 text-right">€{parseFloat(String(line.unitPrice)).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-medium">€{parseFloat(String(line.lineTotal)).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          {line.restocked ? <Badge variant="default" className="text-xs">Yes</Badge> : <Badge variant="secondary" className="text-xs">No</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PosReturns() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReturnWithLines | null>(null);

  const { data: returns = [], isLoading } = useQuery<PosReturnOrder[]>({ queryKey: ["/api/pos/returns"] });

  const filtered = returns.filter(r =>
    (r.originalOrderNumber ?? "").toLowerCase().includes(search.toLowerCase()) ||
    r.cashierName.toLowerCase().includes(search.toLowerCase()) ||
    r.refundMethod.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="POS Returns"
        subtitle="View all return orders processed at POS terminals"
        icon={<RotateCcw className="w-5 h-5" />}
      />

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by order number, cashier…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search-returns"
        />
        <div className="ml-auto text-sm text-muted-foreground">{filtered.length} return{filtered.length !== 1 ? "s" : ""}</div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <RotateCcw className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">{search ? "No returns match your search" : "No return orders yet"}</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Original Order</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cashier</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Refund</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-return-${r.id}`}>
                  <td className="px-4 py-3 font-medium font-mono text-xs">{r.originalOrderNumber || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{format(new Date(r.createdAt), "dd MMM yy HH:mm")}</td>
                  <td className="px-4 py-3">{r.cashierName}</td>
                  <td className="px-4 py-3">{methodBadge(r.refundMethod)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">€{parseFloat(String(r.refundTotal)).toFixed(2)}</td>
                  <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" onClick={() => setSelected(r)} data-testid={`button-view-return-${r.id}`}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ReturnDetailDialog ret={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
