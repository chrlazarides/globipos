import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Truck, Search, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertSupplierSchema, type Supplier } from "@shared/schema";
import { z } from "zod";

const supplierFormSchema = insertSupplierSchema.extend({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
});

export default function Suppliers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const createSupplier = useMutation({
    mutationFn: async (data: z.infer<typeof supplierFormSchema>) => {
      const res = await apiRequest("POST", "/api/suppliers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setDialogOpen(false);
      toast({ title: "Supplier created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateSupplier = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/suppliers/${editingSupplier?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setEditDialogOpen(false);
      setEditingSupplier(null);
      toast({ title: "Supplier updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setEditDialogOpen(true);
  };

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.code.toLowerCase().includes(search.toLowerCase())
  );

  const columns: Column<Supplier>[] = [
    {
      key: "name",
      header: "Supplier",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Truck className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <div className="text-sm">
          {row.contactPerson && <p>{row.contactPerson}</p>}
          <p className="text-muted-foreground">{row.phone || row.email || "-"}</p>
        </div>
      ),
    },
    {
      key: "paymentTerms",
      header: "Payment Terms",
      cell: (row) => <Badge variant="secondary">{row.paymentTerms.replace("_", " ")}</Badge>,
    },
    {
      key: "balance",
      header: "Balance Owed",
      cell: (row) => {
        const bal = parseFloat(row.currentBalance);
        return (
          <span className={`text-sm font-medium ${bal > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {"\u20AC"}{bal.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge variant={row.active ? "default" : "secondary"}>{row.active ? "Active" : "Inactive"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button size="icon" variant="ghost" onClick={() => handleEdit(row)} data-testid={`button-edit-supplier-${row.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Suppliers"
        description="Manage your wine and spirits suppliers"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-supplier"><Plus className="w-4 h-4 mr-1" /> New Supplier</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Supplier</DialogTitle></DialogHeader>
              <SupplierForm onSubmit={(d) => createSupplier.mutate(d)} isPending={createSupplier.isPending} />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-suppliers" />
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="No suppliers found" />
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Supplier</DialogTitle></DialogHeader>
          {editingSupplier && (
            <SupplierForm
              onSubmit={(d) => updateSupplier.mutate(d)}
              isPending={updateSupplier.isPending}
              defaultValues={{
                name: editingSupplier.name,
                code: editingSupplier.code,
                contactPerson: editingSupplier.contactPerson || "",
                email: editingSupplier.email || "",
                phone: editingSupplier.phone || "",
                address: editingSupplier.address || "",
                city: editingSupplier.city || "",
                taxId: editingSupplier.taxId || "",
                paymentTerms: editingSupplier.paymentTerms,
                notes: editingSupplier.notes || "",
                active: editingSupplier.active,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupplierForm({ onSubmit, isPending, defaultValues }: { onSubmit: (d: any) => void; isPending: boolean; defaultValues?: any }) {
  const form = useForm({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: defaultValues || {
      name: "", code: "", contactPerson: "", email: "", phone: "", address: "", city: "",
      taxId: "", paymentTerms: "cash", currentBalance: "0", notes: "", active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Supplier Name</FormLabel>
              <FormControl><Input {...field} data-testid="input-supplier-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. SUP-001" data-testid="input-supplier-code" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="contactPerson" render={({ field }) => (
          <FormItem>
            <FormLabel>Contact Person</FormLabel>
            <FormControl><Input {...field} value={field.value || ""} data-testid="input-supplier-contact" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-supplier-email" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-supplier-phone" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="address" render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-supplier-address" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="city" render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-supplier-city" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="taxId" render={({ field }) => (
            <FormItem>
              <FormLabel>Tax ID</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-supplier-taxid" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="paymentTerms" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Terms</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-supplier-terms">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit_7">7 Days</SelectItem>
                  <SelectItem value="credit_14">14 Days</SelectItem>
                  <SelectItem value="credit_30">30 Days</SelectItem>
                  <SelectItem value="credit_60">60 Days</SelectItem>
                  <SelectItem value="credit_90">90 Days</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-supplier-notes" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-supplier">
            {isPending ? "Saving..." : "Save Supplier"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
