import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MapPin, Search, Pencil, Check, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Item, ItemVariant, PosLocation, ItemLocationStock } from "@shared/schema";

function variantLabel(v: ItemVariant) {
  return [v.option1Value, v.option2Value, v.option3Value].filter(Boolean).join(" / ");
}

interface Row {
  itemId: string;
  variantId: string | null;
  itemName: string;
  variantLabel: string | null;
  sku: string;
  reorderLevel: number;
}

export default function LocationStockPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState<string>("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"], staleTime: 30000 });
  const { data: allVariants = [] } = useQuery<ItemVariant[]>({ queryKey: ["/api/item-variants"], staleTime: 30000 });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"], staleTime: 30000 });
  const { data: stock = [], isLoading: stockLoading } = useQuery<ItemLocationStock[]>({
    queryKey: ["/api/location-stock", locationId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/location-stock?locationId=${locationId}`);
      return res.json();
    },
    enabled: !!locationId,
  });

  const setStockMutation = useMutation({
    mutationFn: async ({ itemId, variantId, quantity }: { itemId: string; variantId: string | null; quantity: number }) => {
      const res = await apiRequest("POST", "/api/location-stock", { itemId, variantId, locationId, quantity });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/location-stock"] });
      toast({ title: "Stock updated" });
      setEditingKey(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const item of items) {
      if (item.hasVariants) {
        const variants = allVariants.filter(v => v.itemId === item.id && v.active);
        for (const v of variants) {
          out.push({
            itemId: item.id,
            variantId: v.id,
            itemName: item.name,
            variantLabel: variantLabel(v),
            sku: v.sku,
            reorderLevel: v.reorderLevel ?? item.reorderLevel,
          });
        }
      } else {
        out.push({
          itemId: item.id,
          variantId: null,
          itemName: item.name,
          variantLabel: null,
          sku: item.sku,
          reorderLevel: item.reorderLevel,
        });
      }
    }
    return out;
  }, [items, allVariants]);

  const filteredRows = rows.filter(r =>
    !search ||
    r.itemName.toLowerCase().includes(search.toLowerCase()) ||
    r.sku.toLowerCase().includes(search.toLowerCase()) ||
    (r.variantLabel || "").toLowerCase().includes(search.toLowerCase())
  ).slice(0, 300);

  const qtyFor = (itemId: string, variantId: string | null) => {
    const found = stock.find(s => s.itemId === itemId && (s.variantId || null) === variantId);
    return found ? found.quantity : 0;
  };

  const rowKey = (r: Row) => `${r.itemId}::${r.variantId || ""}`;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Location Stock"
        description="View and manage stock quantities per store/warehouse location — essential for textile, shoe and multi-branch inventory"
        icon={<MapPin className="w-5 h-5" />}
      />

      <div className="flex flex-wrap gap-3 items-center">
        <div className="w-64">
          <Select value={locationId} onValueChange={setLocationId} data-testid="select-stock-location">
            <SelectTrigger>
              <SelectValue placeholder="Select a location…" />
            </SelectTrigger>
            <SelectContent>
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search item, SKU, or variant…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-stock-search"
          />
        </div>
      </div>

      {!locationId ? (
        <Card>
          <CardContent className="py-16 text-center space-y-2">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">Select a location above to view its stock levels.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            {stockLoading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading stock…</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Stock at this location</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(r => {
                    const key = rowKey(r);
                    const qty = qtyFor(r.itemId, r.variantId);
                    const isEditing = editingKey === key;
                    const low = qty <= r.reorderLevel;
                    return (
                      <TableRow key={key} data-testid={`row-stock-${key}`}>
                        <TableCell className="font-medium">{r.itemName}</TableCell>
                        <TableCell className="text-muted-foreground">{r.variantLabel || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{r.sku}</TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <Input
                              type="number"
                              autoFocus
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  setStockMutation.mutate({ itemId: r.itemId, variantId: r.variantId, quantity: parseInt(editValue) || 0 });
                                }
                                if (e.key === "Escape") setEditingKey(null);
                              }}
                              className="w-24 h-8 ml-auto text-right"
                              data-testid={`input-edit-stock-${key}`}
                            />
                          ) : (
                            <Badge
                              variant={qty <= 0 ? "destructive" : low ? "secondary" : "outline"}
                              data-testid={`badge-stock-${key}`}
                            >
                              {qty}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                                disabled={setStockMutation.isPending}
                                onClick={() => setStockMutation.mutate({ itemId: r.itemId, variantId: r.variantId, quantity: parseInt(editValue) || 0 })}
                                data-testid={`button-save-stock-${key}`}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                                onClick={() => setEditingKey(null)}
                                data-testid={`button-cancel-stock-${key}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={() => { setEditingKey(key); setEditValue(String(qty)); }}
                              data-testid={`button-edit-stock-${key}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                        No items match your search
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
