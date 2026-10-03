import { useEffect, useState } from "react";
import { invoicePrintMode, saveInvoicePrintMode, type InvoicePrintMode } from "../lib/invoice-print";

export function InvoicePrintSettings() {
  const [mode, setMode] = useState<InvoicePrintMode>("dialog");
  const [error, setError] = useState("");
  useEffect(() => { try { setMode(invoicePrintMode()); } catch (e) { setError((e as Error).message); } }, []);
  return <section className="rounded-xl border border-current/20 p-4 space-y-3" data-testid="settings-a4-invoices">
    <h3 className="font-semibold">A4 invoice printing</h3>
    <p className="text-sm opacity-75">Invoices use A4 (210 × 297 mm), separately from thermal receipts. Choose the A4 printer or Save as PDF in the system print dialog.</p>
    <label className="flex items-center justify-between gap-3 text-sm">
      Before printing
      <select className="rounded border bg-background text-foreground p-2" value={mode} data-testid="select-invoice-print-mode"
        onChange={e => {
          const next = e.target.value as InvoicePrintMode;
          try { saveInvoicePrintMode(next); setMode(next); setError(""); }
          catch (error) { setError((error as Error).message); }
        }}>
        <option value="dialog">Open system print dialog</option>
        <option value="preview">Preview invoice first</option>
      </select>
    </label>
    <p className="text-xs opacity-75">Saved on this device. This setting does not change the receipt printer or cash drawer.</p>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
  </section>;
}