import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Package, Upload, History, Download, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Pencil, Trash2, Layers, Barcode, Globe, Star } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertItemSchema, insertItemVariantSchema, insertCategorySchema, type Item, type ItemVariant, type Category, type Color, type Size, type ItemBarcode } from "@shared/schema";
import { ImportDialog } from "@/components/import-dialog";
import { usePriceLevels } from "@/hooks/use-price-levels";
import { z } from "zod";

const itemImportFields = [
  { key: "name", label: "Name", required: true },
  { key: "sku", label: "SKU", required: true },
  { key: "barcode", label: "Barcode" },
  { key: "description", label: "Description" },
  { key: "category", label: "Category" },
  { key: "unitType", label: "Unit Type" },
  { key: "packSize", label: "Pack Size" },
  { key: "price1", label: "Price Level 1" },
  { key: "price2", label: "Price Level 2" },
  { key: "price3", label: "Price Level 3" },
  { key: "price4", label: "Price Level 4" },
  { key: "price5", label: "Price Level 5" },
  { key: "costPrice", label: "Cost Price" },
  { key: "stockQuantity", label: "Stock Quantity" },
  { key: "reorderLevel", label: "Reorder Level" },
  { key: "volume", label: "Volume" },
  { key: "alcoholPercentage", label: "Alcohol %" },
  { key: "brand", label: "Brand / Producer" },
  { key: "origin", label: "Origin" },
  { key: "vintage", label: "Vintage" },
];

const itemFormSchema = insertItemSchema.extend({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  price1: z.string().min(1),
});

const CY_VAT_RATES = [
  { value: "19", label: "19% — Standard" },
  { value: "9",  label: "9% — Reduced (accommodation, restaurants)" },
  { value: "5",  label: "5% — Reduced (food, books, medicines)" },
  { value: "0",  label: "0% — Zero rated / exempt" },
];

const categoryFormSchema = insertCategorySchema.extend({
  name: z.string().min(1, "Name is required"),
  vatRate: z.string().optional().nullable(),
});

