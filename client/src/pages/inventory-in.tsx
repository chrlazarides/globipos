import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PackagePlus, Trash2, CheckCircle2, ArrowLeftRight, MapPin } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Category, Color, Size, InventoryInLine, PosLocation } from "@shared/schema";

interface PostedLine {
  id: string;
  barcode: string;
  description: string;
  colorName: string;
  sizeName: string;
  quantity: number;
  itemId: string;
  variantId: string;
  locationId: string | null;
}

export default function InventoryInPage() {
  const { toast } = useToast();

  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: colors = [] } = useQuery<Color[]>({ queryKey: ["/api/colors"] });
  const { data: sizes = [] } = useQuery<Size[]>({ queryKey: ["/api/sizes"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });
  const { data: pendingLines = [], isLoading: pendingLoading } = useQuery<InventoryInLine[]>({ queryKey: ["/api/inventory-in", { posted: false }], queryFn: async () => {
    const res = await apiRequest("GET", "/api/inventory-in?posted=false");
    return res.json();
  } });

  const sortedColors = useMemo(() => [...colors].filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)), [colors]);
  const sortedSizes = useMemo(() => [...sizes].filter(s => s.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [sizes]);
  const defaultReceivingLoc = useMemo(() => locations.find(l => l.isDefaultReceiving), [locations]);

  const [categoryId, setCategoryId] = useState("");
  const [style, setStyle] = useState("");
  const [description, setDescription] = useState("");
  const [costPrice, setCostPrice] = useState("0");
  const [price1, setPrice1] = useState("0");
  const [vatRate, setVatRate] = useState("19");
  const [season, setSeason] = useState("");
  const [codeMethod, setCodeMethod] = useState<"descriptive" | "sequential">("descriptive");
  const [locationId, setLocationId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Quick-transfer dialog state (opens after posting)
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferLines, setTransferLines] = useState<PostedLine[]>([]);
  const [transferTo, setTransferTo] = useState("");
  const [transferQtys, setTransferQtys] = useState<Record<string, string>>({});

  // Auto-select the default receiving location when locations load
  useEffect(() => {
    if (defaultReceivingLoc && !locationId) {
      setLocationId(defaultReceivingLoc.id);
    }
  }, [defaultReceivingLoc, locationId]);

  const cellKey = (colorId: string, sizeId: string) => `${colorId}::${sizeId}`;

  const resetMatrix = () => {
    setStyle("");
    setDescription("");
    setQuantities({});
  };

  const appendMutation = useMutation({
    mutationFn: async () => {
      if (!categoryId) throw new Error("Select a department (category)");
      if (!style.trim()) throw new Error("Enter a style code");
      if (!description.trim()) throw new Error("Enter a description");

      const cells = sortedColors.flatMap(color =>
        sortedSizes.map(size => {
          const qty = parseInt(quantities[cellKey(color.id, size.id)] || "0", 10) || 0;
          return { colorId: color.id, sizeId: size.id, quantity: qty };
        })
      ).filter(c => c.quantity > 0);

      if (cells.length === 0) throw new Error("Enter at least one quantity in the matrix");

      const res = await apiRequest("POST", "/api/inventory-in", {
        categoryId, style: style.trim(), description: description.trim(),
        costPrice, price1, vatRate, season: season || null, codeMethod,
        locationId: locationId || null,
        cells,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: (lines: InventoryInLine[]) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-in"] });
      toast({ title: `${lines.length} barcode(s) synthesized`, description: "Added to the pending Inventory-In list below. Remember to Post to update stock." });
      resetMatrix();
    },
    onError: (e: Error) => toast({ title: "Cannot append", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/inventory-in/${id}`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-in"] });
      setSelectedIds(prev => prev.filter(id => id !== deletedId));
    },
    onError: (e: Error) => toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  const postMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/inventory-in/post", { ids });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: (result: { posted: number; itemsCreated: number; variantsCreated: number; lines: PostedLine[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-in"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/item-variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      setSelectedIds([]);
      toast({
        title: "Posting complete",
        description: `${result.posted} line(s) posted — ${result.itemsCreated} new item(s), ${result.variantsCreated} new variant(s) created and stock updated.`,
      });
      // Open quick-transfer dialog if there are posted lines
      if (result.lines.length > 0) {
        const qtys: Record<string, string> = {};
        result.lines.forEach(l => { qtys[l.id] = String(l.quantity); });
        setTransferLines(result.lines);
        setTransferQtys(qtys);
        setTransferTo("");
        setTransferOpen(true);
      }
    },
    onError: (e: Error) => toast({ title: "Cannot post", description: e.message, variant: "destructive" }),
  });

  const quickTransferMutation = useMutation({
    mutationFn: async () => {
      if (!transferTo) throw new Error("Select a destination location");
      const fromLoc = locations.find(l => l.id === (transferLines[0]?.locationId || locationId));
      const toLoc = locations.find(l => l.id === transferTo);
      if (!fromLoc || !toLoc) throw new Error("Invalid locations");
      if (fromLoc.id === toLoc.id) throw new Error("Source and destination must be different");

      const items = transferLines.map(l => ({
        itemId: l.itemId,
        itemName: l.description,
        sku: null,
        barcode: l.barcode,
        quantity: parseInt(transferQtys[l.id] || "0") || 0,
        variantId: l.variantId,
      })).filter(i => i.quantity > 0);

      if (items.length === 0) throw new Error("Enter at least one quantity to transfer");

      const res = await apiRequest("POST", "/api/stock-transfers", {
        fromLocation: fromLoc.name,
        toLocation: toLoc.name,
        notes: "From Inventory In posting",
        status: "draft",
        items,
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      const transfer = await res.json();
      await apiRequest("POST", `/api/stock-transfers/${transfer.id}/complete`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers"] });
      toast({ title: "Transfer completed", description: "Stock moved to the destination location." });
      setTransferOpen(false);
    },
    onError: (e: Error) => toast({ title: "Transfer failed", description: e.message, variant: "destructive" }),
  });

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === pendingLines.length) setSelectedIds([]);
    else setSelectedIds(pendingLines.map(l => l.id));
  };

  const categoryName = (id: string) => categories.find(c => c.id === id)?.name || "—";
  const locationName = (id: string | null) => id ? (locations.find(l => l.id === id)?.name || id) : "—";

  const receivingLocation = locations.find(l => l.id === locationId);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHeader
        title="Inventory In (Color/Size)"
        description="Synthesize item barcodes for new stock directly from a Department + Style + Color/Size matrix — no barcode needed on the goods."
        icon={<PackagePlus className="w-5 h-5" />}
      />

      <Card>
        <CardHeader className="p-3">
          <CardTitle className="text-sm">1. Style header &amp; Receiving Location</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          {/* Receiving location row */}
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40 border">
            <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Receiving Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="h-8 mt-0.5 bg-background" data-testid="select-inventoryin-location">
                  <SelectValue placeholder={locations.length === 0 ? "No locations set up yet" : "Select receiving location…"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No location (global stock only)</SelectItem>
                  {locations.filter(l => l.active).map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}{l.isDefaultReceiving ? " ★ Default" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {receivingLocation && (
              <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                {receivingLocation.isDefaultReceiving ? "★ Default" : "Selected"}
              </Badge>
            )}
            {locations.length === 0 && (
              <p className="text-xs text-muted-foreground">Set up locations in POS → Locations first.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Department (Category)</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger data-testid="select-inventoryin-category">
                  <SelectValue placeholder="Select department…" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Code synthesis method</Label>
              <Select value={codeMethod} onValueChange={(v) => setCodeMethod(v as "descriptive" | "sequential")}>
                <SelectTrigger data-testid="select-inventoryin-code-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="descriptive">Descriptive (Code-39) — Dept+Style+Color+Size</SelectItem>
                  <SelectItem value="sequential">Sequential (EAN-8) — short running number</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Style code</Label>
              <Input value={style} onChange={e => setStyle(e.target.value)} placeholder="e.g. TRT67V" data-testid="input-inventoryin-style" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Velvet jacket" data-testid="input-inventoryin-description" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Cost</Label>
              <Input type="number" step="0.01" value={costPrice} onChange={e => setCostPrice(e.target.value)} data-testid="input-inventoryin-cost" />
            </div>
            <div>
              <Label>Price</Label>
              <Input type="number" step="0.01" value={price1} onChange={e => setPrice1(e.target.value)} data-testid="input-inventoryin-price" />
            </div>
            <div>
              <Label>VAT %</Label>
              <Input type="number" step="0.01" value={vatRate} onChange={e => setVatRate(e.target.value)} data-testid="input-inventoryin-vat" />
            </div>
            <div>
              <Label>Season (optional)</Label>
              <Input value={season} onChange={e => setSeason(e.target.value)} placeholder="e.g. SS26" data-testid="input-inventoryin-season" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3">
          <CardTitle className="text-sm">2. Enter quantities — Color × Size matrix</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {sortedColors.length === 0 || sortedSizes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Set up colors and sizes first (Items → Colors & Sizes).</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background">Color \ Size</TableHead>
                    {sortedSizes.map(s => <TableHead key={s.id} className="text-center">{s.name}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedColors.map(color => (
                    <TableRow key={color.id}>
                      <TableCell className="sticky left-0 bg-background font-medium">{color.name}</TableCell>
                      {sortedSizes.map(size => {
                        const key = cellKey(color.id, size.id);
                        return (
                          <TableCell key={size.id} className="text-center p-1">
                            <Input
                              type="number"
                              min="0"
                              className="w-16 mx-auto text-center h-8"
                              value={quantities[key] || ""}
                              onChange={e => setQuantities(prev => ({ ...prev, [key]: e.target.value }))}
                              data-testid={`input-inventoryin-qty-${color.id}-${size.id}`}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex justify-end mt-3">
            <Button onClick={() => appendMutation.mutate()} disabled={appendMutation.isPending} data-testid="button-inventoryin-append">
              Append (synthesize barcodes)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">3. Pending Inventory-In lines (not yet posted)</CardTitle>
          {pendingLines.length > 0 && (
            <Button
              size="sm"
              disabled={selectedIds.length === 0 || postMutation.isPending}
              onClick={() => postMutation.mutate(selectedIds)}
              data-testid="button-inventoryin-post"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Post {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {pendingLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : pendingLines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No pending lines. Append quantities above to synthesize barcodes.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox checked={selectedIds.length === pendingLines.length} onCheckedChange={toggleSelectAll} data-testid="checkbox-inventoryin-select-all" />
                    </TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Style</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingLines.map(line => (
                    <TableRow key={line.id} data-testid={`row-inventoryin-${line.id}`}>
                      <TableCell>
                        <Checkbox checked={selectedIds.includes(line.id)} onCheckedChange={() => toggleSelected(line.id)} data-testid={`checkbox-inventoryin-${line.id}`} />
                      </TableCell>
                      <TableCell className="text-sm">{categoryName(line.categoryId)}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{line.style}</div>
                        <div className="text-xs text-muted-foreground">{line.description}</div>
                      </TableCell>
                      <TableCell className="text-sm">{line.colorName}</TableCell>
                      <TableCell className="text-sm">{line.sizeName}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {line.barcode}
                        <Badge variant="secondary" className="ml-2 text-[10px]">{line.codeMethod === "sequential" ? "EAN-8" : "Code-39"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {line.locationId ? (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{locationName(line.locationId)}</span>
                        ) : <span>—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">{line.quantity}</TableCell>
                      <TableCell className="text-right text-sm">€{parseFloat(line.costPrice).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">€{parseFloat(line.price1).toFixed(2)}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => deleteMutation.mutate(line.id)}
                          data-testid={`button-inventoryin-delete-${line.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Posting is a separate, deliberate step — until a line is posted, it will not create/update items, variants, or affect stock quantities.
          </p>
        </CardContent>
      </Card>

      {/* Quick-Transfer dialog — opens after posting */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-primary" />
              Spot Transfer — move posted stock to another location
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Stock has been received into <strong>{locationName(transferLines[0]?.locationId || locationId)}</strong>.
            Optionally transfer some or all of it to another location right now.
          </p>

          <div>
            <Label className="text-xs">Transfer to</Label>
            <Select value={transferTo} onValueChange={setTransferTo}>
              <SelectTrigger data-testid="select-quick-transfer-to">
                <SelectValue placeholder="Select destination location…" />
              </SelectTrigger>
              <SelectContent>
                {locations.filter(l => l.active && l.id !== (transferLines[0]?.locationId || locationId)).map(l => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Barcode</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Transfer Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transferLines.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.barcode}</TableCell>
                  <TableCell className="text-sm">{l.description}</TableCell>
                  <TableCell className="text-right text-sm">{l.quantity}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      max={l.quantity}
                      value={transferQtys[l.id] ?? "0"}
                      onChange={e => setTransferQtys(prev => ({ ...prev, [l.id]: e.target.value }))}
                      className="w-20 ml-auto text-center h-7 text-sm"
                      data-testid={`input-quick-transfer-qty-${l.id}`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Skip</Button>
            <Button onClick={() => quickTransferMutation.mutate()} disabled={quickTransferMutation.isPending || !transferTo} data-testid="button-quick-transfer-submit">
              <ArrowLeftRight className="w-4 h-4 mr-1" />
              {quickTransferMutation.isPending ? "Transferring…" : "Transfer Now"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
