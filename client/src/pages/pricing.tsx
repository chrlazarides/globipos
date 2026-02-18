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
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Tag } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertPriceContractSchema, type PriceContract, type Customer, type Category } from "@shared/schema";
import { z } from "zod";

const contractFormSchema = insertPriceContractSchema.extend({
  name: z.string().min(1, "Name is required"),
  customerId: z.string().min(1, "Customer is required"),
  startDate: z.string().min(1, "Start date required"),
  endDate: z.string().min(1, "End date required"),
});

interface PriceContractWithCustomer extends PriceContract {
  customerName?: string;
}

export default function Pricing() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: contracts = [], isLoading } = useQuery<PriceContractWithCustomer[]>({ queryKey: ["/api/price-contracts"] });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  const createContract = useMutation({
    mutationFn: async (data: z.infer<typeof contractFormSchema>) => {
      const res = await apiRequest("POST", "/api/price-contracts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-contracts"] });
      setDialogOpen(false);
      toast({ title: "Price contract created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const columns: Column<PriceContractWithCustomer>[] = [
    {
      key: "name",
      header: "Contract",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Tag className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.name}</p>
            <p className="text-xs text-muted-foreground">{row.customerName}</p>
          </div>
        </div>
      ),
    },
    {
      key: "scope",
      header: "Applies To",
      cell: (row) => {
        const cat = categories.find((c) => c.id === row.categoryId);
        const parts: string[] = [];
        if (cat) parts.push(cat.name);
        if (row.brand) parts.push(row.brand);
        return <span className="text-sm">{parts.length > 0 ? parts.join(" / ") : "All Items"}</span>;
      },
    },
    {
      key: "discount",
      header: "Discount",
      cell: (row) => (
        <Badge variant="secondary">
          {row.discountType === "percentage" ? `${row.discountValue}%` : `€${row.discountValue}`}
        </Badge>
      ),
    },
    {
      key: "period",
      header: "Period",
      cell: (row) => (
        <span className="text-sm">
          {new Date(row.startDate).toLocaleDateString()} - {new Date(row.endDate).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "minQty",
      header: "Min. Qty",
      cell: (row) => <span className="text-sm">{row.minQuantity || "-"}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const now = new Date();
        const end = new Date(row.endDate);
        const isExpired = end < now;
        return (
          <Badge variant={!row.active ? "secondary" : isExpired ? "destructive" : "default"}>
            {!row.active ? "Inactive" : isExpired ? "Expired" : "Active"}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Price Contracts"
        description="Manage customer-specific pricing agreements"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-contract"><Plus className="w-4 h-4 mr-1" /> New Contract</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Price Contract</DialogTitle></DialogHeader>
              <ContractForm onSubmit={(d) => createContract.mutate(d)} isPending={createContract.isPending} customers={customers} categories={categories} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={contracts} isLoading={isLoading} emptyMessage="No price contracts found" />
        </CardContent>
      </Card>
    </div>
  );
}

function ContractForm({ onSubmit, isPending, customers, categories }: { onSubmit: (d: any) => void; isPending: boolean; customers: Customer[]; categories: Category[] }) {
  const form = useForm({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      name: "", customerId: "", startDate: new Date().toISOString().split("T")[0],
      endDate: "", discountType: "percentage", discountValue: "0", minQuantity: 0,
      categoryId: "", brand: "", active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Contract Name</FormLabel>
            <FormControl><Input {...field} data-testid="input-contract-name" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="customerId" render={({ field }) => (
          <FormItem>
            <FormLabel>Customer</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger data-testid="select-contract-customer">
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="categoryId" render={({ field }) => (
            <FormItem>
              <FormLabel>Category (optional)</FormLabel>
              <Select value={field.value || "__all__"} onValueChange={(v) => field.onChange(v === "__all__" ? "" : v)}>
                <FormControl>
                  <SelectTrigger data-testid="select-contract-category">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__all__">All Categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="brand" render={({ field }) => (
            <FormItem>
              <FormLabel>Brand / Producer (optional)</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Macallan" data-testid="input-contract-brand" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="startDate" render={({ field }) => (
            <FormItem>
              <FormLabel>Start Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-contract-start" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="endDate" render={({ field }) => (
            <FormItem>
              <FormLabel>End Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-contract-end" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="discountType" render={({ field }) => (
            <FormItem>
              <FormLabel>Discount Type</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-discount-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="discountValue" render={({ field }) => (
            <FormItem>
              <FormLabel>Discount Value</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} data-testid="input-discount-value" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="minQuantity" render={({ field }) => (
          <FormItem>
            <FormLabel>Minimum Quantity</FormLabel>
            <FormControl><Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-min-qty" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-contract">
            {isPending ? "Saving..." : "Save Contract"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
