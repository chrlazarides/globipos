import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Banknote, Eye, Pencil, CheckCircle2, FileText, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer, Invoice, Payment } from "@shared/schema";
import { z } from "zod";
import { Link } from "wouter";

interface PaymentWithDetails extends Payment {
  invoiceNumber?: string;
  customerName?: string;
  invoiceTotal?: string;
}

const paymentFormSchema = z.object({
  paymentType: z.enum(["invoice", "balance"]),
  customerId: z.string().optional(),
  invoiceId: z.string().optional(),
  amount: z.string().min(1, "Amount is required"),
  paymentDate: z.string().min(1, "Date required"),
  paymentMethod: z.string().min(1, "Method required"),
  reference: z.string().optional(),
  notes: z.string().optional(),
}).refine(d => {
  if (d.paymentType === "invoice") return !!d.invoiceId;
  if (d.paymentType === "balance") return !!d.customerId;
  return true;
}, { message: "Please select an invoice or customer", path: ["invoiceId"] });

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
};

const METHOD_BADGE: Record<string, string> = {
  bank_transfer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  cash: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  cheque: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  card: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

export default function CustomerPaymentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentWithDetails | null>(null);
  const [previewPayment, setPreviewPayment] = useState<PaymentWithDetails | null>(null);
  const { toast } = useToast();

  const { data: payments = [], isLoading } = useQuery<PaymentWithDetails[]>({ queryKey: ["/api/payments"] });
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: allInvoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });

  const invoices = allInvoices.filter(inv =>
    inv.type === "invoice" && inv.status !== "cancelled"
  );

  const submitPayment = async (data: z.infer<typeof paymentFormSchema>) => {
    const payload: any = {
      amount: data.amount,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      reference: data.reference || null,
      notes: data.notes || null,
    };
    if (data.paymentType === "invoice") {
      payload.invoiceId = data.invoiceId;
      payload.customerId = null;
    } else {
      payload.customerId = data.customerId;
      payload.invoiceId = null;
    }
    return payload;
  };

  const createPayment = useMutation({
    mutationFn: async (data: z.infer<typeof paymentFormSchema>) => {
      const payload = await submitPayment(data);
      const res = await apiRequest("POST", "/api/payments", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setCreateOpen(false);
      toast({ title: "Payment recorded successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePayment = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: z.infer<typeof paymentFormSchema> }) => {
      const payload = await submitPayment(data);
      const res = await apiRequest("PATCH", `/api/payments/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setEditPayment(null);
      toast({ title: "Payment updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalThisMonth = payments
    .filter(p => {
      const d = new Date(p.paymentDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  const totalAllTime = payments.reduce((s, p) => s + parseFloat(p.amount), 0);

  const columns: Column<PaymentWithDetails>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-100 dark:bg-emerald-900/30">
            <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <span className="text-sm font-medium">{formatDate(row.paymentDate)}</span>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => <span className="text-sm font-medium">{row.customerName || "-"}</span>,
    },
    {
      key: "invoice",
      header: "Invoice / Type",
      cell: (row) => row.invoiceNumber ? (
        <Link href={`/invoices/${row.invoiceId}`}>
          <span className="text-sm text-primary underline-offset-2 hover:underline cursor-pointer font-mono">
            {row.invoiceNumber}
          </span>
        </Link>
      ) : (
        <Badge variant="outline" className="text-xs">Against Balance</Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount Paid",
      cell: (row) => (
        <div>
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            €{parseFloat(row.amount).toFixed(2)}
          </div>
          {row.invoiceTotal && (
            <div className="text-xs text-muted-foreground">
              of €{parseFloat(row.invoiceTotal).toFixed(2)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "method",
      header: "Method",
      cell: (row) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${METHOD_BADGE[row.paymentMethod] || "bg-muted text-muted-foreground"}`}>
          {METHOD_LABELS[row.paymentMethod] || row.paymentMethod}
        </span>
      ),
    },
    {
      key: "reference",
      header: "Reference",
      cell: (row) => <span className="text-sm text-muted-foreground font-mono">{row.reference || "-"}</span>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-1 justify-end">
          <Button size="sm" variant="ghost" data-testid={`button-preview-payment-${row.id}`} onClick={() => setPreviewPayment(row)}>
            <Eye className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" data-testid={`button-edit-payment-${row.id}`} onClick={() => setEditPayment(row)}>
            <Pencil className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Customer Payments"
        description="Record and track payments received from customers"
        action={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-customer-payment">
                <Plus className="w-4 h-4 mr-1" /> Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Record Customer Payment</DialogTitle></DialogHeader>
              <PaymentForm
                onSubmit={(d) => createPayment.mutate(d)}
                isPending={createPayment.isPending}
                invoices={invoices}
                customers={customers}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Received This Month</p>
            <p className="text-2xl font-bold text-emerald-600">€{totalThisMonth.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Received (All Time)</p>
            <p className="text-2xl font-bold">€{totalAllTime.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Payments Recorded</p>
            <p className="text-2xl font-bold">{payments.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <DataTable
            columns={columns}
            data={payments}
            isLoading={isLoading}
            emptyMessage="No payments recorded yet"
          />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editPayment} onOpenChange={(open) => !open && setEditPayment(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Payment</DialogTitle></DialogHeader>
          {editPayment && (
            <PaymentForm
              defaultValues={{
                paymentType: editPayment.invoiceId ? "invoice" : "balance",
                customerId: editPayment.customerId || "",
                invoiceId: editPayment.invoiceId || "",
                amount: editPayment.amount,
                paymentDate: editPayment.paymentDate,
                paymentMethod: editPayment.paymentMethod,
                reference: editPayment.reference || "",
                notes: (editPayment as any).notes || "",
              }}
              onSubmit={(d) => updatePayment.mutate({ id: editPayment.id, data: d })}
              isPending={updatePayment.isPending}
              invoices={invoices}
              customers={customers}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewPayment} onOpenChange={(open) => !open && setPreviewPayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Payment Receipt</DialogTitle></DialogHeader>
          {previewPayment && (
            <div className="space-y-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mx-auto">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  €{parseFloat(previewPayment.amount).toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Payment Received</p>
              </div>
              <div className="divide-y rounded-lg border overflow-hidden text-sm">
                <Row label="Customer" value={previewPayment.customerName || "-"} />
                <Row
                  label="Applied To"
                  value={previewPayment.invoiceNumber || "Account Balance"}
                />
                {previewPayment.invoiceTotal && (
                  <Row label="Invoice Total" value={`€${parseFloat(previewPayment.invoiceTotal).toFixed(2)}`} />
                )}
                <Row label="Date" value={formatDate(previewPayment.paymentDate)} />
                <Row label="Method" value={METHOD_LABELS[previewPayment.paymentMethod] || previewPayment.paymentMethod} />
                <Row label="Reference" value={previewPayment.reference || "-"} />
                {(previewPayment as any).notes && (
                  <Row label="Notes" value={(previewPayment as any).notes} />
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setPreviewPayment(null); setEditPayment(previewPayment); }}>
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
                <Button variant="outline" onClick={() => setPreviewPayment(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-4 py-2.5 bg-background">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function PaymentForm({
  onSubmit,
  isPending,
  invoices,
  customers,
  defaultValues,
  submitLabel = "Record Payment",
}: {
  onSubmit: (d: any) => void;
  isPending: boolean;
  invoices: Invoice[];
  customers: Customer[];
  defaultValues?: Partial<z.infer<typeof paymentFormSchema>>;
  submitLabel?: string;
}) {
  const form = useForm<z.infer<typeof paymentFormSchema>>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      paymentType: "invoice",
      customerId: "",
      invoiceId: "",
      amount: "",
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "bank_transfer",
      reference: "",
      notes: "",
      ...defaultValues,
    },
  });

  const paymentType = form.watch("paymentType");
  const selectedInvoiceId = form.watch("invoiceId");
  const selectedCustomerId = form.watch("customerId");

  const selectedInvoice = invoices.find(inv => inv.id === selectedInvoiceId);
  const selectedCustomer = customers.find(c => c.id === (paymentType === "balance" ? selectedCustomerId : selectedInvoice?.customerId));

  // Outstanding invoices for selected customer (balance payment preview)
  const customerOutstanding = paymentType === "balance" && selectedCustomerId
    ? invoices.filter(inv => inv.customerId === selectedCustomerId && inv.status !== "paid")
    : [];

  const enteredAmount = parseFloat(form.watch("amount") || "0");
  const outstanding = customerOutstanding.reduce((s, inv) => s + parseFloat(inv.total), 0);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

        {/* Payment type toggle */}
        <div>
          <label className="text-sm font-medium mb-2 block">Payment Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => form.setValue("paymentType", "invoice")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                paymentType === "invoice"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              <FileText className="w-4 h-4" />
              Against Invoice
            </button>
            <button
              type="button"
              onClick={() => form.setValue("paymentType", "balance")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                paymentType === "balance"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              <Users className="w-4 h-4" />
              Against Balance
            </button>
          </div>
        </div>

        {/* Against Invoice: select invoice */}
        {paymentType === "invoice" && (
          <FormField control={form.control} name="invoiceId" render={({ field }) => (
            <FormItem>
              <FormLabel>Invoice</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-invoice">
                    <SelectValue placeholder="Select invoice..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {invoices
                    .slice()
                    .sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber))
                    .map(inv => {
                      const cust = customers.find(c => c.id === inv.customerId);
                      return (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} — {cust?.name || "Unknown"} · €{parseFloat(inv.total).toFixed(2)} [{inv.status}]
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        )}

        {/* Invoice summary box */}
        {paymentType === "invoice" && selectedInvoice && (
          <div className="text-sm p-3 border rounded-md bg-muted/40 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-medium">{selectedCustomer?.name || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice Total</span>
              <span className="font-medium">€{parseFloat(selectedInvoice.total).toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="secondary" className="capitalize text-xs">{selectedInvoice.status}</Badge>
            </div>
          </div>
        )}

        {/* Against Balance: select customer */}
        {paymentType === "balance" && (
          <FormField control={form.control} name="customerId" render={({ field }) => (
            <FormItem>
              <FormLabel>Customer</FormLabel>
              <Select value={field.value || ""} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-customer">
                    <SelectValue placeholder="Select customer..." />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {customers
                    .filter(c => c.active)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        )}

        {/* Balance payment summary */}
        {paymentType === "balance" && selectedCustomerId && (
          <div className="text-sm p-3 border rounded-md bg-muted/40 space-y-1.5">
            <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Outstanding Invoices</p>
            {customerOutstanding.length === 0 ? (
              <p className="text-muted-foreground">No outstanding invoices — payment will be recorded as credit.</p>
            ) : (
              <>
                {customerOutstanding.map(inv => (
                  <div key={inv.id} className="flex justify-between text-xs">
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    <span>€{parseFloat(inv.total).toFixed(2)} <span className="text-muted-foreground capitalize">[{inv.status}]</span></span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-1 mt-1 font-medium">
                  <span>Total outstanding</span>
                  <span>€{outstanding.toFixed(2)}</span>
                </div>
                {enteredAmount > 0 && (
                  <div className={`flex justify-between font-medium ${enteredAmount >= outstanding ? "text-emerald-600" : "text-amber-600"}`}>
                    <span>{enteredAmount >= outstanding ? "✓ Fully clears balance" : "Partial payment — applied oldest first"}</span>
                    {enteredAmount < outstanding && <span>Remaining: €{(outstanding - enteredAmount).toFixed(2)}</span>}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="amount" render={({ field }) => (
            <FormItem>
              <FormLabel>Amount Received</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  {...field}
                  placeholder={
                    paymentType === "invoice" && selectedInvoice
                      ? parseFloat(selectedInvoice.total).toFixed(2)
                      : paymentType === "balance" && outstanding > 0
                      ? outstanding.toFixed(2)
                      : "0.00"
                  }
                  data-testid="input-payment-amount"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="paymentDate" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Date</FormLabel>
              <FormControl><Input type="date" {...field} data-testid="input-payment-date" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Method + Reference */}
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="paymentMethod" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Method</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="reference" render={({ field }) => (
            <FormItem>
              <FormLabel>Reference</FormLabel>
              <FormControl>
                <Input {...field} value={field.value || ""} placeholder="e.g. bank ref" data-testid="input-payment-reference" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Invoice settled hint */}
        {paymentType === "invoice" && selectedInvoice && enteredAmount > 0 && (
          <div className="text-xs p-2 rounded-md bg-muted/50 text-muted-foreground">
            {enteredAmount >= parseFloat(selectedInvoice.total)
              ? "✓ This payment will fully settle the invoice."
              : `Remaining after this payment: €${Math.max(0, parseFloat(selectedInvoice.total) - enteredAmount).toFixed(2)}`}
          </div>
        )}

        {/* Notes */}
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Notes <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
            <FormControl>
              <Textarea {...field} value={field.value || ""} rows={2} placeholder="Any additional notes..." data-testid="input-payment-notes" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-payment">
            {isPending ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
