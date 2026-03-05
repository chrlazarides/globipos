import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Tag, Pencil, X, Trash2, ArrowLeft, AlertTriangle, CheckCircle, Gift } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type PriceContract, type PriceContractRule, type Customer, type Category, type Item } from "@shared/schema";
import { z } from "zod";

const contractFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  customerId: z.string().min(1, "Customer is required"),
  startDate: z.string().min(1, "Start date required"),
  endDate: z.string().min(1, "End date required"),
  purchaseGoal: z.string().default("0"),
  voucherType: z.string().default("percentage"),
  voucherValue: z.string().default("0"),
  active: z.boolean().default(true),
});

interface ContractWithMeta extends PriceContract {
  customerName?: string;
  priceLevel?: number;
}

interface RuleRow {
  id?: string;
  categoryIds: string[];
  brands: string[];
  minQuantity: number;
  discountType: string;
  discountValue: string;
}

function getPriceByLevel(item: Item, level: number): number {
  const prices: Record<number, string> = {
    1: item.price1, 2: item.price2, 3: item.price3, 4: item.price4, 5: item.price5,
  };
  return parseFloat(prices[level] || item.price1) || 0;
}

function getRetailPrice(item: Item): number {
  return parseFloat(item.price1) || 0;
}

function calcDiscountedPrice(retailPrice: number, discountType: string, discountValue: number): number {
  if (discountType === "percentage") {
    return retailPrice * (1 - discountValue / 100);
  }
  return retailPrice - discountValue;
}

