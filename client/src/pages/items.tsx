import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Package, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertItemSchema, insertCategorySchema, type Item, type Category } from "@shared/schema";
import { ImportDialog } from "@/components/import-dialog";
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
  { key: "origin", label: "Origin" },
  { key: "vintage", label: "Vintage" },
];

const itemFormSchema = insertItemSchema.extend({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  price1: z.string().min(1),
});

const categoryFormSchema = insertCategorySchema.extend({
  name: z.string().min(1, "Name is required"),
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

  const { data: items = [], isLoading: itemsLoading } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

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

  const updateItem = useMutation({
    mutationFn: async (data: z.infer<typeof itemFormSchema>) => {
      if (!editingItem) return;
      const res = await apiRequest("PATCH", `/api/items/${editingItem.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      setEditDialogOpen(false);
      setEditingItem(null);
      toast({ title: "Item updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleRowClick = (item: Item) => {
    setEditingItem(item);
    setEditDialogOpen(true);
  };

  const filtered = items.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) || item.sku.toLowerCase().includes(search.toLowerCase());
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
      cell: (row) => <Badge variant="outline">{parseFloat((row as any).vatRate || "19")}%</Badge>,
    },
    {
      key: "price",
      header: "Price L1",
      cell: (row) => <span className="text-sm font-medium">€{parseFloat(row.price1).toFixed(2)}</span>,
    },
    {
      key: "stock",
      header: "Stock",
      cell: (row) => (
        <Badge variant={row.stockQuantity <= row.reorderLevel ? "destructive" : "secondary"}>
          {row.stockQuantity}
        </Badge>
      ),
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
                <ItemForm onSubmit={(d) => createItem.mutate(d)} isPending={createItem.isPending} categories={categories} />
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

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Items from Excel"
        description="Upload an Excel or CSV file to bulk import products into your catalog"
        fields={itemImportFields}
        apiEndpoint="/api/items/import"
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/items"] })}
      />

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
                vatRate: (editingItem as any).vatRate || "19",
                stockQuantity: editingItem.stockQuantity,
                reorderLevel: editingItem.reorderLevel,
                volume: editingItem.volume || "",
                alcoholPercentage: editingItem.alcoholPercentage || "",
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

function ItemForm({ onSubmit, isPending, categories, defaultValues }: { onSubmit: (d: any) => void; isPending: boolean; categories: Category[]; defaultValues?: any }) {
  const form = useForm({
    resolver: zodResolver(itemFormSchema),
    defaultValues: defaultValues || {
      name: "", sku: "", barcode: "", description: "", categoryId: "", unitType: "pc", packSize: 1,
      price1: "0", price2: "0", price3: "0", price4: "0", price5: "0", costPrice: "0", vatRate: "19",
      stockQuantity: 0, reorderLevel: 10, volume: "", alcoholPercentage: "", origin: "", vintage: "", active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Tabs defaultValue="basic">
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1" data-testid="tab-basic">Basic</TabsTrigger>
            <TabsTrigger value="pricing" className="flex-1" data-testid="tab-pricing">Pricing</TabsTrigger>
            <TabsTrigger value="details" className="flex-1" data-testid="tab-details">Details</TabsTrigger>
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
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="packSize" render={({ field }) => (
                <FormItem>
                  <FormLabel>Pack Size</FormLabel>
                  <Select value={String(field.value)} onValueChange={(v) => field.onChange(parseInt(v))}>
                    <FormControl>
                      <SelectTrigger data-testid="select-pack-size">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">1 (Single)</SelectItem>
                      <SelectItem value="3">3-Pack</SelectItem>
                      <SelectItem value="6">6-Pack</SelectItem>
                      <SelectItem value="12">12-Pack</SelectItem>
                      <SelectItem value="24">24-Pack</SelectItem>
                    </SelectContent>
                  </Select>
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
                    <FormLabel>Price Level {level}</FormLabel>
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
            <FormField control={form.control} name="vatRate" render={({ field }) => (
              <FormItem>
                <FormLabel>VAT Rate</FormLabel>
                <Select value={field.value || "19"} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-vat-rate">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="19">19% - Standard</SelectItem>
                    <SelectItem value="9">9% - Reduced</SelectItem>
                    <SelectItem value="5">5% - Reduced</SelectItem>
                    <SelectItem value="0">0% - Zero Rated</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="stockQuantity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock Quantity</FormLabel>
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

function CategoryForm({ onSubmit, isPending, categories }: { onSubmit: (d: any) => void; isPending: boolean; categories: Category[] }) {
  const form = useForm({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: "", description: "", parentId: "", active: true },
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
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-category">
            {isPending ? "Saving..." : "Save Category"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
