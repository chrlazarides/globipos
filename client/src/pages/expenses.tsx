import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Receipt } from "lucide-react";
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

type ExpenseWithDetails = Expense & {
  expenseAccountName?: string;
  paymentAccountName?: string;
  supplierName?: string;
};

export default function ExpensesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: expenses = [], isLoading } = useQuery<ExpenseWithDetails[]>({ queryKey: ["/api/expenses"] });
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const expenseAccounts = accounts.filter(a => a.type === "expense");
  const paymentAccounts = accounts.filter(a => a.type === "asset" && a.subtype === "current_asset");

  const createExpense = useMutation({
    mutationFn: async (data: z.infer<typeof expenseFormSchema>) => {
      const payload = {
        ...data,
        supplierId: data.supplierId || null,
        reference: data.reference || null,
        journalEntryId: null,
      };
      const res = await apiRequest("POST", "/api/expenses", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setDialogOpen(false);
      toast({ title: "Expense recorded successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
          <span className="text-sm" data-testid={`text-expense-date-${row.id}`}>{new Date(row.date).toLocaleDateString()}</span>
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
      cell: (row) => <span className="text-sm font-medium" data-testid={`text-expense-amount-${row.id}`}>{"\u20AC"}{parseFloat(row.amount).toFixed(2)}</span>,
    },
    {
      key: "vat",
      header: "VAT",
      cell: (row) => <span className="text-sm" data-testid={`text-expense-vat-${row.id}`}>{"\u20AC"}{parseFloat(row.vatAmount).toFixed(2)}</span>,
    },
    {
      key: "total",
      header: "Total",
      cell: (row) => {
        const total = parseFloat(row.amount) + parseFloat(row.vatAmount);
        return <span className="text-sm font-medium" data-testid={`text-expense-total-${row.id}`}>{"\u20AC"}{total.toFixed(2)}</span>;
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
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Expenses"
        description="Track and manage business expenses"
        action={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-expense"><Plus className="w-4 h-4 mr-1" /> New Expense</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Expense</DialogTitle></DialogHeader>
              <ExpenseForm
                onSubmit={(d) => createExpense.mutate(d)}
                isPending={createExpense.isPending}
                expenseAccounts={expenseAccounts}
                paymentAccounts={paymentAccounts}
                suppliers={suppliers}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Expenses (This Month)</p>
            <p className="text-2xl font-bold" data-testid="text-total-expenses">{"\u20AC"}{totalExpenses.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total VAT (This Month)</p>
            <p className="text-2xl font-bold" data-testid="text-total-vat">{"\u20AC"}{totalVat.toFixed(2)}</p>
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
    </div>
  );
}

function ExpenseForm({
  onSubmit,
  isPending,
  expenseAccounts,
  paymentAccounts,
  suppliers,
}: {
  onSubmit: (d: z.infer<typeof expenseFormSchema>) => void;
  isPending: boolean;
  expenseAccounts: Account[];
  paymentAccounts: Account[];
  suppliers: Supplier[];
}) {
  const [autoVat, setAutoVat] = useState(true);

  const form = useForm({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
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
    },
  });

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
              <FormLabel>Amount</FormLabel>
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
            {isPending ? "Saving..." : "Save Expense"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