export default function Pricing() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: contracts = [], isLoading } = useQuery<ContractWithMeta[]>({ queryKey: ["/api/price-contracts"] });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: allBrands = [] } = useQuery<string[]>({ queryKey: ["/api/items/brands"] });
  const { data: allItems = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });

  const createContract = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/price-contracts", data);
      return res.json();
    },
    onSuccess: (contract) => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-contracts"] });
      setDialogOpen(false);
      setSelectedContractId(contract.id);
      toast({ title: "Price contract created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const selectedContract = contracts.find(c => c.id === selectedContractId);

  if (selectedContract) {
    return (
      <ContractDetail
        contract={selectedContract}
        categories={categories}
        allBrands={allBrands}
        allItems={allItems}
        customers={customers}
        onBack={() => setSelectedContractId(null)}
      />
    );
  }

  const columns: Column<ContractWithMeta>[] = [
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
      key: "priceLevel",
      header: "Price Level",
      cell: (row) => <Badge variant="outline">Level {row.priceLevel || 1}</Badge>,
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
      key: "goal",
      header: "Purchase Goal",
      cell: (row) => {
        const goal = parseFloat(String(row.purchaseGoal)) || 0;
        return goal > 0 ? (
          <div className="flex items-center gap-1">
            <Gift className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm">{"\u20AC"}{goal.toLocaleString()}</span>
          </div>
        ) : <span className="text-sm text-muted-foreground">-</span>;
      },
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
        <Button size="sm" variant="ghost" onClick={() => setSelectedContractId(row.id)} data-testid={`button-edit-contract-${row.id}`}>
          <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Price Contracts"
        description="Manage customer-specific pricing agreements with discount rules"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-contract"><Plus className="w-4 h-4 mr-1" /> New Contract</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Price Contract</DialogTitle></DialogHeader>
              <NewContractForm
                onSubmit={(d) => createContract.mutate(d)}
                isPending={createContract.isPending}
                customers={customers}
              />
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

function NewContractForm({ onSubmit, isPending, customers }: {
  onSubmit: (d: any) => void;
  isPending: boolean;
  customers: Customer[];
}) {
  const form = useForm({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      name: "", customerId: "", startDate: new Date().toISOString().split("T")[0],
      endDate: "", purchaseGoal: "0", voucherType: "percentage", voucherValue: "0", active: true,
    },
  });

  const selectedCustomer = customers.find(c => c.id === form.watch("customerId"));

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
                  <SelectItem key={c.id} value={c.id}>{c.name} (Level {c.priceLevel})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomer && (
              <p className="text-xs text-muted-foreground">Price Level: {selectedCustomer.priceLevel} | Terms: {selectedCustomer.paymentTerms}</p>
            )}
            <FormMessage />
          </FormItem>
        )} />
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
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-contract">
            {isPending ? "Creating..." : "Create Contract"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function ContractDetail({ contract, categories, allBrands, allItems, customers, onBack }: {
  contract: ContractWithMeta;
  categories: Category[];
  allBrands: string[];
  allItems: Item[];
  customers: Customer[];
  onBack: () => void;
}) {
  const { toast } = useToast();
  const customer = customers.find(c => c.id === contract.customerId);
  const priceLevel = customer?.priceLevel || 1;

  const { data: rules = [], isLoading: rulesLoading } = useQuery<PriceContractRule[]>({
    queryKey: ["/api/price-contracts", contract.id, "rules"],
    queryFn: async () => {
      const res = await fetch(`/api/price-contracts/${contract.id}/rules`);
      return res.json();
    },
  });

  const [editRules, setEditRules] = useState<RuleRow[]>([]);
  const [rulesInitialized, setRulesInitialized] = useState(false);
  const [editingHeader, setEditingHeader] = useState(true);
  const [headerForm, setHeaderForm] = useState({
    name: contract.name,
    customerId: contract.customerId,
    startDate: contract.startDate,
    endDate: contract.endDate,
    purchaseGoal: String(contract.purchaseGoal || "0"),
    voucherType: contract.voucherType || "percentage",
    voucherValue: String(contract.voucherValue || "0"),
    active: contract.active,
  });

  useEffect(() => {
    if (!rulesLoading && rules && !rulesInitialized) {
      setEditRules(rules.map(r => ({
        id: r.id,
        categoryIds: r.categoryIds || [],
        brands: r.brands || [],
        minQuantity: r.minQuantity || 0,
        discountType: r.discountType,
        discountValue: String(r.discountValue),
      })));
      setRulesInitialized(true);
    }
  }, [rules, rulesLoading, rulesInitialized]);

  const updateContract = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/price-contracts/${contract.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-contracts"] });
      setEditingHeader(false);
      toast({ title: "Contract updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveRules = useMutation({
    mutationFn: async (ruleData: RuleRow[]) => {
      const res = await apiRequest("PUT", `/api/price-contracts/${contract.id}/rules`, {
        rules: ruleData.map(r => ({
          contractId: contract.id,
          categoryIds: r.categoryIds,
          brands: r.brands,
          minQuantity: r.minQuantity,
          discountType: r.discountType,
          discountValue: r.discountValue,
        })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-contracts", contract.id, "rules"] });
      toast({ title: "Discount rules saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addRule = () => {
    setEditRules(prev => [...prev, { categoryIds: [], brands: [], minQuantity: 0, discountType: "percentage", discountValue: "0" }]);
  };

  const removeRule = (idx: number) => {
    setEditRules(prev => prev.filter((_, i) => i !== idx));
  };

  const updateRule = (idx: number, field: string, value: any) => {
    setEditRules(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const matchingItems = useCallback((rule: RuleRow): Item[] => {
    return allItems.filter(item => {
      if (rule.categoryIds.length > 0 && (!item.categoryId || !rule.categoryIds.includes(item.categoryId))) return false;
      if (rule.brands.length > 0 && (!item.brand || !rule.brands.includes(item.brand))) return false;
      return true;
    });
  }, [allItems]);

  const now = new Date();
  const end = new Date(contract.endDate);
  const isExpired = end < now;
  const statusLabel = !contract.active ? "Inactive" : isExpired ? "Expired" : "Active";
  const statusVariant = !contract.active ? "secondary" : isExpired ? "destructive" : "default";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-contracts">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          {editingHeader ? (
            <Input
              value={headerForm.name}
              onChange={e => setHeaderForm(p => ({ ...p, name: e.target.value }))}
              className="text-xl font-semibold h-auto py-1"
              data-testid="input-edit-name"
            />
          ) : (
            <h1 className="text-xl font-semibold">{contract.name}</h1>
          )}
          <p className="text-sm text-muted-foreground">{contract.customerName}</p>
        </div>
        {editingHeader ? (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={headerForm.active}
                onChange={e => setHeaderForm(p => ({ ...p, active: e.target.checked }))}
                className="rounded"
                data-testid="checkbox-contract-active"
              />
              Active
            </label>
            <Button size="sm" variant="ghost" onClick={() => setEditingHeader(false)} data-testid="button-cancel-edit">Cancel</Button>
            <Button size="sm" onClick={() => updateContract.mutate(headerForm)} disabled={updateContract.isPending} data-testid="button-save-header">
              {updateContract.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant as any}>{statusLabel}</Badge>
            <Button size="icon" variant="ghost" onClick={() => setEditingHeader(true)} data-testid="button-edit-contract-header">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {editingHeader && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs">Customer</Label>
                <Select value={headerForm.customerId} onValueChange={v => setHeaderForm(p => ({ ...p, customerId: v }))}>
                  <SelectTrigger data-testid="select-edit-customer"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} (Level {c.priceLevel})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input type="date" value={headerForm.startDate} onChange={e => setHeaderForm(p => ({ ...p, startDate: e.target.value }))} data-testid="input-edit-start" />
              </div>
              <div>
                <Label className="text-xs">End Date</Label>
                <Input type="date" value={headerForm.endDate} onChange={e => setHeaderForm(p => ({ ...p, endDate: e.target.value }))} data-testid="input-edit-end" />
              </div>
              <div>
                <Label className="text-xs">Purchase Goal ({"\u20AC"})</Label>
                <Input inputMode="decimal" value={headerForm.purchaseGoal} onChange={e => setHeaderForm(p => ({ ...p, purchaseGoal: e.target.value }))} data-testid="input-purchase-goal" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Voucher Type</Label>
                <Select value={headerForm.voucherType} onValueChange={v => setHeaderForm(p => ({ ...p, voucherType: v }))}>
                  <SelectTrigger data-testid="select-voucher-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Voucher Value</Label>
                <Input inputMode="decimal" value={headerForm.voucherValue} onChange={e => setHeaderForm(p => ({ ...p, voucherValue: e.target.value }))} data-testid="input-voucher-value" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!editingHeader && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-lg font-semibold">{contract.customerName}</p>
              <p className="text-sm text-muted-foreground">Price Level: <span className="font-medium text-foreground">{priceLevel}</span></p>
              <p className="text-sm text-muted-foreground">Terms: {customer?.paymentTerms || "cash"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Contract Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-sm">{new Date(contract.startDate).toLocaleDateString()} - {new Date(contract.endDate).toLocaleDateString()}</p>
              <p className="text-sm text-muted-foreground">{contract.name}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5" /> Purchase Goal & Voucher
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {parseFloat(String(contract.purchaseGoal)) > 0 ? (
                <>
                  <p className="text-sm">Goal: <span className="font-medium">{"\u20AC"}{parseFloat(String(contract.purchaseGoal)).toLocaleString()}</span></p>
                  <p className="text-sm">Voucher: <span className="font-medium">
                    {contract.voucherType === "percentage" ? `${contract.voucherValue}%` : `\u20AC${contract.voucherValue}`}
                  </span> money-back</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No purchase goal set</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Discount Rules</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addRule} data-testid="button-add-rule">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Rule
            </Button>
            <Button size="sm" onClick={() => saveRules.mutate(editRules)} disabled={saveRules.isPending} data-testid="button-save-rules">
              {saveRules.isPending ? "Saving..." : "Save Rules"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {editRules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No discount rules yet. Add rules to define category/brand-specific discounts.</p>
          ) : (
            <div className="space-y-3">
              {editRules.map((rule, idx) => (
                <RuleEditor
                  key={idx}
                  rule={rule}
                  index={idx}
                  categories={categories}
                  allBrands={allBrands}
                  onUpdate={updateRule}
                  onRemove={removeRule}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price Comparison Preview</CardTitle>
          <p className="text-sm text-muted-foreground">
            Shows how contract discounts compare to the customer's price level ({priceLevel}).
            Discounts only apply when they result in a lower price than the price level price.
          </p>
        </CardHeader>
        <CardContent>
          <PricePreview rules={editRules} allItems={allItems} categories={categories} priceLevel={priceLevel} />
        </CardContent>
      </Card>
    </div>
  );
}

function RuleEditor({ rule, index, categories, allBrands, onUpdate, onRemove }: {
  rule: RuleRow;
  index: number;
  categories: Category[];
  allBrands: string[];
  onUpdate: (idx: number, field: string, value: any) => void;
  onRemove: (idx: number) => void;
}) {
  const toggleCategory = (catId: string) => {
    const current = rule.categoryIds || [];
    if (current.includes(catId)) {
      onUpdate(index, "categoryIds", current.filter(c => c !== catId));
    } else {
      onUpdate(index, "categoryIds", [...current, catId]);
    }
  };

  const toggleBrand = (brand: string) => {
    const current = rule.brands || [];
    if (current.includes(brand)) {
      onUpdate(index, "brands", current.filter(b => b !== brand));
    } else {
      onUpdate(index, "brands", [...current, brand]);
    }
  };

  const removeCat = (catId: string) => {
    onUpdate(index, "categoryIds", (rule.categoryIds || []).filter(c => c !== catId));
  };

  const removeBrand = (brand: string) => {
    onUpdate(index, "brands", (rule.brands || []).filter(b => b !== brand));
  };

  const catAvailable = categories.filter(c => !(rule.categoryIds || []).includes(c.id));
  const brandAvailable = allBrands.filter(b => !(rule.brands || []).includes(b));

  return (
    <div className="border rounded-md p-3 space-y-3" data-testid={`rule-row-${index}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">Rule {index + 1}</span>
        <Button size="icon" variant="ghost" onClick={() => onRemove(index)} data-testid={`button-remove-rule-${index}`}>
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Categories</Label>
          <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
            {(rule.categoryIds || []).map(catId => {
              const cat = categories.find(c => c.id === catId);
              return (
                <Badge key={catId} variant="secondary" className="gap-1">
                  {cat?.name || catId}
                  <button type="button" onClick={() => removeCat(catId)} className="ml-0.5 hover:text-destructive" data-testid={`button-remove-rule-cat-${index}-${catId}`}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              );
            })}
            {(rule.categoryIds || []).length === 0 && <span className="text-xs text-muted-foreground">All</span>}
          </div>
          {catAvailable.length > 0 && (
            <Select value="" onValueChange={(v) => { if (v) toggleCategory(v); }}>
              <SelectTrigger data-testid={`select-rule-category-${index}`}>
                <SelectValue placeholder="Add category..." />
              </SelectTrigger>
              <SelectContent>
                {catAvailable.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Brands</Label>
          <div className="flex flex-wrap gap-1 min-h-[1.5rem]">
            {(rule.brands || []).map(brand => (
              <Badge key={brand} variant="outline" className="gap-1">
                {brand}
                <button type="button" onClick={() => removeBrand(brand)} className="ml-0.5 hover:text-destructive" data-testid={`button-remove-rule-brand-${index}-${brand}`}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {(rule.brands || []).length === 0 && <span className="text-xs text-muted-foreground">All</span>}
          </div>
          {brandAvailable.length > 0 && (
            <Select value="" onValueChange={(v) => { if (v) toggleBrand(v); }}>
              <SelectTrigger data-testid={`select-rule-brand-${index}`}>
                <SelectValue placeholder="Add brand..." />
              </SelectTrigger>
              <SelectContent>
                {brandAvailable.map(b => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Min Quantity</Label>
          <Input
            inputMode="numeric"
            value={rule.minQuantity}
            onChange={e => onUpdate(index, "minQuantity", parseInt(e.target.value) || 0)}
            data-testid={`input-rule-minqty-${index}`}
          />
        </div>
        <div>
          <Label className="text-xs">Discount Type</Label>
          <Select value={rule.discountType} onValueChange={v => onUpdate(index, "discountType", v)}>
            <SelectTrigger data-testid={`select-rule-disctype-${index}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Percentage (%)</SelectItem>
              <SelectItem value="fixed">Fixed ({"\u20AC"})</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Discount Value</Label>
          <Input
            inputMode="decimal"
            value={rule.discountValue}
            onChange={e => onUpdate(index, "discountValue", e.target.value)}
            data-testid={`input-rule-discval-${index}`}
          />
        </div>
      </div>
    </div>
  );
}

function PricePreview({ rules, allItems, categories, priceLevel }: {
  rules: RuleRow[];
  allItems: Item[];
  categories: Category[];
  priceLevel: number;
}) {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">Add discount rules to see price comparisons.</p>;
  }

  const affectedItems: { item: Item; rule: RuleRow; ruleIdx: number; retailPrice: number; levelPrice: number; discountedPrice: number; isValid: boolean }[] = [];

  rules.forEach((rule, ruleIdx) => {
    const discVal = parseFloat(rule.discountValue) || 0;
    if (discVal <= 0) return;

    allItems.forEach(item => {
      if (rule.categoryIds.length > 0 && (!item.categoryId || !rule.categoryIds.includes(item.categoryId))) return;
      if (rule.brands.length > 0 && (!item.brand || !rule.brands.includes(item.brand))) return;

      const retailPrice = getRetailPrice(item);
      const levelPrice = getPriceByLevel(item, priceLevel);
      const discountedPrice = calcDiscountedPrice(retailPrice, rule.discountType, discVal);
      const isValid = discountedPrice < levelPrice;

      affectedItems.push({ item, rule, ruleIdx, retailPrice, levelPrice, discountedPrice, isValid });
    });
  });

  if (affectedItems.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No items match the current rules.</p>;
  }

  const displayItems = affectedItems.slice(0, 30);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground pb-1 border-b">
        <span>Item</span>
        <span>Retail (L1)</span>
        <span>Level {priceLevel}</span>
        <span>Contract Price</span>
        <span>Rule</span>
        <span>Status</span>
      </div>
      {displayItems.map(({ item, rule, ruleIdx, retailPrice, levelPrice, discountedPrice, isValid }, i) => {
        const catName = item.categoryId ? categories.find(c => c.id === item.categoryId)?.name : "";
        return (
          <div key={`${item.id}-${ruleIdx}`} className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 text-sm py-1.5 ${i % 2 === 0 ? "" : "bg-muted/30"} rounded`} data-testid={`preview-row-${item.id}-${ruleIdx}`}>
            <div>
              <span className="font-medium">{item.name}</span>
              {catName && <span className="text-xs text-muted-foreground ml-1">({catName})</span>}
              {item.brand && <span className="text-xs text-muted-foreground ml-1">- {item.brand}</span>}
            </div>
            <span>{"\u20AC"}{retailPrice.toFixed(2)}</span>
            <span>{"\u20AC"}{levelPrice.toFixed(2)}</span>
            <span className={isValid ? "text-green-600 font-medium" : "text-destructive"}>{"\u20AC"}{discountedPrice.toFixed(2)}</span>
            <span className="text-xs">
              {rule.discountType === "percentage" ? `${rule.discountValue}%` : `\u20AC${rule.discountValue}`}
              <span className="text-muted-foreground"> (R{ruleIdx + 1})</span>
            </span>
            <span>
              {isValid ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-destructive" />
              )}
            </span>
          </div>
        );
      })}
      {affectedItems.length > 30 && (
        <p className="text-xs text-muted-foreground pt-2">Showing 30 of {affectedItems.length} affected items.</p>
      )}
      <div className="flex gap-4 pt-3 border-t text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5 text-green-600" /> Discount applies (lower than price level)
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive" /> Discount ignored (higher than price level price)
        </div>
      </div>
    </div>
  );
}
