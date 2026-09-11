import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CalendarClock, Plus, Trash2, Search, Tag, AlertTriangle, TriangleAlert, PackageX, CircleCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PosLocation } from "@shared/schema";

interface Batch {
  id: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  barcode: string | null;
  locationId: string | null;
  batchCode: string | null;
  expirationDate: string;
  quantity: number;
  costPrice: string;
  notes: string | null;
  status: string;
  promotionId: string | null;
  daysUntil: number;
  bucket: "expired" | "critical" | "warning" | "ok";
}

interface ItemResult { id: string; name: string; sku: string; barcode: string | null; costPrice?: string; }

const fmtDate = (d: string) => { const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };
const fmtEur = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const bucketMeta: Record<string, { label: string; cls: string; badge: string }> = {
  expired: { label: "Expired", cls: "border-l-red-500", badge: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  critical: { label: "≤ 7 days", cls: "border-l-orange-500", badge: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  warning: { label: "≤ 30 days", cls: "border-l-amber-400", badge: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  ok: { label: "OK", cls: "border-l-emerald-500", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
};

export default function ExpirationPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [mdBatch, setMdBatch] = useState<Batch | null>(null);
  const [mdPct, setMdPct] = useState("20");
  const [filter, setFilter] = useState<string>("all");

  const { data: batches = [], isLoading } = useQuery<Batch[]>({ queryKey: ["/api/expiration/batches"] });
  const { data: report } = useQuery<{ alertCount: number; expiredCount: number; soonCount: number; buckets: Record<string, { count: number; units: number; value: number }> }>({ queryKey: ["/api/expiration/report"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const [pendingItem, setPendingItem] = useState<ItemResult | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<ItemResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expDate, setExpDate] = useState("");
  const [qty, setQty] = useState("1");
  const [batchCode, setBatchCode] = useState("");
  const [locationId, setLocationId] = useState("none");
  const [notes, setNotes] = useState("");

  const doSearch = async (q: string) => {
    setSearchQ(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const byBarcode = await apiRequest("GET", `/api/items/barcode/${encodeURIComponent(q.trim())}`);
      if (byBarcode.ok) {
        const item = await byBarcode.json();
        setSearchResults([item]);
      } else {
        const all = await apiRequest("GET", `/api/items?search=${encodeURIComponent(q.trim())}`);
        const data = await all.json();
        setSearchResults((Array.isArray(data) ? data : data.items || []).slice(0, 15));
      }
    } catch { setSearchResults([]); } finally { setSearching(false); }
  };

  const resetAdd = () => {
    setPendingItem(null); setSearchQ(""); setSearchResults([]); setExpDate("");
    setQty("1"); setBatchCode(""); setLocationId("none"); setNotes("");
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!pendingItem) throw new Error("Select an item");
      if (!expDate) throw new Error("Enter an expiration date");
      const res = await apiRequest("POST", "/api/expiration/batches", {
        itemId: pendingItem.id,
        itemName: pendingItem.name,
        sku: pendingItem.sku,
        barcode: pendingItem.barcode,
        expirationDate: expDate,
        quantity: parseInt(qty) || 0,
        costPrice: pendingItem.costPrice ?? "0",
        batchCode: batchCode || null,
        locationId: locationId === "none" ? null : locationId,
        notes: notes || null,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expiration/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expiration/report"] });
      toast({ title: "Batch added" });
      setAddOpen(false); resetAdd();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const res = await apiRequest("DELETE", `/api/expiration/batches/${id}`); if (!res.ok) throw new Error("Delete failed"); return res.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expiration/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expiration/report"] });
      toast({ title: "Batch removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markdownMutation = useMutation({
    mutationFn: async () => {
      if (!mdBatch) throw new Error("No batch");
      const res = await apiRequest("POST", `/api/expiration/batches/${mdBatch.id}/markdown`, { discountPct: mdPct });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expiration/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expiration/report"] });
      toast({ title: "Markdown offer created", description: "A POS promotion is now active for this item." });
      setMdBatch(null); setMdPct("20");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const shown = batches.filter(b => filter === "all" ? true : b.bucket === filter);
  const b = report?.buckets;
  const atRiskValue = (b?.expired.value ?? 0) + (b?.critical.value ?? 0) + (b?.warning.value ?? 0);

  return (
    <div className="p-6">
      <PageHeader
        title="Expiration Management"
        description="Track best-before dates, get near-expiry alerts, and create markdown offers before stock expires."
        icon={<CalendarClock />}
        action={<Button onClick={() => setAddOpen(true)} data-testid="button-add-batch"><Plus className="w-4 h-4 mr-1" /> Track Batch</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<PackageX className="w-5 h-5" />} label="Expired" value={report?.expiredCount ?? 0} sub={`${b?.expired.units ?? 0} units`} tone="red" testid="stat-expired" />
        <StatCard icon={<TriangleAlert className="w-5 h-5" />} label="Critical (≤7 days)" value={b?.critical.count ?? 0} sub={`${b?.critical.units ?? 0} units`} tone="orange" testid="stat-critical" />
        <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Expiring (≤30 days)" value={b?.warning.count ?? 0} sub={`${b?.warning.units ?? 0} units`} tone="amber" testid="stat-warning" />
        <StatCard icon={<Tag className="w-5 h-5" />} label="Value at risk" value={fmtEur(atRiskValue)} sub="cost of near/expired stock" tone="slate" testid="stat-value" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-base">Tracked Batches</CardTitle>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44" data-testid="select-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="critical">Critical (≤7 days)</SelectItem>
              <SelectItem value="warning">Expiring (≤30 days)</SelectItem>
              <SelectItem value="ok">OK</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
          ) : shown.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CircleCheck className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No batches to show. Track a batch to start monitoring expiration dates.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(batch => {
                  const meta = bucketMeta[batch.bucket];
                  const loc = locations.find(l => l.id === batch.locationId);
                  return (
                    <TableRow key={batch.id} className={`border-l-4 ${meta.cls}`} data-testid={`row-batch-${batch.id}`}>
                      <TableCell>
                        <div className="font-medium" data-testid={`text-item-${batch.id}`}>{batch.itemName}</div>
                        <div className="text-xs text-muted-foreground">{batch.sku}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-sm">{fmtDate(batch.expirationDate)}</div>
                        <div className="text-xs text-muted-foreground">
                          {batch.daysUntil < 0 ? `${Math.abs(batch.daysUntil)}d ago` : batch.daysUntil === 0 ? "today" : `in ${batch.daysUntil}d`}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={meta.badge} variant="secondary" data-testid={`badge-status-${batch.id}`}>{meta.label}</Badge>
                        {batch.status === "discounted" && <Badge className="ml-1 bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" variant="secondary">Markdown</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-mono">{batch.quantity}</TableCell>
                      <TableCell className="text-sm">{loc?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{batch.batchCode ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {batch.bucket !== "ok" && batch.status !== "discounted" && (
                            <Button size="sm" variant="outline" onClick={() => { setMdBatch(batch); setMdPct("20"); }} data-testid={`button-markdown-${batch.id}`}>
                              <Tag className="w-3.5 h-3.5 mr-1" /> Offer
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(batch.id)} data-testid={`button-delete-${batch.id}`}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add batch dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetAdd(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Track a Batch</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {pendingItem ? (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{pendingItem.name}</div>
                  <div className="text-xs text-muted-foreground">{pendingItem.sku}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPendingItem(null)}>Change</Button>
              </div>
            ) : (
              <div>
                <Label>Item</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-8" placeholder="Search by name, SKU or barcode" value={searchQ} onChange={(e) => doSearch(e.target.value)} data-testid="input-item-search" />
                </div>
                {searching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
                {searchResults.length > 0 && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border divide-y">
                    {searchResults.map(r => (
                      <button key={r.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm" onClick={() => { setPendingItem(r); setSearchResults([]); setSearchQ(""); }} data-testid={`option-item-${r.id}`}>
                        <span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {r.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="exp">Best Before / Expiry</Label>
                <Input id="exp" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} data-testid="input-exp-date" />
              </div>
              <div>
                <Label htmlFor="qty">Quantity</Label>
                <Input id="qty" type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="input-qty" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bc">Batch / Lot code</Label>
                <Input id="bc" value={batchCode} onChange={(e) => setBatchCode(e.target.value)} placeholder="optional" data-testid="input-batch-code" />
              </div>
              <div>
                <Label>Location</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger data-testid="select-location"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" data-testid="input-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="button-save-batch">
              {createMutation.isPending ? "Saving…" : "Save Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Markdown offer dialog */}
      <Dialog open={!!mdBatch} onOpenChange={(o) => { if (!o) setMdBatch(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Near-Expiry Offer</DialogTitle></DialogHeader>
          {mdBatch && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Create a POS promotion applying a discount to <span className="font-medium text-foreground">{mdBatch.itemName}</span>, valid until it expires on <span className="font-medium text-foreground">{fmtDate(mdBatch.expirationDate)}</span>.
              </p>
              <div>
                <Label htmlFor="pct">Discount %</Label>
                <Input id="pct" type="number" min="1" max="95" value={mdPct} onChange={(e) => setMdPct(e.target.value)} data-testid="input-discount-pct" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMdBatch(null)}>Cancel</Button>
            <Button onClick={() => markdownMutation.mutate()} disabled={markdownMutation.isPending} data-testid="button-create-offer">
              {markdownMutation.isPending ? "Creating…" : "Create Offer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon, label, value, sub, tone, testid }: { icon: React.ReactNode; label: string; value: string | number; sub: string; tone: string; testid: string }) {
  const tones: Record<string, string> = {
    red: "text-red-600 dark:text-red-400",
    orange: "text-orange-600 dark:text-orange-400",
    amber: "text-amber-600 dark:text-amber-400",
    slate: "text-slate-600 dark:text-slate-300",
  };
  return (
    <Card data-testid={testid}>
      <CardContent className="pt-5">
        <div className={`flex items-center gap-2 ${tones[tone]}`}>{icon}<span className="text-sm font-medium">{label}</span></div>
        <div className="text-2xl font-semibold mt-2 tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}
