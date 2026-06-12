import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Search, Pencil, Layers, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertCategorySchema, type Category } from "@shared/schema";

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

type CategoryFormData = z.infer<typeof categoryFormSchema>;

function CategoryForm({
  onSubmit,
  isPending,
  categories,
  defaultValues,
}: {
  onSubmit: (d: CategoryFormData) => void;
  isPending: boolean;
  categories: Category[];
  defaultValues?: Partial<CategoryFormData>;
}) {
  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: defaultValues || {
      name: "",
      description: "",
      parentId: "",
      vatRate: "inherit",
      active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Category Name</FormLabel>
            <FormControl>
              <Input {...field} placeholder="e.g. Red Wine, Spirits, Soft Drinks" data-testid="input-category-name" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value || ""}
                className="resize-none"
                placeholder="Brief description of this category"
                data-testid="input-category-description"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="parentId" render={({ field }) => (
            <FormItem>
              <FormLabel>Parent Category <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
              <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                <FormControl>
                  <SelectTrigger data-testid="select-parent-category">
                    <SelectValue placeholder="None (top-level)" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None (top-level)</SelectItem>
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
              <Select
                value={field.value ?? "inherit"}
                onValueChange={(v) => field.onChange(v === "inherit" ? null : v)}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-category-vat-rate">
                    <SelectValue placeholder="No override" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="inherit">No override (item decides)</SelectItem>
                  {CY_VAT_RATES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="active" render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-category-active" />
            </FormControl>
            <FormLabel className="!mt-0">Active</FormLabel>
          </FormItem>
        )} />

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPending} data-testid="button-save-category">
            {isPending ? "Saving..." : "Save Category"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function Categories() {
  const [search, setSearch] = useState("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const { toast } = useToast();

  const { data: categories = [], isLoading } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  const createCategory = useMutation({
    mutationFn: async (data: CategoryFormData) => {
      const payload = { ...data, parentId: data.parentId || null, vatRate: data.vatRate === "inherit" ? null : (data.vatRate ?? null) };
      const res = await apiRequest("POST", "/api/categories", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setNewDialogOpen(false);
      toast({ title: "Category created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateCategory = useMutation({
    mutationFn: async (data: CategoryFormData) => {
      if (!editingCategory) return;
      const payload = { ...data, parentId: data.parentId || null, vatRate: data.vatRate === "inherit" ? null : (data.vatRate ?? null) };
      const res = await apiRequest("PATCH", `/api/categories/${editingCategory.id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingCategory(null);
      toast({ title: "Category updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description || "").toLowerCase().includes(search.toLowerCase())
  );

  const topLevel = filtered.filter((c) => !c.parentId);
  const children = (parentId: string) => filtered.filter((c) => c.parentId === parentId);

  const getVatLabel = (vatRate: string | null | undefined) => {
    if (vatRate == null || vatRate === "") return null;
    const rate = parseFloat(vatRate);
    const found = CY_VAT_RATES.find((r) => parseFloat(r.value) === rate);
    return found ? `${rate}%` : `${rate}%`;
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Categories"
        description="Manage product categories with VAT rate defaults"
        action={
          <Button onClick={() => setNewDialogOpen(true)} data-testid="button-new-category">
            <Plus className="w-4 h-4 mr-1" /> New Category
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search categories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-categories"
            />
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading categories...</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Layers className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">
                {search ? "No categories match your search." : "No categories yet. Create your first one."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>VAT Rate</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topLevel.map((cat) => (
                  <>
                    <TableRow key={cat.id} className="group" data-testid={`row-category-${cat.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium">
                          <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
                          {cat.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {cat.description || "—"}
                      </TableCell>
                      <TableCell>
                        {getVatLabel(cat.vatRate) ? (
                          <Badge variant="outline">{getVatLabel(cat.vatRate)} VAT</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">No override</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cat.active ? "default" : "secondary"}>
                          {cat.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          data-testid={`button-edit-category-${cat.id}`}
                          onClick={() => setEditingCategory(cat)}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                    {children(cat.id).map((child) => (
                      <TableRow key={child.id} className="group bg-muted/30" data-testid={`row-category-${child.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2 pl-6 text-sm">
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            {child.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                          {child.description || "—"}
                        </TableCell>
                        <TableCell>
                          {getVatLabel(child.vatRate) ? (
                            <Badge variant="outline">{getVatLabel(child.vatRate)} VAT</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">No override</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={child.active ? "default" : "secondary"}>
                            {child.active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2"
                            data-testid={`button-edit-category-${child.id}`}
                            onClick={() => setEditingCategory(child)}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New Category Dialog */}
      <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Category</DialogTitle>
          </DialogHeader>
          <CategoryForm
            onSubmit={(d) => createCategory.mutate(d)}
            isPending={createCategory.isPending}
            categories={categories}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Category Dialog */}
      <Dialog open={!!editingCategory} onOpenChange={(open) => { if (!open) setEditingCategory(null); }}>
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
                vatRate: editingCategory.vatRate != null ? String(parseFloat(editingCategory.vatRate)) : "inherit",
                active: editingCategory.active,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
