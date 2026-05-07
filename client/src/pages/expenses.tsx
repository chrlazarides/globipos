import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Receipt, Pencil, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertExpenseSchema, type Expense, type Account, type Supplier } from "@shared/schema";
import { z } from "zod";

const expenseFormSchema = insertExpenseSchema.extend({
  date: z.string().min(1, "Date is required"),
  description: z.string().min(1, "Description is required"),
  expenseAccountId: z.string().min(1, "Expense account is required"),
  paymentAccountId: z.string().min(1, "Payment account is required"),
  amount: z.string().min(1, "Amount is required"),
  vatAmount: z.string(),
  paymentMethod: z.string().min(1, "Payment method is required"),
  reference: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  journalEntryId: z.string().nullable().optional(),
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

type ExpenseWithDetails = Expense & {
  expenseAccountName?: string;
  paymentAccountName?: string;
  supplierName?: string;
};

const emptyDefaults: ExpenseFormValues = {
  date: new Date().toISOString().split("T")[0],
  description: "",
  reference: "",
  expenseAccountId: "",
  paymentAccountId: "",
  amount: "",
  vatAmount: "0",
  paymentMethod: "cash",
  supplierId: "",
  journalEntryId: null,
};

export default function ExpensesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseWithDetails | null>(null);
  const { toast } = useToast();

  const { data: expenses = [], isLoading } = useQuery<ExpenseWithDetails[]>({ queryKey: ["/api/expenses"] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const expenseAccounts = accounts.filter(a => a.type === "expense");
  const paymentAccounts = accounts.filter(a => a.type === "asset" && a.subtype === "current_asset");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
  };

  const createExpense = useMutation({
    mutationFn: async (data: ExpenseFormValues) => {
      const res = await apiRequest("POST", "/api/expenses", {
        ...data,
        supplierId: data.supplierId === "none" ? null : data.supplierId || null,
        reference: data.reference || null,
        journalEntryId: null,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
      toast({ title: "Expense recorded successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateExpense = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ExpenseFormValues }) => {
      const res = await apiRequest("PATCH", `/api/expenses/${id}`, {
        ...data,
        supplierId: data.supplierId === "none" ? null : data.supplierId || null,
        reference: data.reference || null,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      closeDialog();
      toast({ title: "Expense updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteExpense = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/expenses/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openNew() {
    setEditingExpense(null);
    setDialogOpen(true);
  }

  function openEdit(expense: ExpenseWithDetails) {
    setEditingExpense(expense);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingExpense(null);
  }

  const now = new Date();
  const thisMonthExpenses = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const totalExpenses = thisMonthExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
  const totalVat = thisMonthExpenses.reduce((sum, e) => sum + parseFloat(e.vatAmount), 0);

  const getAccountName = (id: string) => accounts.find(a => a.id === id)?.name || "-";
  const getSupplierName = (id: string | null) => {
    if (!id) return "-";
    return suppliers.find(s => s.id === id)?.name || "-";
  };

  const columns: Column<ExpenseWithDetails>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Receipt className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm" data-testid={`text-expense-date-${row.id}`}>{formatDate(row.date)}</span>
        </div>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (row) => <span className="text-sm" data-testid={`text-expense-description-${row.id}`}>{row.description}</span>,
    },
    {
      key: "category",
      header: "Expense Category",
      cell: (row) => (
        <Badge variant="secondary" data-testid={`badge-expense-category-${row.id}`}>
          {row.expenseAccountName || getAccountName(row.expenseAccountId)}
        </Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      cell: (row) => <span className="text-sm font-medium" data-testid={`text-expense-amount-${row.id}`}>€{parseFloat(row.amount).toFixed(2)}</span>,
    },
    {
      key: "vat",
      header: "VAT",
      cell: (row) => <span className="text-sm" data-testid={`text-expense-vat-${row.id}`}>€{parseFloat(row.vatAmount).toFixed(2)}</span>,
    },
    {
      key: "total",
      header: "Total",
      cell: (row) => {
        const total = parseFloat(row.amount) + parseFloat(row.vatAmount);
        return <span className="text-sm font-medium" data-testid={`text-expense-total-${row.id}`}>€{total.toFixed(2)}</span>;
      },
    },
    {
      key: "paymentMethod",
      header: "Payment Method",
      cell: (row) => <Badge variant="outline" data-testid={`badge-expense-method-${row.id}`}>{row.paymentMethod.replace("_", " ")}</Badge>,
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => (
        <span className="text-sm text-muted-foreground" data-testid={`text-expense-supplier-${row.id}`}>
          {row.supplierName || getSupplierName(row.supplierId)}
        </span>
      ),
    },
    {
      key: "actions" as any,
      header: "",
      cell: (row) => (
        <div className="flex gap-1 justify-end">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Edit expense"
            data-testid={`button-edit-expense-${row.id}`}
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            title="Delete expense"
            data-testid={`button-delete-expense-${row.id}`}
            disabled={deleteExpense.isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete expense "${row.description}"? Its journal entry will also be reversed.`)) {
                deleteExpense.mutate(row.id);
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const editDefaults: ExpenseFormValues | undefined = editingExpense
    ? {
        date: typeof editingExpense.date === "string" ? editingExpense.date : new Date(editingExpense.date).toISOString().split("T")[0],
        description: editingExpense.description,
        reference: editingExpense.reference || "",
        expenseAccountId: editingExpense.expenseAccountId,
        paymentAccountId: editingExpense.paymentAccountId,
        amount: editingExpense.amount,
        vatAmount: editingExpense.vatAmount,
        paymentMethod: editingExpense.paymentMethod,
        supplierId: editingExpense.supplierId || "",
        journalEntryId: editingExpense.journalEntryId || null,
      }
    : undefined;

  const isPending = createExpense.isPending || updateExpense.isPending;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Expenses"
        description="Track and manage business expenses"
        action={
          <Button data-testid="button-new-expense" onClick={openNew}>
            <Plus className="w-4 h-4 mr-1" /> New Expense
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Expenses (This Month)</p>
            <p className="text-2xl font-bold" data-testid="text-total-expenses">€{totalExpenses.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total VAT (This Month)</p>
            <p className="text-2xl font-bold" data-testid="text-total-vat">€{totalVat.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Expenses Count (This Month)</p>
            <p className="text-2xl font-bold" data-testid="text-expense-count">{thisMonthExpenses.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={expenses} isLoading={isLoading} emptyMessage="No expenses recorded" />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingExpense ? "Edit Expense" : "New Expense"}</DialogTitle>
          </DialogHeader>
          <ExpenseForm
            key={editingExpense?.id ?? "new"}
            defaultValues={editDefaults ?? emptyDefaults}
            onSubmit={(d) => {
              if (editingExpense) {
                updateExpense.mutate({ id: editingExpense.id, data: d });
              } else {
                createExpense.mutate(d);
              }
            }}
            isPending={isPending}
            isEditing={!!editingExpense}
            expenseAccounts={expenseAccounts}
            paymentAccounts={paymentAccounts}
            suppliers={suppliers}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpenseForm({
  defaultValues,
  onSubmit,
  isPending,
  isEditing,
  expenseAccounts,
  paymentAccounts,
  suppliers,
}: {
  defaultValues: z.infer<typeof expenseFormSchema>;
  onSubmit: (d: z.infer<typeof expenseFormSchema>) => void;
  isPending: boolean;
  isEditing: boolean;
  expenseAccounts: Account[];
  paymentAccounts: Account[];
  suppliers: Supplier[];
}) {
  const [autoVat, setAutoVat] = useState(!isEditing);

  const form = useForm({
    resolver: zodResolver(expenseFormSchema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);
    setAutoVat(!isEditing);
  }, [defaultValues]);

  const amountValue = form.watch("amount");

  const handleAmountChange = (value: string, fieldOnChange: (v: string) => void) => {
    fieldOnChange(value);
    if (autoVat && value) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        form.setValue("vatAmount", (num * 0.19).toFixed(2));
      }
    }
  };

  const handleAutoVatToggle = (checked: boolean) => {
    setAutoVat(checked);
    if (checked && amountValue) {
      const num = parseFloat(amountValue);
      if (!isNaN(num)) {
        form.setValue("vatAmount", (num * 0.19).toFixed(2));
      }
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="date" render={({ field }) => (
            <FormItem>
              <FormLabel>Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-expense-date" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="reference" render={({ field }) => (
            <FormItem>
              <FormLabel>Reference</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} placeholder="Optional ref" data-testid="input-expense-reference" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl><Input {...field} placeholder="Expense description" data-testid="input-expense-description" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="expenseAccountId" render={({ field }) => (
            <FormItem>
              <FormLabel>Expense Account</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-expense-account">
                    <SelectValue placeholder="Select expense account" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {expenseAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="paymentAccountId" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Account</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-account">
                    <SelectValue placeholder="Select payment account" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {paymentAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.code} - {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="amount" render={({ field }) => (
            <FormItem>
              <FormLabel>Amount (excl. VAT)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  {...field}
                  onChange={(e) => handleAmountChange(e.target.value, field.onChange)}
                  data-testid="input-expense-amount"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="vatAmount" render={({ field }) => (
            <FormItem>
              <FormLabel>VAT Amount</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  {...field}
                  disabled={autoVat}
                  data-testid="input-expense-vat"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="auto-vat"
            checked={autoVat}
            onCheckedChange={(checked) => handleAutoVatToggle(!!checked)}
            data-testid="checkbox-auto-vat"
          />
          <label htmlFor="auto-vat" className="text-sm text-muted-foreground cursor-pointer">
            Auto-calculate VAT at 19%
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="paymentMethod" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Method</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-expense-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="supplierId" render={({ field }) => (
            <FormItem>
              <FormLabel>Supplier (Optional)</FormLabel>
              <Select value={field.value || ""} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-expense-supplier">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-expense">
            {isPending ? "Saving..." : isEditing ? "Save Changes" : "Save Expense"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
