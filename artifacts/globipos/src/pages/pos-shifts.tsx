import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Eye, TrendingUp, Banknote, CreditCard, RotateCcw, Hash } from "lucide-react";
import { format, differenceInMinutes } from "date-fns";

interface PosShift {
  id: string;
  terminalId: string;
  locationId: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  openingFloat: string;
  closingCash: string | null;
  totalSales: string;
  totalCash: string;
  totalCard: string;
  totalVoids: string;
  transactionCount: number;
  status: "open" | "closed";
  notes: string | null;
}

function ShiftReportDialog({ shift, onClose }: { shift: PosShift; onClose: () => void }) {
  const isZReport = shift.status === "closed";
  const sales = parseFloat(shift.totalSales ?? "0");
  const cash = parseFloat(shift.totalCash ?? "0");
  const card = parseFloat(shift.totalCard ?? "0");
  const voids = parseFloat(shift.totalVoids ?? "0");
  const float = parseFloat(shift.openingFloat ?? "0");
  const closing = shift.closingCash ? parseFloat(shift.closingCash) : null;
  const duration = shift.closedAt
    ? differenceInMinutes(new Date(shift.closedAt), new Date(shift.openedAt))
    : differenceInMinutes(new Date(), new Date(shift.openedAt));

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            {isZReport ? "Z-Report (Closed Shift)" : "X-Report (Mid-Shift)"} — {shift.cashierName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/50">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Opened</p>
              <p className="font-medium">{format(new Date(shift.openedAt), "dd MMM yy HH:mm")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">{isZReport ? "Closed" : "Report Time"}</p>
              <p className="font-medium">
                {shift.closedAt ? format(new Date(shift.closedAt), "dd MMM yy HH:mm") : format(new Date(), "HH:mm")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Duration</p>
              <p className="font-medium">{Math.floor(duration / 60)}h {duration % 60}m</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Transactions</p>
              <p className="font-medium">{shift.transactionCount ?? 0}</p>
            </div>
          </div>

          {/* Sales summary */}
          <div className="space-y-2">
            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Sales Summary</p>
            {[
              { label: "Total Sales", value: sales, icon: TrendingUp, highlight: true },
              { label: "Cash", value: cash, icon: Banknote },
              { label: "Card", value: card, icon: CreditCard },
              { label: "Voids", value: voids, icon: RotateCcw, negative: true },
            ].map(({ label, value, icon: Icon, highlight, negative }) => (
              <div key={label} className={`flex items-center justify-between px-3 py-2 rounded-lg ${highlight ? "bg-primary/5 border border-primary/20" : "bg-muted/30"}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`w-3.5 h-3.5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={highlight ? "font-semibold" : ""}>{label}</span>
                </div>
                <span className={`font-bold tabular-nums ${highlight ? "text-primary" : negative ? "text-destructive" : ""}`}>
                  {negative && value > 0 ? "−" : ""}€{value.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* Cash reconciliation */}
          <div className="space-y-2">
            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Cash Reconciliation</p>
            <div className="flex justify-between px-3 py-1.5">
              <span className="text-muted-foreground">Opening Float</span>
              <span className="font-medium tabular-nums">€{float.toFixed(2)}</span>
            </div>
            <div className="flex justify-between px-3 py-1.5">
              <span className="text-muted-foreground">Cash Sales</span>
              <span className="font-medium tabular-nums">€{cash.toFixed(2)}</span>
            </div>
            <div className="flex justify-between px-3 py-1.5 border-t font-semibold">
              <span>Expected Cash</span>
              <span className="tabular-nums">€{(float + cash).toFixed(2)}</span>
            </div>
            {closing !== null && (
              <>
                <div className="flex justify-between px-3 py-1.5">
                  <span className="text-muted-foreground">Closing Count</span>
                  <span className="font-medium tabular-nums">€{closing.toFixed(2)}</span>
                </div>
                <div className={`flex justify-between px-3 py-1.5 rounded-lg font-bold ${Math.abs(closing - (float + cash)) < 0.01 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"}`}>
                  <span>Variance</span>
                  <span className="tabular-nums">€{(closing - (float + cash)).toFixed(2)}</span>
                </div>
              </>
            )}
          </div>

          {shift.notes && (
            <div>
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
              <p className="text-muted-foreground">{shift.notes}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PosShifts() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<PosShift | null>(null);

  const { data: shifts = [], isLoading } = useQuery<PosShift[]>({ queryKey: ["/api/pos/shifts"] });

  const filtered = shifts.filter(s => {
    const matchSearch = s.cashierName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalSales = filtered.reduce((sum, s) => sum + parseFloat(s.totalSales ?? "0"), 0);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Shifts & Reports"
        subtitle="View X-Reports (mid-shift) and Z-Reports (closed shifts)"
        icon={<Clock className="w-5 h-5" />}
      />

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Shifts", value: filtered.length, sub: "in view" },
          { label: "Open Shifts", value: filtered.filter(s => s.status === "open").length, sub: "currently active" },
          { label: "Total Sales", value: `€${totalSales.toFixed(2)}`, sub: "across filtered shifts" },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search by cashier…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search-shifts"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Shifts</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Clock className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">No shifts found</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cashier</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Opened</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Closed</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Sales</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Txns</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-shift-${s.id}`}>
                  <td className="px-4 py-3 font-medium">{s.cashierName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{format(new Date(s.openedAt), "dd MMM yy HH:mm")}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.closedAt ? format(new Date(s.closedAt), "dd MMM yy HH:mm") : <span className="text-green-600 font-medium">Open</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">€{parseFloat(s.totalSales ?? "0").toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{s.transactionCount ?? 0}</td>
                  <td className="px-4 py-3">
                    <Badge variant={s.status === "open" ? "default" : "secondary"}>
                      {s.status === "open" ? "X-Report" : "Z-Report"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" onClick={() => setSelected(s)} data-testid={`button-view-shift-${s.id}`}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <ShiftReportDialog shift={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
