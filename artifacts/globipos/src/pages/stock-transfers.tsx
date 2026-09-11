import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeftRight, Plus, Trash2, CheckCircle2, Search, ChevronDown, ChevronRight, PackageSearch, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PosLocation, StockTransfer, StockTransferItem, Item, ItemLocationStock } from "@shared/schema";

type TransferWithItems = StockTransfer & { items: StockTransferItem[] };

interface DraftLine { key: string; itemId: string; itemName: string; sku: string | null; barcode: string | null; quantity: number; }

export default function StockTransfersPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState("");

  const { data: transfers = [], isLoading } = useQuery<TransferWithItems[]>({ queryKey: ["/api/stock-transfers"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });
  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"], staleTime: 30000 });

  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [scanning, setScanning] = useState(false);

  // On-hand at the selected source location (per-location stock pool)
  const { data: sourceStock = [] } = useQuery<ItemLocationStock[]>({
    queryKey: ["/api/location-stock", fromLocation],
    queryFn: async () => (await apiRequest("GET", `/api/location-stock?locationId=${fromLocation}`)).json(),
    enabled: !!fromLocation,
  });

  const onHandMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sourceStock) m.set(s.itemId, (m.get(s.itemId) || 0) + s.quantity);
    return m;
  }, [sourceStock]);
  const onHand = (itemId: string) => onHandMap.get(itemId) ?? 0;

  const resetForm = () => {
    setFromLocation(""); setToLocation(""); setNotes(""); setLines([]); setSearchQ("");
  };

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/stock-transfers/${id}/complete`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] }); toast({ title: "Transfer completed" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!fromLocation) throw new Error("Select a 'From' location");
      if (!toLocation) throw new Error("Select a 'To' location");
      if (fromLocation === toLocation) throw new Error("From and To must be different locations");
      if (lines.length === 0) throw new Error("Add at least one item");
      const res = await apiRequest("POST", "/api/stock-transfers", {
        fromLocation: locations.find(l => l.id === fromLocation)?.name || fromLocation,
        toLocation: locations.find(l => l.id === toLocation)?.name || toLocation,
        notes: notes || null,
        status: "completed",
        items: lines.map(l => ({ itemId: l.itemId, itemName: l.itemName, sku: l.sku, barcode: l.barcode, quantity: l.quantity })),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      const transfer = await res.json();
      await apiRequest("POST", `/api/stock-transfers/${transfer.id}/complete`, {});
      return transfer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/location-stock"] });
      toast({ title: "Transfer completed and stock updated" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Cannot create transfer", description: e.message, variant: "destructive" }),
  });

  // Browsable, searchable item picker. Empty query → show what's on hand at the
  // source location; typed query → filter the whole catalogue by name/sku/barcode.
  const pickerItems = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    let list = items.filter(i => i.active !== false && !i.hasVariants);
    if (q) {
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.sku || "").toLowerCase().includes(q) ||
        (i.barcode || "").toLowerCase().includes(q)
      );
    } else if (fromLocation) {
      list = list.filter(i => onHand(i.id) > 0);
    }
    return [...list]
      .sort((a, b) => onHand(b.id) - onHand(a.id) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [items, searchQ, fromLocation, onHandMap]);

  const addLine = (item: Item, qty = 1) => {
    setLines(prev => {
      const ex = prev.find(l => l.itemId === item.id);
      if (ex) return prev.map(l => l.itemId === item.id ? { ...l, quantity: l.quantity + qty } : l);
      return [...prev, { key: item.id, itemId: item.id, itemName: item.name, sku: item.sku, barcode: item.barcode, quantity: qty }];
    });
  };

  // Enter in the search field acts as a barcode scan: exact-match lookup (also
  // resolves alternate/EAN barcodes registered on the item) then auto-adds.
  const handleScan = async () => {
    const code = searchQ.trim();
    if (!code) return;
    setScanning(true);
    try {
      const res = await apiRequest("GET", `/api/items/barcode/${encodeURIComponent(code)}`);
      if (res.ok) {
        const item = await res.json();
        if (item.hasVariants || item.variantId) {
          toast({ title: "Not supported", description: `${item.name} has colour/size variants — variant-level transfers aren't available yet.`, variant: "destructive" });
          return;
        }
        addLine(item);
        setSearchQ("");
        toast({ title: "Added", description: item.name });
        return;
      }
    } catch { /* fall through to list filtering */ } finally { setScanning(false); }
    // If only one item matches the typed text, add it directly for speed
    if (pickerItems.length === 1) { addLine(pickerItems[0]); setSearchQ(""); }
  };

  const hasWarnings = lines.some(l => fromLocation && onHand(l.itemId) > 0 && l.quantity > onHand(l.itemId));

  const filteredTransfers = useMemo(() => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return transfers;
    return transfers.filter(t =>
      t.transferNumber.toLowerCase().includes(q) ||
      t.fromLocation.toLowerCase().includes(q) ||
      t.toLocation.toLowerCase().includes(q) ||
      (t.createdByUsername || "").toLowerCase().includes(q) ||
      t.items.some(i => i.itemName.toLowerCase().includes(q) || (i.barcode || "").toLowerCase().includes(q))
    );
  }, [transfers, historyFilter]);

  const statusColor = (s: string) => s === "completed" ? "default" : s === "cancelled" ? "destructive" : "secondary";

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHeader
        title="Stock Transfers"
        description="Move stock between locations. Each transfer is logged and immediately adjusts per-location stock pools."
        icon={<ArrowLeftRight className="w-5 h-5" />}
        action={<Button onClick={() => setOpen(true)} data-testid="button-new-transfer"><Plus className="w-4 h-4 mr-1" />New Transfer</Button>}
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Filter transfers by #, location, item…"
          value={historyFilter}
          onChange={e => setHistoryFilter(e.target.value)}
          className="pl-9"
          data-testid="input-transfer-history-filter"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading…</p>
          ) : filteredTransfers.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6" data-testid="text-no-transfers">
              {transfers.length === 0 ? "No transfers yet. Create one using the button above." : "No transfers match your filter."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Transfer #</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Created by</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransfers.map(t => (
                  <>
                    <TableRow key={t.id} data-testid={`row-transfer-${t.id}`} className="cursor-pointer" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                      <TableCell className="text-muted-foreground">
                        {expandedId === t.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">{t.transferNumber}</TableCell>
                      <TableCell className="text-sm">{t.fromLocation}</TableCell>
                      <TableCell className="text-sm">{t.toLocation}</TableCell>
                      <TableCell className="text-sm">{t.items.length}</TableCell>
                      <TableCell><Badge variant={statusColor(t.status) as any}>{t.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{t.createdByUsername || "—"}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        {t.status === "draft" && (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => completeMutation.mutate(t.id)} disabled={completeMutation.isPending} data-testid={`button-complete-transfer-${t.id}`}>
                            <CheckCircle2 className="w-3 h-3 mr-1" />Complete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedId === t.id && t.items.length > 0 && (
                      <TableRow key={`${t.id}-detail`}>
                        <TableCell colSpan={9} className="bg-muted/30 p-0">
                          <div className="px-8 py-3">
                            <table className="w-full text-xs">
                              <thead><tr className="text-muted-foreground"><th className="text-left pb-1">Item</th><th className="text-left pb-1">SKU</th><th className="text-left pb-1">Barcode</th><th className="text-right pb-1">Qty</th></tr></thead>
                              <tbody>
                                {t.items.map(i => (
                                  <tr key={i.id} className="border-t border-border/40">
                                    <td className="py-1 font-medium">{i.itemName}</td>
                                    <td className="py-1 text-muted-foreground">{i.sku || "—"}</td>
                                    <td className="py-1 font-mono text-muted-foreground">{i.barcode || "—"}</td>
                                    <td className="py-1 text-right font-semibold">{i.quantity}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); resetForm(); } else setOpen(true); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="w-4 h-4" />New Stock Transfer</DialogTitle></DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From Location</Label>
                <Select value={fromLocation} onValueChange={setFromLocation}>
                  <SelectTrigger data-testid="select-transfer-from">
                    <SelectValue placeholder="Select source…" />
                  </SelectTrigger>
                  <SelectContent>{locations.filter(l => l.active).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">To Location</Label>
                <Select value={toLocation} onValueChange={setToLocation}>
                  <SelectTrigger data-testid="select-transfer-to">
                    <SelectValue placeholder="Select destination…" />
                  </SelectTrigger>
                  <SelectContent>{locations.filter(l => l.active && l.id !== fromLocation).map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Monthly restock" data-testid="input-transfer-notes" />
            </div>

            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Items</p>
                {fromLocation
                  ? <span className="text-[11px] text-muted-foreground">Showing on-hand at <strong>{locations.find(l => l.id === fromLocation)?.name}</strong></span>
                  : <span className="text-[11px] text-amber-600">Select a source to see on-hand stock</span>}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } }}
                  placeholder="Scan barcode (Enter) or type to search the list…"
                  className="pl-8 text-sm"
                  data-testid="input-transfer-search"
                />
              </div>

              <div className="border rounded-md divide-y max-h-56 overflow-y-auto" data-testid="list-transfer-picker">
                {scanning && <p className="text-xs text-muted-foreground px-3 py-2">Looking up…</p>}
                {pickerItems.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground flex flex-col items-center gap-1">
                    <PackageSearch className="w-5 h-5 opacity-40" />
                    {searchQ ? "No matching items." : fromLocation ? "No stock on hand at this location. Type to search the full catalogue." : "Type to search items."}
                  </div>
                ) : pickerItems.map(item => {
                  const oh = onHand(item.id);
                  const inCart = lines.find(l => l.itemId === item.id);
                  return (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50" data-testid={`transfer-result-${item.id}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.sku}{item.barcode ? ` · ${item.barcode}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {fromLocation && (
                          <Badge variant={oh > 0 ? "secondary" : "outline"} className="text-[10px]" data-testid={`badge-onhand-${item.id}`}>
                            {oh} on hand
                          </Badge>
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addLine(item)} data-testid={`button-add-item-${item.id}`}>
                          {inCart ? `Added (${inCart.quantity})` : "Add"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {lines.length > 0 && (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Item</TableHead>
                      {fromLocation && <TableHead className="text-xs text-right">On hand</TableHead>}
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map(l => {
                      const oh = onHand(l.itemId);
                      const over = fromLocation && oh > 0 && l.quantity > oh;
                      return (
                        <TableRow key={l.key}>
                          <TableCell className="text-sm">{l.itemName}<br /><span className="text-xs text-muted-foreground">{l.sku}</span></TableCell>
                          {fromLocation && (
                            <TableCell className={`text-right text-xs ${over ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              {oh}{over && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="1"
                              value={l.quantity}
                              onChange={e => setLines(prev => prev.map(x => x.key === l.key ? { ...x, quantity: parseInt(e.target.value) || 1 } : x))}
                              className={`w-16 ml-auto text-center h-7 text-sm ${over ? "border-destructive" : ""}`}
                              data-testid={`input-line-qty-${l.itemId}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} data-testid={`button-remove-line-${l.itemId}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {hasWarnings && (
              <p className="text-xs text-amber-600 flex items-center gap-1" data-testid="text-transfer-warning">
                <AlertTriangle className="w-3.5 h-3.5" /> Some lines exceed the quantity on hand at the source location.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || lines.length === 0} data-testid="button-submit-transfer">
                <CheckCircle2 className="w-4 h-4 mr-1" />
                {createMutation.isPending ? "Transferring…" : `Transfer ${lines.length} item${lines.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
