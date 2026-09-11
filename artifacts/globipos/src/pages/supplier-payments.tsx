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
import { Plus, CreditCard, Eye, Pencil, FileText, Users, CheckCircle2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Supplier, SupplierPayment, PurchaseInvoice } from "@shared/schema";
import { z } from "zod";

interface SupplierPaymentWithDetails extends SupplierPayment {
  supplierName?: string;
  purchaseInvoiceNumber?: string;
  purchaseInvoiceTotal?: string;
  purchaseInvoiceRef?: string;
}

const paymentFormSchema = z.object({
  paymentType: z.enum(["invoice", "balance"]),
  supplierId: z.string().min(1, "Supplier is required"),
  purchaseInvoiceId: z.string().optional(),
  amount: z.string().min(1, "Amount is required"),
  paymentDate: z.string().min(1, "Date required"),
  paymentMethod: z.string().min(1, "Method required"),
  reference: z.string().optional(),
  notes: z.string().optional(),
}).refine(d => {
  if (d.paymentType === "invoice") return !!d.purchaseInvoiceId;
  return true;
}, { message: "Please select a purchase invoice", path: ["purchaseInvoiceId"] });

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

export default function SupplierPaymentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<SupplierPaymentWithDetails | null>(null);
  const [previewPayment, setPreviewPayment] = useState<SupplierPaymentWithDetails | null>(null);
  const { toast } = useToast();

  const { data: payments = [], isLoading } = useQuery<SupplierPaymentWithDetails[]>({ queryKey: ["/api/supplier-payments"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: purchaseInvoices = [] } = useQuery<PurchaseInvoice[]>({ queryKey: ["/api/purchase-invoices"] });

  const buildPayload = (data: z.infer<typeof paymentFormSchema>) => ({
    supplierId: data.supplierId,
    purchaseInvoiceId: data.paymentType === "invoice" ? (data.purchaseInvoiceId || null) : null,
    amount: data.amount,
    paymentDate: data.paymentDate,
    paymentMethod: data.paymentMethod,
    reference: data.reference || null,
    notes: data.notes || null,
  });

  const createPayment = useMutation({
    mutationFn: async (data: z.infer<typeof paymentFormSchema>) => {
      const res = await apiRequest("POST", "/api/supplier-payments", buildPayload(data));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      setCreateOpen(false);
      toast({ title: "Payment recorded, supplier balance updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePayment = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: z.infer<typeof paymentFormSchema> }) => {
      const res = await apiRequest("PATCH", `/api/supplier-payments/${id}`, buildPayload(data));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      setEditPayment(null);
      toast({ title: "Payment updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalOwed = suppliers.reduce((sum, s) => sum + parseFloat(s.currentBalance), 0);
  const totalThisMonth = payments
    .filter(p => {
      const d = new Date(p.paymentDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  const columns: Column<SupplierPaymentWithDetails>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <CreditCard className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-medium">{formatDate(row.paymentDate)}</span>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => <span className="text-sm font-medium">{row.supplierName || "-"}</span>,
    },
    {
      key: "invoice",
      header: "Purchase Invoice / Type",
      cell: (row) => row.purchaseInvoiceNumber ? (
        <div>
          <span className="text-sm font-mono text-primary">{row.purchaseInvoiceNumber}</span>
          {row.purchaseInvoiceRef && (
            <div className="text-xs text-muted-foreground">{row.purchaseInvoiceRef}</div>
          )}
        </div>
      ) : (
        <Badge variant="outline" className="text-xs">Against Balance</Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount Paid",
      cell: (row) => (
        <div>
          <div className="text-sm font-semibold text-primary">
            €{parseFloat(row.amount).toFixed(2)}
          </div>
          {row.purchaseInvoiceTotal && (
            <div className="text-xs text-muted-foreground">
              of €{parseFloat(row.purchaseInvoiceTotal).toFixed(2)}
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
        title="Supplier Payments"
        description="Record and track payments made to suppliers"
        action={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-supplier-payment">
                <Plus className="w-4 h-4 mr-1" /> Record Payment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Record Supplier Payment</DialogTitle></DialogHeader>
              <PaymentForm
                onSubmit={(d) => createPayment.mutate(d)}
                isPending={createPayment.isPending}
                suppliers={suppliers}
                purchaseInvoices={purchaseInvoices}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Owed to Suppliers</p>
            <p className="text-2xl font-bold text-destructive">€{totalOwed.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Paid This Month</p>
            <p className="text-2xl font-bold">€{totalThisMonth.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Active Suppliers</p>
            <p className="text-2xl font-bold">{suppliers.filter(s => s.active).length}</p>
          </CardContent>
        </Card>
      </div>

      {suppliers.filter(s => parseFloat(s.currentBalance) > 0).length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Outstanding Balances</h3>
            <div className="space-y-2">
              {suppliers
                .filter(s => parseFloat(s.currentBalance) > 0)
                .sort((a, b) => parseFloat(b.currentBalance) - parseFloat(a.currentBalance))
                .map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span>{s.name} <span className="text-muted-foreground">({s.code})</span></span>
                    <span className="font-semibold text-destructive">€{parseFloat(s.currentBalance).toFixed(2)}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

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
          <DialogHeader><DialogTitle>Edit Supplier Payment</DialogTitle></DialogHeader>
          {editPayment && (
            <PaymentForm
              defaultValues={{
                paymentType: editPayment.purchaseInvoiceId ? "invoice" : "balance",
                supplierId: editPayment.supplierId,
                purchaseInvoiceId: editPayment.purchaseInvoiceId || "",
                amount: editPayment.amount,
                paymentDate: editPayment.paymentDate,
                paymentMethod: editPayment.paymentMethod,
                reference: editPayment.reference || "",
                notes: (editPayment as any).notes || "",
              }}
              onSubmit={(d) => updatePayment.mutate({ id: editPayment.id, data: d })}
              isPending={updatePayment.isPending}
              suppliers={suppliers}
              purchaseInvoices={purchaseInvoices}
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
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mx-auto">
                <CheckCircle2 className="w-7 h-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">
                  €{parseFloat(previewPayment.amount).toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Payment Made</p>
              </div>
              <div className="divide-y rounded-lg border overflow-hidden text-sm">
                <Row label="Supplier" value={previewPayment.supplierName || "-"} />
                <Row
                  label="Applied To"
                  value={previewPayment.purchaseInvoiceNumber
                    ? `${previewPayment.purchaseInvoiceNumber}${previewPayment.purchaseInvoiceRef ? ` (${previewPayment.purchaseInvoiceRef})` : ""}`
                    : "Account Balance"}
                />
                {previewPayment.purchaseInvoiceTotal && (
                  <Row label="Invoice Total" value={`€${parseFloat(previewPayment.purchaseInvoiceTotal).toFixed(2)}`} />
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
  suppliers,
  purchaseInvoices,
  defaultValues,
  submitLabel = "Record Payment",
}: {
  onSubmit: (d: any) => void;
  isPending: boolean;
  suppliers: Supplier[];
  purchaseInvoices: PurchaseInvoice[];
  defaultValues?: Partial<z.infer<typeof paymentFormSchema>>;
  submitLabel?: string;
}) {
  const form = useForm<z.infer<typeof paymentFormSchema>>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      paymentType: "invoice",
      supplierId: "",
      purchaseInvoiceId: "",
      amount: "",
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "bank_transfer",
      reference: "",
      notes: "",
      ...defaultValues,
    },
  });

  const paymentType = form.watch("paymentType");
  const selectedSupplierId = form.watch("supplierId");
  const selectedPIId = form.watch("purchaseInvoiceId");

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId);

  // Purchase invoices for the selected supplier (confirmed, not paid)
  const supplierPIs = purchaseInvoices.filter(
    pi => pi.supplierId === selectedSupplierId && pi.status !== "paid"
  );

  const selectedPI = purchaseInvoices.find(pi => pi.id === selectedPIId);
  const enteredAmount = parseFloat(form.watch("amount") || "0");

  // When supplier changes, reset PI selection
  const handleSupplierChange = (val: string) => {
    form.setValue("supplierId", val);
    form.setValue("purchaseInvoiceId", "");
  };

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

        {/* Supplier picker (always visible) */}
        <FormField control={form.control} name="supplierId" render={({ field }) => (
          <FormItem>
            <FormLabel>Supplier</FormLabel>
            <Select value={field.value} onValueChange={handleSupplierChange}>
              <FormControl>
                <SelectTrigger data-testid="select-payment-supplier">
                  <SelectValue placeholder="Select supplier..." />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {suppliers
                  .filter(s => s.active)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {parseFloat(s.currentBalance) > 0 && ` — Owes €${parseFloat(s.currentBalance).toFixed(2)}`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {/* Balance info when supplier selected */}
        {selectedSupplier && (
          <div className="text-sm p-3 border rounded-md bg-muted/40 flex justify-between items-center">
            <span className="text-muted-foreground">Current balance owed</span>
            <span className={`font-semibold ${parseFloat(selectedSupplier.currentBalance) > 0 ? "text-destructive" : "text-emerald-600"}`}>
              €{parseFloat(selectedSupplier.currentBalance).toFixed(2)}
            </span>
          </div>
        )}

        {/* Against Invoice: pick purchase invoice */}
        {paymentType === "invoice" && (
          <FormField control={form.control} name="purchaseInvoiceId" render={({ field }) => (
            <FormItem>
              <FormLabel>Purchase Invoice</FormLabel>
              <Select value={field.value || ""} onValueChange={field.onChange} disabled={!selectedSupplierId}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-purchase-invoice">
                    <SelectValue placeholder={selectedSupplierId ? "Select purchase invoice..." : "Select supplier first"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {supplierPIs.length === 0 ? (
                    <div className="py-3 px-4 text-sm text-muted-foreground text-center">
                      No outstanding purchase invoices
                    </div>
                  ) : (
                    supplierPIs
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map(pi => (
                        <SelectItem key={pi.id} value={pi.id}>
                          {pi.invoiceNumber}
                          {pi.supplierInvoiceRef ? ` (${pi.supplierInvoiceRef})` : ""}
                          {" — "}€{parseFloat(pi.total).toFixed(2)}
                          {" "}[{pi.status}]
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        )}

        {/* Selected PI summary */}
        {paymentType === "invoice" && selectedPI && (
          <div className="text-sm p-3 border rounded-md bg-muted/40 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice Total</span>
              <span className="font-medium">€{parseFloat(selectedPI.total).toFixed(2)}</span>
            </div>
            {selectedPI.supplierInvoiceRef && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplier Ref</span>
                <span className="font-mono">{selectedPI.supplierInvoiceRef}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="secondary" className="capitalize text-xs">{selectedPI.status}</Badge>
            </div>
          </div>
        )}

        {/* Against Balance: outstanding PIs preview */}
        {paymentType === "balance" && selectedSupplierId && (
          <div className="text-sm p-3 border rounded-md bg-muted/40 space-y-1.5">
            <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-1">Outstanding Purchase Invoices</p>
            {supplierPIs.length === 0 ? (
              <p className="text-muted-foreground">No outstanding purchase invoices for this supplier.</p>
            ) : (
              supplierPIs.map(pi => (
                <div key={pi.id} className="flex justify-between text-xs">
                  <span className="font-mono">{pi.invoiceNumber}{pi.supplierInvoiceRef ? ` (${pi.supplierInvoiceRef})` : ""}</span>
                  <span>€{parseFloat(pi.total).toFixed(2)} <span className="text-muted-foreground capitalize">[{pi.status}]</span></span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="amount" render={({ field }) => (
            <FormItem>
              <FormLabel>Amount Paid</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  {...field}
                  placeholder={
                    selectedPI ? parseFloat(selectedPI.total).toFixed(2)
                    : selectedSupplier ? parseFloat(selectedSupplier.currentBalance).toFixed(2)
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

        {/* Settlement hint for invoice mode */}
        {paymentType === "invoice" && selectedPI && enteredAmount > 0 && (
          <div className="text-xs p-2 rounded-md bg-muted/50 text-muted-foreground">
            {enteredAmount >= parseFloat(selectedPI.total)
              ? "✓ This payment will fully settle the purchase invoice."
              : `Remaining after this payment: €${Math.max(0, parseFloat(selectedPI.total) - enteredAmount).toFixed(2)}`}
          </div>
        )}

        {/* Balance settlement hint */}
        {paymentType === "balance" && selectedSupplier && enteredAmount > 0 && (
          <div className={`text-xs p-2 rounded-md ${enteredAmount >= parseFloat(selectedSupplier.currentBalance) ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400" : "bg-muted/50 text-muted-foreground"}`}>
            {enteredAmount >= parseFloat(selectedSupplier.currentBalance)
              ? "✓ This payment fully clears the supplier balance."
              : `Remaining balance after payment: €${Math.max(0, parseFloat(selectedSupplier.currentBalance) - enteredAmount).toFixed(2)}`}
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
