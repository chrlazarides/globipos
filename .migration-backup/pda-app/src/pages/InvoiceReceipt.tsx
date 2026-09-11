import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FileText, Search, AlertTriangle, Printer, Share2 } from "lucide-react";

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

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  customerName: string;
  date: string;
  total: string;
  status: string;
}

function buildReceiptHtml(invoice: InvoiceDetail): string {
  return `<!doctype html><html><head><title>${invoice.invoiceNumber}</title><style>
    body { font-family: 'Courier New', monospace; max-width: 320px; margin: 0 auto; padding: 16px; }
    h1 { font-size: 16px; text-align: center; margin: 0 0 4px; }
    .meta { text-align: center; font-size: 11px; color: #555; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { padding: 3px 0; }
    .right { text-align: right; }
    .divider { border-top: 1px dashed #333; margin: 8px 0; }
    .total { font-weight: 700; font-size: 14px; }
  </style></head><body>
    <h1>${invoice.invoiceNumber}</h1>
    <div class="meta">${invoice.customerName}<br/>${new Date(invoice.date).toLocaleDateString()} · ${invoice.type.toUpperCase()}</div>
    <div class="divider"></div>
    <table>
      ${invoice.items.map((l) => `<tr><td>${l.description} ×${parseFloat(l.quantity)}</td><td class="right">€${parseFloat(l.total).toFixed(2)}</td></tr>`).join("")}
    </table>
    <div class="divider"></div>
    <table>
      <tr><td>Subtotal</td><td class="right">€${parseFloat(invoice.subtotal).toFixed(2)}</td></tr>
      <tr><td>VAT</td><td class="right">€${parseFloat(invoice.taxAmount).toFixed(2)}</td></tr>
      <tr class="total"><td>Total</td><td class="right">€${parseFloat(invoice.total).toFixed(2)}</td></tr>
    </table>
    ${invoice.deliveryLocation ? `<div class="divider"></div><div style="font-size:11px;">Deliver to: ${invoice.deliveryLocation}</div>` : ""}
    <script>window.onload = () => window.print();</script>
  </body></html>`;
}

async function shareInvoice(invoice: InvoiceDetail) {
  const text = `${invoice.invoiceNumber} — ${invoice.customerName}\nTotal: €${parseFloat(invoice.total).toFixed(2)}\nDate: ${new Date(invoice.date).toLocaleDateString()}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: invoice.invoiceNumber, text });
      return;
    } catch {
      // fall through to clipboard on cancel/unsupported
    }
  }
  await navigator.clipboard.writeText(text);
  alert("Document summary copied to clipboard.");
}

export default function InvoiceReceipt() {
  const [query, setQuery] = useState("");
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [matches, setMatches] = useState<InvoiceListItem[]>([]);
  const [notFound, setNotFound] = useState<string | null>(null);

  const detailMutation = useMutation({
    mutationFn: async (id: string) => apiFetch<InvoiceDetail>(`/api/invoices/${id}`),
    onSuccess: (data) => { setInvoice(data); setMatches([]); setNotFound(null); },
    onError: () => setNotFound("Couldn't load that document."),
  });

  const searchMutation = useMutation({
    mutationFn: async (q: string) => {
      const all = await apiFetch<InvoiceListItem[]>("/api/invoices");
      const lower = q.toLowerCase();
      const found = all.filter((i) =>
        i.invoiceNumber.toLowerCase().includes(lower) ||
        i.customerName?.toLowerCase().includes(lower)
      );
      if (!found.length) throw new Error("not found");
      return found;
    },
    onSuccess: (found) => {
      setNotFound(null);
      setInvoice(null);
      if (found.length === 1) {
        detailMutation.mutate(found[0].id);
      } else {
        setMatches(found.slice(0, 20));
      }
    },
    onError: () => { setInvoice(null); setMatches([]); setNotFound("No document found for that invoice number or customer name."); },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5" /> Invoice / Receipt Lookup</h1>
        <p className="text-sm text-muted-foreground">Search by invoice number, customer name, or scan a document barcode</p>
      </div>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) searchMutation.mutate(query.trim()); }}
          placeholder="Invoice number or customer name"
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

      <BarcodeScanner onScan={(code) => searchMutation.mutate(code)} />

      {notFound && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg p-3" data-testid="text-invoice-not-found">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {notFound}
        </div>
      )}

      {matches.length > 0 && (
        <div className="space-y-1.5" data-testid="list-invoice-matches">
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => detailMutation.mutate(m.id)}
              className="w-full text-left bg-card border border-border rounded-lg p-3 flex items-center justify-between"
              data-testid={`row-invoice-match-${m.id}`}
            >
              <div>
                <p className="text-sm font-medium">{m.invoiceNumber}</p>
                <p className="text-xs text-muted-foreground">{m.customerName} · {new Date(m.date).toLocaleDateString()}</p>
              </div>
              <span className="text-sm font-semibold">€{parseFloat(m.total).toFixed(2)}</span>
            </button>
          ))}
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

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => {
                const win = window.open("", "_blank", "width=400,height=600");
                if (!win) return;
                win.document.write(buildReceiptHtml(invoice));
                win.document.close();
              }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-muted py-2.5 text-sm font-medium"
              data-testid="button-print-invoice"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
            <button
              onClick={() => shareInvoice(invoice)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-medium"
              data-testid="button-share-invoice"
            >
              <Share2 className="w-4 h-4" /> Share
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
