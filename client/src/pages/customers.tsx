import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertCustomerSchema, type Customer } from "@shared/schema";
import { z } from "zod";

const customerFormSchema = insertCustomerSchema.extend({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
});

export default function Customers() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: customers = [], isLoading } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });

  const createCustomer = useMutation({
    mutationFn: async (data: z.infer<typeof customerFormSchema>) => {
      const res = await apiRequest("POST", "/api/customers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      setDialogOpen(false);
      toast({ title: "Customer created successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())
  );

  const paymentTermsLabel: Record<string, string> = {
    cash: "Cash", credit_7: "7 Days", credit_14: "14 Days", credit_30: "30 Days", credit_60: "60 Days", credit_90: "90 Days",
  };

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.code}</p>
          </div>
        </div>
      ),
    },
    { key: "city", header: "City", cell: (row) => <span className="text-sm">{row.city || "-"}</span> },
    {
      key: "terms",
      header: "Terms",
      cell: (row) => <Badge variant="secondary">{paymentTermsLabel[row.paymentTerms] || row.paymentTerms}</Badge>,
    },
    {
      key: "priceLevel",
      header: "Price Level",
      cell: (row) => <Badge variant="outline">Level {row.priceLevel}</Badge>,
    },
    {
      key: "balance",
      header: "Balance",
      cell: (row) => (
        <span className={`text-sm font-medium ${parseFloat(row.currentBalance) > 0 ? "text-red-500" : ""}`}>
          €{parseFloat(row.currentBalance).toFixed(2)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge variant={row.active ? "default" : "secondary"}>{row.active ? "Active" : "Inactive"}</Badge>,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Customers"
        description="Manage wholesale customer accounts"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-customer"><Plus className="w-4 h-4 mr-1" /> New Customer</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
              <CustomerForm onSubmit={(d) => createCustomer.mutate(d)} isPending={createCustomer.isPending} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-customers" />
          </div>
          <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="No customers found" onRowClick={(c) => navigate(`/customers/${c.id}`)} />
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerForm({ onSubmit, isPending, defaultValues }: { onSubmit: (d: any) => void; isPending: boolean; defaultValues?: any }) {
  const form = useForm({
    resolver: zodResolver(customerFormSchema),
    defaultValues: defaultValues || {
      name: "", code: "", email: "", phone: "", address: "", city: "", taxId: "",
      paymentTerms: "cash", creditLimit: "0", currentBalance: "0", priceLevel: 1, notes: "", active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Business Name</FormLabel>
              <FormControl><Input {...field} data-testid="input-customer-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem>
              <FormLabel>Customer Code</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. CUST001" data-testid="input-customer-code" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input type="email" {...field} value={field.value || ""} data-testid="input-customer-email" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-phone" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="address" render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-customer-address" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="city" render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-city" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="taxId" render={({ field }) => (
            <FormItem>
              <FormLabel>Tax ID</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-taxid" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormField control={form.control} name="paymentTerms" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Terms</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-terms">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit_7">7 Days Credit</SelectItem>
                  <SelectItem value="credit_14">14 Days Credit</SelectItem>
                  <SelectItem value="credit_30">30 Days Credit</SelectItem>
                  <SelectItem value="credit_60">60 Days Credit</SelectItem>
                  <SelectItem value="credit_90">90 Days Credit</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="creditLimit" render={({ field }) => (
            <FormItem>
              <FormLabel>Credit Limit</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} data-testid="input-credit-limit" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="priceLevel" render={({ field }) => (
            <FormItem>
              <FormLabel>Price Level</FormLabel>
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(parseInt(v))}>
                <FormControl>
                  <SelectTrigger data-testid="select-price-level">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((l) => (
                    <SelectItem key={l} value={String(l)}>Level {l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-customer-notes" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-customer">
            {isPending ? "Saving..." : "Save Customer"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export { CustomerForm };
