import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { FileText, Search, AlertTriangle } from "lucide-react";

interface InvoiceLine {
  id: string;
  description: string;
  quantity: string;
  saleUnit: string;
  unitPrice: string;
  total: string;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  type: string;
  customerName: string;
  date: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  deliveryLocation: string | null;
  notes: string | null;
  items: InvoiceLine[];
}

export default function InvoiceReceipt() {
  const [query, setQuery] = useState("");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);

  const searchMutation = useMutation({
    mutationFn: async (q: string) => {
      const all = await apiFetch<{ id: string; invoiceNumber: string }[]>("/api/invoices");
      const match = all.find((i) => i.invoiceNumber.toLowerCase() === q.toLowerCase() || i.invoiceNumber.toLowerCase().includes(q.toLowerCase()));
      if (!match) throw new Error("not found");
      return apiFetch<InvoiceDetail>(`/api/invoices/${match.id}`);
    },
    onSuccess: (data) => { setInvoice(data); setNotFound(null); },
    onError: () => { setInvoice(null); setNotFound("No document found for that number."); },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" /> Invoice / Receipt Lookup</h1>
        <p className="text-sm text-muted-foreground">Look up a document by invoice number for driver confirmation</p>
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) searchMutation.mutate(query.trim()); }}
          placeholder="Invoice number"
          className="flex-1 rounded-lg border border-border bg-card py-3 px-3 text-sm"
          data-testid="input-invoice-number"
        />
        <button
          onClick={() => query.trim() && searchMutation.mutate(query.trim())}
          disabled={searchMutation.isPending}
          className="bg-primary text-primary-foreground rounded-lg px-4"
          data-testid="button-search-invoice"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>

      {notFound && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg p-3" data-testid="text-invoice-not-found">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {notFound}
        </div>
      )}

      {invoice && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3" data-testid="card-invoice-result">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold" data-testid="text-invoice-number">{invoice.invoiceNumber}</h2>
              <p className="text-xs text-muted-foreground capitalize">{invoice.type} · {new Date(invoice.date).toLocaleDateString()}</p>
            </div>
            <span className={`text-xs rounded-full px-2 py-0.5 capitalize ${invoice.status === "paid" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
              {invoice.status}
            </span>
          </div>

          <div className="text-sm">
            <p className="font-medium" data-testid="text-customer-name">{invoice.customerName}</p>
            {invoice.deliveryLocation && <p className="text-xs text-muted-foreground">Deliver to: {invoice.deliveryLocation}</p>}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-border">
            {invoice.items.map((line) => (
              <div key={line.id} className="flex justify-between text-sm" data-testid={`row-invoice-line-${line.id}`}>
                <span className="text-muted-foreground">{line.description} ×{parseFloat(line.quantity)}</span>
                <span className="font-medium">€{parseFloat(line.total).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-border flex justify-between font-semibold">
            <span>Total</span>
            <span data-testid="text-invoice-total">€{parseFloat(invoice.total).toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
