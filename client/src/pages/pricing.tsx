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
import { Plus, Tag, Pencil, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type PriceContract, type Customer, type Category } from "@shared/schema";
import { z } from "zod";

const contractFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  customerId: z.string().min(1, "Customer is required"),
  startDate: z.string().min(1, "Start date required"),
  endDate: z.string().min(1, "End date required"),
  discountType: z.string().default("percentage"),
  discountValue: z.string().default("0"),
  categoryIds: z.array(z.string()).default([]),
  brands: z.array(z.string()).default([]),
  minQuantity: z.number().default(0),
  active: z.boolean().default(true),
});

interface PriceContractWithCustomer extends PriceContract {
  customerName?: string;
}

export default function Pricing() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<PriceContractWithCustomer | null>(null);
  const { toast } = useToast();

  const { data: contracts = [], isLoading } = useQuery<PriceContractWithCustomer[]>({ queryKey: ["/api/price-contracts"] });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: allBrands = [] } = useQuery<string[]>({ queryKey: ["/api/items/brands"] });

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

  const updateContract = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/price-contracts/${editingContract?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-contracts"] });
      setEditDialogOpen(false);
      setEditingContract(null);
      toast({ title: "Price contract updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleEdit = (contract: PriceContractWithCustomer) => {
    setEditingContract(contract);
    setEditDialogOpen(true);
  };

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
        const catIds = row.categoryIds?.length ? row.categoryIds : (row.categoryId ? [row.categoryId] : []);
        const brandList = row.brands?.length ? row.brands : (row.brand ? [row.brand] : []);
        const catNames = catIds.map(id => categories.find(c => c.id === id)?.name).filter(Boolean);
        const parts: string[] = [...catNames as string[], ...brandList];
        if (parts.length === 0) return <span className="text-sm text-muted-foreground">All Items</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {catNames.map((name, i) => (
              <Badge key={`cat-${i}`} variant="secondary">{name}</Badge>
            ))}
            {brandList.map((b, i) => (
              <Badge key={`brand-${i}`} variant="outline">{b}</Badge>
            ))}
          </div>
        );
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
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button size="icon" variant="ghost" onClick={() => handleEdit(row)} data-testid={`button-edit-contract-${row.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      ),
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
              <ContractForm onSubmit={(d) => createContract.mutate(d)} isPending={createContract.isPending} customers={customers} categories={categories} allBrands={allBrands} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={contracts} isLoading={isLoading} emptyMessage="No price contracts found" />
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Price Contract</DialogTitle></DialogHeader>
          {editingContract && (
            <ContractForm
              key={editingContract.id}
              onSubmit={(d) => updateContract.mutate(d)}
              isPending={updateContract.isPending}
              customers={customers}
              categories={categories}
              allBrands={allBrands}
              defaultValues={{
                name: editingContract.name,
                customerId: editingContract.customerId,
                startDate: editingContract.startDate,
                endDate: editingContract.endDate,
                discountType: editingContract.discountType,
                discountValue: editingContract.discountValue,
                minQuantity: editingContract.minQuantity || 0,
                categoryIds: editingContract.categoryIds?.length ? editingContract.categoryIds : (editingContract.categoryId ? [editingContract.categoryId] : []),
                brands: editingContract.brands?.length ? editingContract.brands : (editingContract.brand ? [editingContract.brand] : []),
                active: editingContract.active,
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MultiSelect({ options, selected, onChange, label }: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  label: string;
}) {
  const remove = (val: string) => {
    onChange(selected.filter(v => v !== val));
  };

  const getLabel = (val: string) => {
    const opt = options.find(o => o.value === val);
    return opt ? opt.label : val;
  };

  const available = options.filter(o => !selected.includes(o.value));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1 min-h-[2rem]">
        {selected.map(val => (
          <Badge key={val} variant="secondary" className="gap-1">
            {getLabel(val)}
            <button type="button" onClick={() => remove(val)} className="ml-0.5 hover:text-destructive" data-testid={`button-remove-${label.toLowerCase()}-${val}`}>
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        {selected.length === 0 && <span className="text-sm text-muted-foreground py-1">All {label}</span>}
      </div>
      <Select value="" onValueChange={(val) => { if (val) onChange([...selected, val]); }}>
        <SelectTrigger data-testid={`select-multi-${label.toLowerCase().replace(/\s/g, "-")}`}>
          <SelectValue placeholder={`Add ${label}...`} />
        </SelectTrigger>
        <SelectContent>
          {available.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
          {available.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No more options</div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function ContractForm({ onSubmit, isPending, customers, categories, allBrands, defaultValues }: {
  onSubmit: (d: any) => void;
  isPending: boolean;
  customers: Customer[];
  categories: Category[];
  allBrands: string[];
  defaultValues?: any;
}) {
  const form = useForm({
    resolver: zodResolver(contractFormSchema),
    defaultValues: defaultValues || {
      name: "", customerId: "", startDate: new Date().toISOString().split("T")[0],
      endDate: "", discountType: "percentage", discountValue: "0", minQuantity: 0,
      categoryIds: [] as string[], brands: [] as string[], active: true,
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
          <FormField control={form.control} name="categoryIds" render={({ field }) => (
            <FormItem>
              <FormLabel>Categories (optional)</FormLabel>
              <MultiSelect
                options={categories.map(c => ({ value: c.id, label: c.name }))}
                selected={field.value || []}
                onChange={field.onChange}
                label="Categories"
              />
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="brands" render={({ field }) => (
            <FormItem>
              <FormLabel>Brands / Producers (optional)</FormLabel>
              <MultiSelect
                options={allBrands.map(b => ({ value: b, label: b }))}
                selected={field.value || []}
                onChange={field.onChange}
                label="Brands"
              />
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
              <FormControl><Input inputMode="decimal" {...field} data-testid="input-discount-value" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="minQuantity" render={({ field }) => (
          <FormItem>
            <FormLabel>Minimum Quantity</FormLabel>
            <FormControl><Input inputMode="numeric" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-min-qty" /></FormControl>
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
