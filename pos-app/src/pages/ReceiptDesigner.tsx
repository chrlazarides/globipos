import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ReceiptTextIcon, Loader2Icon, ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon, PrinterIcon,
} from "lucide-react";
import type { PrintReceiptLine } from "../hooks/useHardware";
import type { ReceiptConfig as ReceiptConfigType } from "../types";
import { getReceiptConfig, saveReceiptConfig } from "../lib/db";
import { buildReceiptLines } from "../lib/receipt";
import { formatCurrency } from "../lib/pricing";

interface ReceiptDesignerProps {
  terminalCode: string;
  onClose: () => void;
}

const TOGGLES: { key: keyof ReceiptConfigType; label: string }[] = [
  { key: "show_terminal",        label: "Terminal code" },
  { key: "show_cashier",         label: "Cashier name" },
  { key: "show_order_number",    label: "Order number" },
  { key: "show_datetime",        label: "Date & time" },
  { key: "show_subtotal",        label: "Subtotal line" },
  { key: "show_vat",             label: "VAT line" },
  { key: "show_payment_method",  label: "Payment method" },
  { key: "show_tendered_change", label: "Tendered / change" },
  { key: "show_card_ref",        label: "Card reference" },
];

function LineListEditor({ title, lines, onChange, testPrefix }: {
  title: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  testPrefix: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <h2 className="text-white text-sm font-medium mb-3">{title}</h2>
      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={line}
              maxLength={128}
              onChange={(e) => onChange(lines.map((l, j) => (j === i ? e.target.value : l)))}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm"
              data-testid={`input-${testPrefix}-line-${i}`}
            />
            <button
              onClick={() => onChange(lines.filter((_, j) => j !== i))}
              className="text-gray-500 hover:text-red-400 transition-colors"
              data-testid={`button-${testPrefix}-remove-${i}`}
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        ))}
        {lines.length < 10 && (
          <button
            onClick={() => onChange([...lines, ""])}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white rounded-lg py-2 text-xs font-medium transition-colors"
            data-testid={`button-${testPrefix}-add`}
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Add line
          </button>
        )}
      </div>
    </div>
  );
}

