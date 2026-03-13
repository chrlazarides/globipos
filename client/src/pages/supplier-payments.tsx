import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, CreditCard, Eye, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertSupplierPaymentSchema, type Supplier, type SupplierPayment } from "@shared/schema";
import { z } from "zod";

interface SupplierPaymentWithName extends SupplierPayment {
  supplierName?: string;
}

const paymentFormSchema = insertSupplierPaymentSchema.extend({
  supplierId: z.string().min(1, "Supplier is required"),
  amount: z.string().min(1, "Amount is required"),
  paymentDate: z.string().min(1, "Date required"),
});

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
};

export default function SupplierPaymentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<SupplierPaymentWithName | null>(null);
  const [previewPayment, setPreviewPayment] = useState<SupplierPaymentWithName | null>(null);
  const { toast } = useToast();

  const { data: payments = [], isLoading } = useQuery<SupplierPaymentWithName[]>({ queryKey: ["/api/supplier-payments"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const createPayment = useMutation({
    mutationFn: async (data: z.infer<typeof paymentFormSchema>) => {
      const res = await apiRequest("POST", "/api/supplier-payments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setCreateOpen(false);
      toast({ title: "Payment recorded, supplier balance updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePayment = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: z.infer<typeof paymentFormSchema> }) => {
      const res = await apiRequest("PATCH", `/api/supplier-payments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setEditPayment(null);
      toast({ title: "Payment updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const columns: Column<SupplierPaymentWithName>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <CreditCard className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm">{formatDate(row.paymentDate)}</span>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => {
        const sup = suppliers.find(s => s.id === row.supplierId);
        return <span className="text-sm">{row.supplierName || sup?.name || "-"}</span>;
      },
    },
    {
      key: "amount",
      header: "Amount",
      cell: (row) => <span className="text-sm font-medium">€{parseFloat(row.amount).toFixed(2)}</span>,
    },
    {
      key: "method",
      header: "Method",
      cell: (row) => <Badge variant="secondary">{METHOD_LABELS[row.paymentMethod] || row.paymentMethod.replace("_", " ")}</Badge>,
    },
    {
      key: "reference",
      header: "Reference",
      cell: (row) => <span className="text-sm text-muted-foreground">{row.reference || "-"}</span>,
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

  const totalOwed = suppliers.reduce((sum, s) => sum + parseFloat(s.currentBalance), 0);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Supplier Payments"
        description="Record payments to suppliers"
        action={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-supplier-payment"><Plus className="w-4 h-4 mr-1" /> Record Payment</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Record Supplier Payment</DialogTitle></DialogHeader>
              <PaymentForm
                onSubmit={(d) => createPayment.mutate(d)}
                isPending={createPayment.isPending}
                suppliers={suppliers}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Owed to Suppliers</p>
            <p className="text-2xl font-bold">€{totalOwed.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Payments This Month</p>
            <p className="text-2xl font-bold">
              €{payments
                .filter(p => {
                  const d = new Date(p.paymentDate);
                  const now = new Date();
                  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                })
                .reduce((sum, p) => sum + parseFloat(p.amount), 0)
                .toFixed(2)}
            </p>
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
              {suppliers.filter(s => parseFloat(s.currentBalance) > 0).map(s => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span>{s.name} ({s.code})</span>
                  <span className="font-medium text-destructive">€{parseFloat(s.currentBalance).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={payments} isLoading={isLoading} emptyMessage="No payments recorded" />
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editPayment} onOpenChange={(open) => !open && setEditPayment(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Supplier Payment</DialogTitle></DialogHeader>
          {editPayment && (
            <PaymentForm
              defaultValues={{
                supplierId: editPayment.supplierId,
                purchaseInvoiceId: editPayment.purchaseInvoiceId,
                amount: editPayment.amount,
                paymentDate: editPayment.paymentDate,
                paymentMethod: editPayment.paymentMethod,
                reference: editPayment.reference || "",
              }}
              onSubmit={(d) => updatePayment.mutate({ id: editPayment.id, data: d })}
              isPending={updatePayment.isPending}
              suppliers={suppliers}
              submitLabel="Save Changes"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewPayment} onOpenChange={(open) => !open && setPreviewPayment(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Payment Details</DialogTitle></DialogHeader>
          {previewPayment && (
            <div className="space-y-4">
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mx-auto">
                <CreditCard className="w-7 h-7 text-primary" />
              </div>
              <div className="divide-y rounded-lg border overflow-hidden text-sm">
                <Row label="Supplier" value={previewPayment.supplierName || suppliers.find(s => s.id === previewPayment.supplierId)?.name || "-"} />
                <Row label="Amount" value={`€${parseFloat(previewPayment.amount).toFixed(2)}`} bold />
                <Row label="Date" value={formatDate(previewPayment.paymentDate)} />
                <Row label="Method" value={METHOD_LABELS[previewPayment.paymentMethod] || previewPayment.paymentMethod} />
                <Row label="Reference" value={previewPayment.reference || "-"} />
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between px-4 py-2.5 bg-background">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

function PaymentForm({
  onSubmit,
  isPending,
  suppliers,
  defaultValues,
  submitLabel = "Record Payment",
}: {
  onSubmit: (d: any) => void;
  isPending: boolean;
  suppliers: Supplier[];
  defaultValues?: Partial<z.infer<typeof paymentFormSchema>>;
  submitLabel?: string;
}) {
  const form = useForm({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      supplierId: "",
      purchaseInvoiceId: null,
      amount: "",
      paymentDate: new Date().toISOString().split("T")[0],
      paymentMethod: "bank_transfer",
      reference: "",
      ...defaultValues,
    },
  });

  const selectedSupplier = suppliers.find(s => s.id === form.watch("supplierId"));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="supplierId" render={({ field }) => (
          <FormItem>
            <FormLabel>Supplier</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger data-testid="select-payment-supplier">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} (Balance: €{parseFloat(s.currentBalance).toFixed(2)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {selectedSupplier && (
          <div className="text-sm text-muted-foreground p-2 border rounded-md">
            Current balance owed: <span className="font-medium">€{parseFloat(selectedSupplier.currentBalance).toFixed(2)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="amount" render={({ field }) => (
            <FormItem>
              <FormLabel>Amount</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} data-testid="input-payment-amount" /></FormControl>
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
              <FormControl><Input {...field} value={field.value || ""} placeholder="Payment ref" data-testid="input-payment-reference" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-payment">
            {isPending ? "Saving..." : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
