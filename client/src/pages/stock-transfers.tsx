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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeftRight, Plus, Trash2, CheckCircle2, Search, ChevronDown, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PosLocation, StockTransfer, StockTransferItem } from "@shared/schema";

type TransferWithItems = StockTransfer & { items: StockTransferItem[] };

interface DraftLine { key: string; itemId: string; itemName: string; sku: string | null; barcode: string | null; quantity: number; }
interface ItemResult { id: string; name: string; sku: string; barcode: string | null; }

export default function StockTransfersPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: transfers = [], isLoading } = useQuery<TransferWithItems[]>({ queryKey: ["/api/stock-transfers"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<ItemResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingItem, setPendingItem] = useState<ItemResult | null>(null);
  const [pendingQty, setPendingQty] = useState("1");

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
      toast({ title: "Transfer completed and stock updated" });
      setOpen(false);
      setFromLocation(""); setToLocation(""); setNotes(""); setLines([]); setSearchQ(""); setSearchResults([]); setPendingItem(null);
    },
    onError: (e: Error) => toast({ title: "Cannot create transfer", description: e.message, variant: "destructive" }),
  });

  const handleSearch = async (q: string) => {
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
        if (all.ok) {
          const data = await all.json();
          setSearchResults((Array.isArray(data) ? data : data.items || []).slice(0, 15));
        }
      }
    } catch { setSearchResults([]); } finally { setSearching(false); }
  };

  const addLine = (item: ItemResult) => {
    const qty = parseInt(pendingQty) || 1;
    setLines(prev => {
      const ex = prev.find(l => l.itemId === item.id);
      if (ex) return prev.map(l => l.itemId === item.id ? { ...l, quantity: l.quantity + qty } : l);
      return [...prev, { key: item.id, itemId: item.id, itemName: item.name, sku: item.sku, barcode: item.barcode, quantity: qty }];
    });
    setPendingItem(null); setPendingQty("1"); setSearchQ(""); setSearchResults([]);
  };

  const statusColor = (s: string) => s === "completed" ? "default" : s === "cancelled" ? "destructive" : "secondary";

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHeader
        title="Stock Transfers"
        description="Move stock between locations. Each transfer is logged and immediately adjusts per-location stock pools."
        icon={<ArrowLeftRight className="w-5 h-5" />}
        action={<Button onClick={() => setOpen(true)} data-testid="button-new-transfer"><Plus className="w-4 h-4 mr-1" />New Transfer</Button>}
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6">Loading…</p>
          ) : transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">No transfers yet. Create one using the button above.</p>
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
                {transfers.map(t => (
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

      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); setLines([]); setFromLocation(""); setToLocation(""); setNotes(""); setSearchQ(""); setSearchResults([]); setPendingItem(null); } }}>
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Items</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={searchQ}
                    onChange={e => handleSearch(e.target.value)}
                    placeholder="Scan barcode or type product name…"
                    className="pl-8 text-sm"
                    data-testid="input-transfer-search"
                  />
                </div>
                <Input
                  type="number"
                  min="1"
                  value={pendingQty}
                  onChange={e => setPendingQty(e.target.value)}
                  className="w-16 text-center"
                  data-testid="input-transfer-qty"
                />
              </div>
              {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
              {searchResults.length > 0 && (
                <div className="border rounded-md divide-y max-h-40 overflow-y-auto">
                  {searchResults.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer" onClick={() => addLine(item)} data-testid={`transfer-result-${item.id}`}>
                      <div>
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.sku}{item.barcode ? ` · ${item.barcode}` : ""}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={e => { e.stopPropagation(); addLine(item); }}>Add ×{pendingQty}</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {lines.length > 0 && (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs">Barcode</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map(l => (
                      <TableRow key={l.key}>
                        <TableCell className="text-sm">{l.itemName}<br /><span className="text-xs text-muted-foreground">{l.sku}</span></TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">{l.barcode || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min="1"
                            value={l.quantity}
                            onChange={e => setLines(prev => prev.map(x => x.key === l.key ? { ...x, quantity: parseInt(e.target.value) || 1 } : x))}
                            className="w-16 ml-auto text-center h-7 text-sm"
                            data-testid={`input-line-qty-${l.itemId}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} data-testid={`button-remove-line-${l.itemId}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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