export default function Items() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const { toast } = useToast();

  const [stockSuggestionsOpen, setStockSuggestionsOpen] = useState(true);
  const { data: items = [], isLoading: itemsLoading } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: stockSuggestions = [] } = useQuery<{ id: string; name: string; sku: string; stockQuantity: number; reorderLevel: number; packSize: number; categoryName?: string; avgMonthly: number; suggestedOrder: number; urgency: "critical" | "warning" | "info" }[]>({ queryKey: ["/api/items/stock-suggestions"] });
  const { data: allSettings = [] } = useQuery<{ key: string; value: string }[]>({ queryKey: ["/api/settings"] });
  const weeksOfCover = parseInt(allSettings.find(s => s.key === "reorder_weeks_cover")?.value || "8", 10) || 8;
  const priceLevelNames = usePriceLevels();

  const createItem = useMutation({
    mutationFn: async (data: z.infer<typeof itemFormSchema>) => {
      const res = await apiRequest("POST", "/api/items", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      setItemDialogOpen(false);
      toast({ title: "Item created successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editCategoryDialogOpen, setEditCategoryDialogOpen] = useState(false);

  const createCategory = useMutation({
    mutationFn: async (data: z.infer<typeof categoryFormSchema>) => {
      const res = await apiRequest("POST", "/api/categories", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setCategoryDialogOpen(false);
      toast({ title: "Category created successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateCategory = useMutation({
    mutationFn: async (data: z.infer<typeof categoryFormSchema>) => {
      if (!editingCategory) return;
      const res = await apiRequest("PATCH", `/api/categories/${editingCategory.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditCategoryDialogOpen(false);
      setEditingCategory(null);
      toast({ title: "Category updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateItem = useMutation({
    mutationFn: async (data: z.infer<typeof itemFormSchema>) => {
      if (!editingItem) return;
      const res = await apiRequest("PATCH", `/api/items/${editingItem.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items/stock-suggestions"] });
      setEditDialogOpen(false);
      setEditingItem(null);
      toast({ title: "Item updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncVatFromCategories = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/items/sync-vat-from-categories", {});
      return res.json();
    },
    onSuccess: (data: { updated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: `VAT rates synced`, description: `${data.updated} item${data.updated !== 1 ? "s" : ""} updated from their category.` });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const handleRowClick = (item: Item) => {
    setEditingItem(item);
    setEditDialogOpen(true);
  };

  const filtered = items.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) || item.sku.toLowerCase().includes(search.toLowerCase()) || (item.brand || "").toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
    return matchSearch && matchCategory;
  });

  const columns: Column<Item>[] = [
    {
      key: "name",
      header: "Product",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Package className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.sku}</p>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (row) => {
        const cat = categories.find((c) => c.id === row.categoryId);
        return <span className="text-sm">{cat?.name || "-"}</span>;
      },
    },
    {
      key: "pack",
      header: "Pack",
      cell: (row) => (
        <Badge variant="secondary">
          {row.packSize === 1 ? "PC" : `${row.packSize}-pack`}
        </Badge>
      ),
    },
    {
      key: "vatRate",
      header: "VAT",
      cell: (row) => {
        const ownRate = (row as any).vatRate;
        if (ownRate != null) return <Badge variant="outline">{parseFloat(ownRate)}%</Badge>;
        const cat = categories.find((c) => c.id === row.categoryId);
        const effective = cat?.vatRate != null ? parseFloat(cat.vatRate) : 19;
        return (
          <Badge variant="secondary" title="Inherited from category">
            {effective}% ↑
          </Badge>
        );
      },
    },
    {
      key: "price",
      header: priceLevelNames[0],
      cell: (row) => <span className="text-sm font-medium">€{parseFloat(row.price1).toFixed(2)}</span>,
    },
    {
      key: "costPrice",
      header: "Cost",
      cell: (row) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          €{parseFloat((row as any).costPrice || "0").toFixed(2)}
        </span>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      cell: (row) => {
        const bottles = row.stockQuantity;
        const packSize = row.packSize || 1;
        const packs = packSize > 1 ? Math.floor(bottles / packSize) : null;
        const loose = packSize > 1 ? bottles % packSize : null;
        return (
          <div className="flex flex-col">
            <Badge variant={bottles <= row.reorderLevel ? "destructive" : "secondary"}>
              {bottles} btl{bottles !== 1 ? "s" : ""}
            </Badge>
            {packs !== null && (
              <span className="text-xs text-muted-foreground mt-0.5">
                {packs} pack{packs !== 1 ? "s" : ""}{loose ? ` + ${loose}` : ""}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={row.active ? "default" : "secondary"}>
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Item Catalog"
        description="Manage your wines, spirits, and products"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => syncVatFromCategories.mutate()} disabled={syncVatFromCategories.isPending} data-testid="button-sync-vat">
              <RefreshCw className={`w-4 h-4 mr-1 ${syncVatFromCategories.isPending ? "animate-spin" : ""}`} /> Sync VAT
            </Button>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)} data-testid="button-import-items">
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
            <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-new-category">
                  <Plus className="w-4 h-4 mr-1" /> Category
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Category</DialogTitle>
                </DialogHeader>
                <CategoryForm onSubmit={(d) => createCategory.mutate(d)} isPending={createCategory.isPending} categories={categories} />
              </DialogContent>
            </Dialog>
            <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-item">
                  <Plus className="w-4 h-4 mr-1" /> New Item
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>New Item</DialogTitle>
                </DialogHeader>
                <ItemForm onSubmit={(d) => createItem.mutate(d)} isPending={createItem.isPending} categories={categories} priceLevelNames={priceLevelNames} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-items"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DataTable columns={columns} data={filtered} isLoading={itemsLoading} emptyMessage="No items found" onRowClick={handleRowClick} />
        </CardContent>
      </Card>

      {stockSuggestions.length > 0 && (
        <Card>
          <CardHeader
            className="p-4 pb-0 cursor-pointer select-none"
            onClick={() => setStockSuggestionsOpen(v => !v)}
            data-testid="button-toggle-stock-suggestions"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <CardTitle className="text-sm font-semibold">Stock Suggestions</CardTitle>
                <Badge variant="destructive" className="text-xs px-1.5 py-0">{stockSuggestions.length}</Badge>
              </div>
              {stockSuggestionsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
            <p className="text-xs text-muted-foreground mt-1 mb-3">Items at or below reorder level — suggested order covers {weeksOfCover} week{weeksOfCover !== 1 ? "s" : ""} based on last 60 days of sales</p>
          </CardHeader>
          {stockSuggestionsOpen && (
            <CardContent className="p-4 pt-2">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground w-4"></th>
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Item</th>
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground hidden sm:table-cell">Category</th>
                      <th className="text-right py-2 pr-4 font-medium text-muted-foreground">In Stock</th>
                      <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Reorder At</th>
                      <th className="text-right py-2 pr-4 font-medium text-muted-foreground hidden md:table-cell">Avg/Month</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">Suggested Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockSuggestions.map(s => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors" data-testid={`row-stock-suggestion-${s.id}`}>
                        <td className="py-2 pr-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${s.urgency === "critical" ? "bg-destructive" : s.urgency === "warning" ? "bg-amber-500" : "bg-blue-400"}`} title={s.urgency} />
                        </td>
                        <td className="py-2 pr-4">
                          <p className="font-medium">{s.name}</p>
                          <p className="text-muted-foreground">{s.sku}</p>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground hidden sm:table-cell">{s.categoryName || "—"}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          <span className={s.stockQuantity <= 0 ? "text-destructive font-medium" : s.urgency === "warning" ? "text-amber-600 dark:text-amber-400 font-medium" : "font-medium"}>
                            {s.stockQuantity}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{s.reorderLevel}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground hidden md:table-cell">{s.avgMonthly > 0 ? s.avgMonthly : "—"}</td>
                        <td className="py-2 text-right tabular-nums">
                          {s.suggestedOrder > 0 ? (
                            <span className="font-medium text-primary">
                              {s.suggestedOrder}
                              {s.packSize > 1 && (
                                <span className="block text-muted-foreground font-normal text-[10px] leading-tight">
                                  = {Math.ceil(s.suggestedOrder / s.packSize)} pack{Math.ceil(s.suggestedOrder / s.packSize) !== 1 ? "s" : ""} of {s.packSize}
                                </span>
                              )}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {categories.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Categories</h3>
              <span className="text-xs text-muted-foreground">{categories.length} categories</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{cat.name}</span>
                    {cat.description && <span className="text-xs text-muted-foreground truncate">{cat.description}</span>}
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    {cat.vatRate != null && cat.vatRate !== "" ? (
                      <Badge variant="outline" className="text-xs">{parseFloat(cat.vatRate)}% VAT</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">No VAT override</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      data-testid={`button-edit-category-${cat.id}`}
                      onClick={() => { setEditingCategory(cat); setEditCategoryDialogOpen(true); }}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Items from Excel"
        description="Upload an Excel or CSV file to bulk import products into your catalog"
        fields={itemImportFields}
        apiEndpoint="/api/items/import"
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/items"] })}
      />

      <Dialog open={editCategoryDialogOpen} onOpenChange={(open) => { setEditCategoryDialogOpen(open); if (!open) setEditingCategory(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Category</DialogTitle>
          </DialogHeader>
          {editingCategory && (
            <CategoryForm
              onSubmit={(d) => updateCategory.mutate(d)}
              isPending={updateCategory.isPending}
              categories={categories.filter((c) => c.id !== editingCategory.id)}
              defaultValues={{
                name: editingCategory.name,
                description: editingCategory.description || "",
                parentId: editingCategory.parentId || "",
                vatRate: editingCategory.vatRate != null ? String(parseFloat(editingCategory.vatRate)) : "",
                active: editingCategory.active,
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingItem(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <ItemForm
              onSubmit={(d) => updateItem.mutate(d)}
              isPending={updateItem.isPending}
              categories={categories}
              priceLevelNames={priceLevelNames}
              itemId={editingItem.id}
              defaultValues={{
                name: editingItem.name,
                sku: editingItem.sku,
                barcode: editingItem.barcode || "",
                description: editingItem.description || "",
                categoryId: editingItem.categoryId || "",
                unitType: editingItem.unitType,
                packSize: editingItem.packSize,
                price1: editingItem.price1,
                price2: editingItem.price2,
                price3: editingItem.price3,
                price4: editingItem.price4,
                price5: editingItem.price5,
                costPrice: editingItem.costPrice,
                vatRate: (editingItem as any).vatRate ?? null,
                stockQuantity: editingItem.stockQuantity,
                reorderLevel: editingItem.reorderLevel,
                volume: editingItem.volume || "",
                alcoholPercentage: editingItem.alcoholPercentage || "",
                brand: editingItem.brand || "",
                origin: editingItem.origin || "",
                vintage: editingItem.vintage || "",
                active: editingItem.active,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PriceHistoryTab({ itemId }: { itemId: string }) {
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    const qs = params.toString();
    return `/api/items/${itemId}/price-history${qs ? `?${qs}` : ""}`;
  };

  const { data: history = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/items", itemId, "price-history", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(buildUrl());
      if (!res.ok) throw new Error("Failed to load price history");
      return res.json();
    },
  });

  const filtered = customerFilter
    ? history.filter((r) => r.customerName.toLowerCase().includes(customerFilter.toLowerCase()))
    : history;

  const hasDateFilter = dateFrom || dateTo;

  const exportCsv = () => {
    const headers = ["Customer", "Invoice #", "Date", "Qty", "Unit Price", "Discount %"];
    const rows = filtered.map((row) => [
      row.customerName,
      row.invoiceNumber,
      row.date,
      row.quantity,
      parseFloat(row.unitPrice).toFixed(2),
      parseFloat(row.discountPercent).toFixed(2),
    ]);
    const csvContent = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "price-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3 mt-4" data-testid="price-history-tab">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter by customer..."
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-price-history-customer-filter"
            />
          </div>
          {customerFilter && (
            <Button variant="ghost" size="sm" onClick={() => setCustomerFilter("")} className="h-8 px-2 text-xs">
              Clear
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Date range:</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 text-xs w-[140px]"
            data-testid="input-price-history-date-from"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 text-xs w-[140px]"
            data-testid="input-price-history-date-to"
          />
          {hasDateFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }} className="h-8 px-2 text-xs">
              Clear dates
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading price history...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground" data-testid="price-history-empty">
          <History className="w-8 h-8 opacity-40" />
          <p className="text-sm">{customerFilter ? "No results matching that customer." : hasDateFilter ? "No sales history found for this date range." : "No sales history found for this item."}</p>
        </div>
      ) : (
        <div className="border rounded-md overflow-auto max-h-64">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Invoice #</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs text-right">Qty</TableHead>
                <TableHead className="text-xs text-right">Unit Price</TableHead>
                <TableHead className="text-xs text-right">Disc %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, i) => (
                <TableRow key={`${row.invoiceId}-${i}`} data-testid={`price-history-row-${i}`}>
                  <TableCell className="text-xs font-medium">{row.customerName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.invoiceNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.date}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{row.quantity}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">€{parseFloat(row.unitPrice).toFixed(2)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {parseFloat(row.discountPercent) > 0 ? (
                      <Badge variant="secondary" className="text-xs px-1 py-0">{parseFloat(row.discountPercent).toFixed(1)}%</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
          </p>
          <Button variant="outline" size="sm" onClick={exportCsv} className="h-7 text-xs gap-1" data-testid="button-export-price-history-csv">
            <Download className="w-3 h-3" />
            Export CSV
          </Button>
        </div>
      )}
    </div>
  );
}

const variantFormSchema = insertItemVariantSchema.omit({ itemId: true }).extend({
  sku: z.string().min(1, "SKU is required"),
});

function VariantForm({ onSubmit, isPending, priceLevelNames, defaultValues }: { onSubmit: (d: any) => void; isPending: boolean; priceLevelNames: string[]; defaultValues?: any }) {
  const form = useForm({
    resolver: zodResolver(variantFormSchema),
    defaultValues: defaultValues || {
      sku: "", barcode: "", option1Name: "", option1Value: "", option2Name: "", option2Value: "", option3Name: "", option3Value: "",
      price1: null, price2: null, price3: null, price4: null, price5: null, costPrice: null,
      stockQuantity: 0, reorderLevel: null, active: true,
    },
  });

  const { data: colorOptions = [] } = useQuery<Color[]>({ queryKey: ["/api/colors"] });
  const { data: sizeOptions = [] } = useQuery<Size[]>({ queryKey: ["/api/sizes"] });

  const optionValueField = (n: number, optName: string) => {
    const normalized = optName.trim().toLowerCase();
    if (normalized === "color" || normalized === "colour") {
      return (
        <FormField control={form.control} name={`option${n}Value` as any} render={({ field }) => (
          <FormItem>
            <Select value={field.value || ""} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger data-testid={`select-variant-option${n}-value`}>
                  <SelectValue placeholder="Select color" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {colorOptions.filter(c => c.active).map((c) => (
                  <SelectItem key={c.id} value={c.name}>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full border inline-block" style={{ backgroundColor: c.hexCode || "#e5e5e5" }} />
                      {c.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )} />
      );
    }
    if (normalized === "size") {
      return (
        <FormField control={form.control} name={`option${n}Value` as any} render={({ field }) => (
          <FormItem>
            <Select value={field.value || ""} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger data-testid={`select-variant-option${n}-value`}>
                  <SelectValue placeholder="Select size" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {sizeOptions.filter(s => s.active).map((s) => (
                  <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )} />
      );
    }
    return (
      <FormField control={form.control} name={`option${n}Value` as any} render={({ field }) => (
        <FormItem>
          <FormControl><Input {...field} value={field.value || ""} placeholder="Value" data-testid={`input-variant-option${n}-value`} /></FormControl>
        </FormItem>
      )} />
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="sku" render={({ field }) => (
            <FormItem>
              <FormLabel>Variant SKU</FormLabel>
              <FormControl><Input {...field} data-testid="input-variant-sku" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="barcode" render={({ field }) => (
            <FormItem>
              <FormLabel>Variant Barcode</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-variant-barcode" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <p className="text-sm text-muted-foreground">Options (e.g. Color / Size / Textile) — Color and Size values are pulled from the Colors &amp; Sizes master lists</p>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((n) => {
            const optName = form.watch(`option${n}Name` as any) || "";
            return (
              <div key={n} className="space-y-2">
                <FormField control={form.control} name={`option${n}Name` as any} render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Option {n} Name</FormLabel>
                    <FormControl><Input {...field} value={field.value || ""} placeholder={n === 1 ? "Color" : n === 2 ? "Size" : "Textile"} data-testid={`input-variant-option${n}-name`} /></FormControl>
                  </FormItem>
                )} />
                {optionValueField(n, optName)}
              </div>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">Price overrides (leave blank to inherit from base item)</p>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5].map((level) => (
            <FormField key={level} control={form.control} name={`price${level}` as any} render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">{priceLevelNames[level - 1] || `Price ${level}`}</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" placeholder="inherit" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)} data-testid={`input-variant-price-${level}`} />
                </FormControl>
              </FormItem>
            )} />
          ))}
          <FormField control={form.control} name="costPrice" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Cost Price</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="inherit" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)} data-testid="input-variant-cost-price" />
              </FormControl>
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="stockQuantity" render={({ field }) => (
            <FormItem>
              <FormLabel>Stock Quantity</FormLabel>
              <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-variant-stock" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="reorderLevel" render={({ field }) => (
            <FormItem>
              <FormLabel>Reorder Level</FormLabel>
              <FormControl>
                <Input type="number" placeholder="inherit" {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value === "" ? null : parseInt(e.target.value) || 0)} data-testid="input-variant-reorder" />
              </FormControl>
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isPending} data-testid="button-save-variant">
            {isPending ? "Saving..." : "Save Variant"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function VariantsTab({ itemId, priceLevelNames }: { itemId: string; priceLevelNames: string[] }) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ItemVariant | null>(null);

  const { data: variants = [], isLoading } = useQuery<ItemVariant[]>({ queryKey: ["/api/items", itemId, "variants"] });

  const createVariant = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/items/${itemId}/variants`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items", itemId, "variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      setDialogOpen(false);
      toast({ title: "Variant created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateVariant = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/item-variants/${editingVariant!.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items", itemId, "variants"] });
      setDialogOpen(false);
      setEditingVariant(null);
      toast({ title: "Variant updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteVariant = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/item-variants/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items", itemId, "variants"] });
      toast({ title: "Variant deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const describeOptions = (v: ItemVariant) => {
    const parts = [];
    if (v.option1Value) parts.push(`${v.option1Name || "Opt1"}: ${v.option1Value}`);
    if (v.option2Value) parts.push(`${v.option2Name || "Opt2"}: ${v.option2Value}`);
    if (v.option3Value) parts.push(`${v.option3Name || "Opt3"}: ${v.option3Value}`);
    return parts.join(" · ") || "—";
  };

  return (
    <div className="space-y-3 mt-4" data-testid="variants-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Track separate SKU, barcode, price and stock per variant (color, size, textile, quality...)</p>
        <Button type="button" size="sm" onClick={() => { setEditingVariant(null); setDialogOpen(true); }} data-testid="button-add-variant">
          <Plus className="w-3.5 h-3.5 mr-1" />Add Variant
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading variants...</p>
      ) : variants.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground" data-testid="variants-empty">
          <Layers className="w-8 h-8 opacity-40" />
          <p className="text-sm">No variants yet. Add one to start tracking per-variant stock and pricing.</p>
        </div>
      ) : (
        <div className="border rounded-md overflow-auto max-h-72">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Barcode</TableHead>
                <TableHead className="text-xs">Options</TableHead>
                <TableHead className="text-xs text-right">Stock</TableHead>
                <TableHead className="text-xs text-right">Price 1</TableHead>
                <TableHead className="text-xs"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id} data-testid={`variant-row-${v.id}`}>
                  <TableCell className="text-xs font-medium">{v.sku}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.barcode || "—"}</TableCell>
                  <TableCell className="text-xs">{describeOptions(v)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{v.stockQuantity}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{v.price1 != null ? parseFloat(v.price1 as any).toFixed(2) : "inherit"}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingVariant(v); setDialogOpen(true); }} data-testid={`button-edit-variant-${v.id}`}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm("Delete this variant?")) deleteVariant.mutate(v.id); }} data-testid={`button-delete-variant-${v.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingVariant(null); }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingVariant ? "Edit Variant" : "Add Variant"}</DialogTitle>
          </DialogHeader>
          <VariantForm
            key={editingVariant?.id || "new"}
            onSubmit={(d) => editingVariant ? updateVariant.mutate(d) : createVariant.mutate(d)}
            isPending={createVariant.isPending || updateVariant.isPending}
            priceLevelNames={priceLevelNames}
            defaultValues={editingVariant ? {
              sku: editingVariant.sku,
              barcode: editingVariant.barcode || "",
              option1Name: editingVariant.option1Name || "",
              option1Value: editingVariant.option1Value || "",
              option2Name: editingVariant.option2Name || "",
              option2Value: editingVariant.option2Value || "",
              option3Name: editingVariant.option3Name || "",
              option3Value: editingVariant.option3Value || "",
              price1: editingVariant.price1,
              price2: editingVariant.price2,
              price3: editingVariant.price3,
              price4: editingVariant.price4,
              price5: editingVariant.price5,
              costPrice: editingVariant.costPrice,
              stockQuantity: editingVariant.stockQuantity,
              reorderLevel: editingVariant.reorderLevel,
              active: editingVariant.active,
            } : undefined}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function validateEan13(barcode: string): { valid: boolean; expected?: number } {
  const bc = barcode.replace(/\s/g, "");
  if (!/^\d{13}$/.test(bc)) return { valid: true }; // not 13-digit, skip check digit validation
  const sum = bc.split("").slice(0, 12).reduce((acc, d, i) => acc + parseInt(d) * (i % 2 === 0 ? 1 : 3), 0);
  const expected = (10 - (sum % 10)) % 10;
  return { valid: expected === parseInt(bc[12]), expected };
}

function BarcodesTab({ itemId }: { itemId: string }) {
  const { toast } = useToast();
  const [newBarcode, setNewBarcode] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newIsPrimary, setNewIsPrimary] = useState(false);
  const [ean13Error, setEan13Error] = useState<string | null>(null);

  const { data: barcodes = [], isLoading } = useQuery<ItemBarcode[]>({
    queryKey: ["/api/items", itemId, "barcodes"],
    queryFn: async () => { const r = await apiRequest("GET", `/api/items/${itemId}/barcodes`); return r.json(); },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const bc = newBarcode.trim();
      if (!bc) throw new Error("Enter a barcode");
      const validation = validateEan13(bc);
      if (!validation.valid) throw new Error(`Invalid EAN-13 check digit — expected ${validation.expected}`);
      const res = await apiRequest("POST", `/api/items/${itemId}/barcodes`, { barcode: bc, country: newCountry.trim() || null, note: newNote.trim() || null, isPrimary: newIsPrimary });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items", itemId, "barcodes"] });
      setNewBarcode(""); setNewCountry(""); setNewNote(""); setNewIsPrimary(false); setEan13Error(null);
      toast({ title: "Barcode added" });
    },
    onError: (e: Error) => toast({ title: "Cannot add barcode", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/item-barcodes/${id}`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/items", itemId, "barcodes"] }); toast({ title: "Barcode removed" }); },
    onError: (e: Error) => toast({ title: "Cannot remove", description: e.message, variant: "destructive" }),
  });

  const handleBarcodeInput = (val: string) => {
    setNewBarcode(val);
    const bc = val.trim();
    if (bc.length === 13 && /^\d{13}$/.test(bc)) {
      const v = validateEan13(bc);
      setEan13Error(v.valid ? null : `Invalid EAN-13 check digit — expected ${v.expected}`);
    } else {
      setEan13Error(null);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="text-sm text-muted-foreground">
        Add all EAN-13 barcodes this product carries across different countries of manufacture. Any registered barcode will resolve to this item when scanned.
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : barcodes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No alternate barcodes registered yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Barcode</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Note</TableHead>
              <TableHead></TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {barcodes.map(bc => (
              <TableRow key={bc.id} data-testid={`row-itembarcode-${bc.id}`}>
                <TableCell className="font-mono text-sm">
                  {bc.barcode}
                  {bc.isPrimary && <Badge variant="secondary" className="ml-2 text-[10px]"><Star className="w-2.5 h-2.5 mr-0.5" />Primary</Badge>}
                </TableCell>
                <TableCell className="text-sm">{bc.country ? <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" />{bc.country}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{bc.note || "—"}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 w-7 p-0"
                    onClick={() => deleteMutation.mutate(bc.id)} data-testid={`button-delete-barcode-${bc.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="border rounded-md p-3 space-y-2 bg-muted/30">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add barcode</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Barcode (EAN-13 or other)</Label>
            <Input value={newBarcode} onChange={e => handleBarcodeInput(e.target.value)} placeholder="e.g. 5000157015363"
              className={ean13Error ? "border-destructive" : ""} data-testid="input-new-barcode" />
            {ean13Error && <p className="text-xs text-destructive mt-1">{ean13Error}</p>}
          </div>
          <div>
            <Label className="text-xs">Country (optional)</Label>
            <Input value={newCountry} onChange={e => setNewCountry(e.target.value)} placeholder="e.g. UK, Germany, Greece" data-testid="input-barcode-country" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="e.g. Old label, promotional pack" data-testid="input-barcode-note" />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <input type="checkbox" id="isPrimary" checked={newIsPrimary} onChange={e => setNewIsPrimary(e.target.checked)} data-testid="checkbox-barcode-primary" />
            <label htmlFor="isPrimary" className="text-xs cursor-pointer">Mark as primary</label>
            <Button size="sm" className="ml-auto" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !!ean13Error} data-testid="button-add-barcode">
              <Plus className="w-3.5 h-3.5 mr-1" />Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemForm({ onSubmit, isPending, categories, defaultValues, priceLevelNames, itemId }: { onSubmit: (d: any) => void; isPending: boolean; categories: Category[]; defaultValues?: any; priceLevelNames: string[]; itemId?: string }) {
  const isEditing = !!defaultValues;
  const form = useForm({
    resolver: zodResolver(itemFormSchema),
    defaultValues: defaultValues || {
      name: "", sku: "", barcode: "", description: "", categoryId: "", unitType: "pc", packSize: 1,
      price1: "0", price2: "0", price3: "0", price4: "0", price5: "0", costPrice: "0", vatRate: null,
      stockQuantity: 0, reorderLevel: 10, volume: "", alcoholPercentage: "", brand: "", origin: "", vintage: "", active: true,
    },
  });

  const categoryId = form.watch("categoryId");
  const currentSku = form.watch("sku");

  const suggestSku = useCallback(async (catId: string) => {
    if (!catId || isEditing) return;
    try {
      const resp = await fetch(`/api/items/suggest-sku/${catId}`);
      if (resp.ok) {
        const { sku } = await resp.json();
        if (!currentSku || currentSku === "" || currentSku.match(/^[A-Z]{1,3}-\d{3}$/)) {
          form.setValue("sku", sku);
        }
      }
    } catch {}
  }, [form, isEditing, currentSku]);

  useEffect(() => {
    if (categoryId && !isEditing) {
      suggestSku(categoryId);
    }
  }, [categoryId, isEditing, suggestSku]);

  useEffect(() => {
    if (!categoryId) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat || cat.vatRate == null || cat.vatRate === "") return;
    const catRate = String(parseFloat(cat.vatRate));
    // Always sync when category changes; also fill in when editing and item has no rate set
    const currentVat = form.getValues("vatRate");
    if (!currentVat || currentVat === "" || currentVat === null) {
      form.setValue("vatRate", catRate);
    } else {
      // Category actively changed by user — update to match new category
      form.setValue("vatRate", catRate);
    }
  }, [categoryId]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Tabs defaultValue="basic">
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1" data-testid="tab-basic">Basic</TabsTrigger>
            <TabsTrigger value="pricing" className="flex-1" data-testid="tab-pricing">Pricing</TabsTrigger>
            <TabsTrigger value="details" className="flex-1" data-testid="tab-details">Details</TabsTrigger>
            {itemId && (
              <TabsTrigger value="variants" className="flex-1" data-testid="tab-variants">
                <Layers className="w-3.5 h-3.5 mr-1" />Variants
              </TabsTrigger>
            )}
            {itemId && (
              <TabsTrigger value="price-history" className="flex-1" data-testid="tab-price-history">
                <History className="w-3.5 h-3.5 mr-1" />History
              </TabsTrigger>
            )}
            {itemId && (
              <TabsTrigger value="barcodes" className="flex-1" data-testid="tab-barcodes">
                <Barcode className="w-3.5 h-3.5 mr-1" />Barcodes
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-item-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sku" render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl><Input {...field} data-testid="input-item-sku" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="barcode" render={({ field }) => (
                <FormItem>
                  <FormLabel>Barcode</FormLabel>
                  <FormControl><Input {...field} value={field.value || ""} data-testid="input-item-barcode" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="categoryId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-item-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="unitType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-unit-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pc">Piece</SelectItem>
                      <SelectItem value="pack">Pack</SelectItem>
                      <SelectItem value="case">Case</SelectItem>
                      <SelectItem value="bottle">Bottle</SelectItem>
                      <SelectItem value="kg">Kilogram (kg)</SelectItem>
                      <SelectItem value="lt">Litre (lt)</SelectItem>
                      <SelectItem value="gr">Gram (gr)</SelectItem>
                      <SelectItem value="ml">Millilitre (ml)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="packSize" render={({ field }) => (
                <FormItem>
                  <FormLabel>Pack Size</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                      data-testid="input-pack-size"
                    />
                  </FormControl>
                  <FormDescription>Enter any whole number ≥ 1 (e.g. 2, 4, 6, 9, 18)</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-item-description" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </TabsContent>
          <TabsContent value="pricing" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">Set up to 5 price levels for different customer tiers</p>
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4, 5].map((level) => (
                <FormField key={level} control={form.control} name={`price${level}` as any} render={({ field }) => (
                  <FormItem>
                    <FormLabel>{priceLevelNames[level - 1] || `Price Level ${level}`}</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid={`input-price-${level}`} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              ))}
              <FormField control={form.control} name="costPrice" render={({ field }) => (
                <FormItem>
                  <FormLabel>Cost Price</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} data-testid="input-cost-price" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="vatRate" render={({ field }) => {
              const catId = form.watch("categoryId");
              const cat = categories.find((c) => c.id === catId);
              const inheritLabel = cat?.vatRate != null
                ? `Inherit from category (${parseFloat(cat.vatRate)}%)`
                : "Inherit from category";
              return (
                <FormItem>
                  <FormLabel>VAT Rate</FormLabel>
                  <Select
                    value={field.value ?? "inherit"}
                    onValueChange={(v) => field.onChange(v === "inherit" ? null : v)}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-vat-rate">
                        <SelectValue placeholder={inheritLabel} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="inherit">{inheritLabel}</SelectItem>
                      {CY_VAT_RATES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              );
            }} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="stockQuantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock Quantity (bottles)</FormLabel>
                  <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-stock" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="reorderLevel" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reorder Level</FormLabel>
                  <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-reorder" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </TabsContent>
          <TabsContent value="details" className="space-y-4 mt-4">
            <FormField control={form.control} name="brand" render={({ field }) => (
              <FormItem>
                <FormLabel>Brand / Producer</FormLabel>
                <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Château Margaux, Macallan" data-testid="input-brand" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="volume" render={({ field }) => (
                <FormItem>
                  <FormLabel>Volume (e.g. 750ml)</FormLabel>
                  <FormControl><Input {...field} value={field.value || ""} data-testid="input-volume" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="alcoholPercentage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Alcohol %</FormLabel>
                  <FormControl><Input type="number" step="0.1" {...field} value={field.value || ""} data-testid="input-alcohol" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="origin" render={({ field }) => (
                <FormItem>
                  <FormLabel>Origin / Region</FormLabel>
                  <FormControl><Input {...field} value={field.value || ""} data-testid="input-origin" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="vintage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Vintage</FormLabel>
                  <FormControl><Input {...field} value={field.value || ""} data-testid="input-vintage" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </TabsContent>
          {itemId && (
            <TabsContent value="variants">
              <VariantsTab itemId={itemId} priceLevelNames={priceLevelNames} />
            </TabsContent>
          )}
          {itemId && (
            <TabsContent value="price-history">
              <PriceHistoryTab itemId={itemId} />
            </TabsContent>
          )}
          {itemId && (
            <TabsContent value="barcodes">
              <BarcodesTab itemId={itemId} />
            </TabsContent>
          )}
        </Tabs>
        <div className="flex justify-end gap-2 pt-4">
          <Button type="submit" disabled={isPending} data-testid="button-save-item">
            {isPending ? "Saving..." : "Save Item"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function CategoryForm({ onSubmit, isPending, categories, defaultValues }: { onSubmit: (d: any) => void; isPending: boolean; categories: Category[]; defaultValues?: any }) {
  const form = useForm({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: defaultValues || { name: "", description: "", parentId: "", vatRate: "", active: true },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input {...field} data-testid="input-category-name" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-category-description" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="parentId" render={({ field }) => (
            <FormItem>
              <FormLabel>Parent Category (optional)</FormLabel>
              <Select value={field.value || ""} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-parent-category">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="vatRate" render={({ field }) => (
            <FormItem>
              <FormLabel>Default VAT Rate</FormLabel>
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-category-vat-rate">
                    <SelectValue placeholder="Inherit from item" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="inherit">No override</SelectItem>
                  {CY_VAT_RATES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-category">
            {isPending ? "Saving..." : "Save Category"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