export function ReceiptDesigner({ terminalCode, onClose }: ReceiptDesignerProps) {
  const [config, setConfig] = useState<ReceiptConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [printerColumns, setPrinterColumns] = useState(42);

  useEffect(() => {
    getReceiptConfig()
      .then(setConfig)
      .catch((e) => setError(e?.message ?? "Failed to load receipt configuration"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    invoke<{ printer_columns?: number }>("get_hardware_config")
      .then((hardware) => setPrinterColumns(Math.max(24, hardware.printer_columns ?? 42)))
      .catch(() => setPrinterColumns(42));
  }, []);

  async function handleSave() {
    if (!config) return;
    setError(null);
    setSaving(true);
    try {
      await saveReceiptConfig({
        ...config,
        header_lines: config.header_lines.filter((l) => l.trim() !== ""),
        footer_lines: config.footer_lines.filter((l) => l.trim() !== ""),
      });
      setToast("Receipt design saved");
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message ?? "Failed to save receipt design");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestPrint() {
    if (!config) return;
    setError(null);
    setPrinting(true);

    const now = new Date().toISOString();
    const testOrder = {
      id: "test", order_number: "TEST-0001", status: "completed" as const,
      cashier_id: "test", cashier_name: "Test Cashier", price_level: 1,
      order_discount_pct: 0, order_discount_fixed: 0, surcharge_pct: 0,
      surcharge_amount: 0, subtotal: 18.30, discount_amount: 0, vat_amount: 0.87,
      total: 18.30, created_at: now,
    };
    const testLines = [
      { id: "test-a", order_id: "test", description: "Test Product A", qty: 2, unit_price: 3.90, line_discount_pct: 0, line_discount_fixed: 0, line_surcharge_pct: 0, vat_rate: 5, line_total: 7.80, vat_amount: 0.37, voided: false },
      { id: "test-b", order_id: "test", description: "Test Product B", qty: 1, unit_price: 10.50, line_discount_pct: 0, line_discount_fixed: 0, line_surcharge_pct: 0, vat_rate: 5, line_total: 10.50, vat_amount: 0.50, voided: false },
    ];
    const lines: PrintReceiptLine[] = buildReceiptLines(config, {
      terminalCode, cashierName: "Test Cashier", order: testOrder, lines: testLines,
      paymentMethod: "card_test", paymentRef: "TEST-123456", totalTendered: 20,
      changeDue: 1.70, currency: formatCurrency, width: printerColumns,
    });

    try {
      await invoke("print_receipt", { lines });
      setToast("Test receipt printed");
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message ?? "Failed to print test receipt");
    } finally {
      setPrinting(false);
    }
  }

  // ── Live preview ────────────────────────────────────────────────────────────
  const preview = config ? buildReceiptLines(config, {
    terminalCode, cashierName: "Test Cashier",
    order: { id: "preview", order_number: "000123", status: "completed", cashier_id: "test", cashier_name: "Test Cashier", price_level: 1, order_discount_pct: 0, order_discount_fixed: 0, surcharge_pct: 0, surcharge_amount: 0, subtotal: 18.30, discount_amount: 0, vat_amount: 0.87, total: 18.30, created_at: new Date().toISOString() },
    lines: [
      { id: "p1", order_id: "preview", description: "Halloumi 250g", qty: 2, unit_price: 3.90, line_discount_pct: 0, line_discount_fixed: 0, line_surcharge_pct: 0, vat_rate: 5, line_total: 7.80, vat_amount: 0.37, voided: false },
      { id: "p2", order_id: "preview", description: "Olive oil 1L", qty: 1, unit_price: 10.50, line_discount_pct: 0, line_discount_fixed: 0, line_surcharge_pct: 0, vat_rate: 5, line_total: 10.50, vat_amount: 0.50, voided: false },
    ], paymentMethod: "cash", currency: formatCurrency, width: printerColumns,
  }) : [];

  return (
    <div className="fixed inset-0 z-40 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-3">
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" data-testid="button-receipt-designer-close">
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <ReceiptTextIcon className="w-5 h-5 text-amber-400" />
          <h1 className="text-white font-semibold">Receipt Design</h1>
        </div>
        {toast && (
          <div className="ml-auto flex items-center gap-1.5 text-green-400 text-sm" data-testid="text-receipt-designer-toast">
            <CheckIcon className="w-4 h-4" />
            {toast}
          </div>
        )}
        <div className={toast ? "flex items-center gap-2" : "ml-auto flex items-center gap-2"}>
          <button
            onClick={handleTestPrint}
            disabled={printing || saving || loading || !config}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            data-testid="button-receipt-designer-test-print"
          >
            {printing ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <PrinterIcon className="w-4 h-4" />}
            Test Print
          </button>
          <button
            onClick={handleSave}
            disabled={saving || printing || loading || !config}
            className="flex items-center gap-1.5 bg-burgundy-700 hover:bg-burgundy-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            data-testid="button-receipt-designer-save"
          >
            {saving ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <CheckIcon className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="max-w-5xl mx-auto bg-red-950/40 border border-red-800/50 rounded-xl p-3 mb-4 text-red-300 text-sm" data-testid="text-receipt-designer-error">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2Icon className="w-8 h-8 text-gray-600 animate-spin" />
          </div>
        ) : config ? (
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: settings */}
            <div className="space-y-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h2 className="text-white text-sm font-medium mb-2">Header title</h2>
                <input
                  value={config.header_title}
                  maxLength={64}
                  placeholder={terminalCode}
                  onChange={(e) => setConfig({ ...config, header_title: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm"
                  data-testid="input-receipt-header-title"
                />
                <p className="text-gray-600 text-xs mt-1.5">Printed large and bold at the top. Leave empty to use the terminal code.</p>
              </div>

              <LineListEditor
                title="Header lines (address, phone, tax ID, ...)"
                lines={config.header_lines}
                onChange={(header_lines) => setConfig({ ...config, header_lines })}
                testPrefix="receipt-header"
              />
              <LineListEditor
                title="Footer lines (thank-you message, return policy, ...)"
                lines={config.footer_lines}
                onChange={(footer_lines) => setConfig({ ...config, footer_lines })}
                testPrefix="receipt-footer"
              />

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h2 className="text-white text-sm font-medium mb-3">Sections to print</h2>
                <div className="grid grid-cols-2 gap-2">
                  {TOGGLES.map((t) => (
                    <label key={t.key} className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config[t.key] as boolean}
                        onChange={(e) => setConfig({ ...config, [t.key]: e.target.checked })}
                        className="w-4 h-4"
                        data-testid={`checkbox-receipt-${t.key}`}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: live preview */}
            <div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 lg:sticky lg:top-0">
                <h2 className="text-white text-sm font-medium mb-3">Preview</h2>
                <div
                  className="bg-[#fffdf7] text-[#242321] rounded-lg px-3 py-5 font-mono text-[11px] leading-[1.45] whitespace-pre overflow-x-auto shadow-[0_10px_30px_rgba(0,0,0,0.22)] mx-auto"
                  style={{ width: `${printerColumns}ch`, maxWidth: "100%", minWidth: "250px" }}
                  data-testid="receipt-preview"
                >
                  {preview.map((line, i) => (
                    <div key={i} className={`${line.align === "center" ? "text-center" : line.align === "right" ? "text-right" : ""} ${line.bold ? "font-bold" : ""} ${line.size === "big" ? "text-sm" : ""}`}>
                      {line.divider ? line.text ?? "-".repeat(printerColumns) : line.text || "\u00A0"}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
