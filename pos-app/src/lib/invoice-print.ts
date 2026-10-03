export type InvoicePrintMode = "dialog" | "preview";
const KEY = "globipos.invoice.a4-print-mode";

export function invoicePrintMode(storage: Pick<Storage, "getItem"> = localStorage): InvoicePrintMode {
  const value = storage.getItem(KEY);
  if (value === null) return "dialog";
  if (value !== "dialog" && value !== "preview") throw new Error("Invalid invoice print preference. Save it again in Settings.");
  return value;
}

export function saveInvoicePrintMode(mode: InvoicePrintMode, storage: Pick<Storage, "setItem"> = localStorage) {
  if (mode !== "dialog" && mode !== "preview") throw new Error("Invalid invoice print mode");
  storage.setItem(KEY, mode);
}

export function printInvoiceFrame(frame: HTMLIFrameElement | null) {
  const target = frame?.contentWindow;
  if (!target) throw new Error("The A4 invoice has not loaded yet.");
  target.focus();
  target.print();
}