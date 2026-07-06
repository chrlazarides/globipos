import { useState, useEffect } from "react";
import {
  BarcodeIcon, Loader2Icon, ArrowLeftIcon, CheckIcon, PlusIcon, TrashIcon, ScaleIcon,
} from "lucide-react";
import type { BarcodeConfig as BarcodeConfigType, BarcodeRule, BarcodeRuleKind } from "../types";
import { getBarcodeConfig, saveBarcodeConfig } from "../lib/db";

interface BarcodeConfigProps {
  onClose: () => void;
}

const KIND_OPTIONS: { value: BarcodeRuleKind; label: string; color: string }[] = [
  { value: "weight", label: "Weight", color: "emerald" },
  { value: "price",  label: "Price",  color: "amber" },
  { value: "plu",    label: "PLU only", color: "sky" },
];

const badgeMap: Record<string, string> = {
  emerald: "bg-emerald-900/40 border-emerald-700 text-emerald-300",
  amber:   "bg-amber-900/40 border-amber-700 text-amber-300",
  sky:     "bg-sky-900/40 border-sky-700 text-sky-300",
};

function emptyRule(): BarcodeRule {
  return {
    id: `rule-${Date.now()}`,
    label: "New rule",
    prefix: "",
    kind: "weight",
    plu_digits: 5,
    value_digits: 5,
    value_divisor: 1000,
    check_digit: true,
    enabled: true,
  };
}

/** Total digit width implied by a rule — must equal 13 for a valid EAN-13 scale barcode. */
function ruleLength(r: BarcodeRule): number {
  return r.prefix.length + (r.plu_digits || 0) + (r.value_digits || 0) + (r.check_digit ? 1 : 0);
}

export function BarcodeConfig({ onClose }: BarcodeConfigProps) {
  const [config, setConfig] = useState<BarcodeConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getBarcodeConfig()
      .then(setConfig)
      .catch((e) => setError(e?.message ?? "Failed to load barcode configuration"))
      .finally(() => setLoading(false));
  }, []);

  function updateRule(id: string, patch: Partial<BarcodeRule>) {
    setConfig((prev) =>
      prev ? { ...prev, rules: prev.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : prev
    );
  }

  function addRule() {
    setConfig((prev) => (prev ? { ...prev, rules: [...prev.rules, emptyRule()] } : prev));
  }

  function removeRule(id: string) {
    setConfig((prev) => (prev ? { ...prev, rules: prev.rules.filter((r) => r.id !== id) } : prev));
  }

  async function handleSave() {
    if (!config) return;
    setError(null);
    setSaving(true);
    try {
      await saveBarcodeConfig(config);
      setToast("Barcode structure saved");
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message ?? "Failed to save — check for overlapping prefixes or bad digit widths");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-3">
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" data-testid="button-barcode-config-close">
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <BarcodeIcon className="w-5 h-5 text-amber-400" />
          <h1 className="text-white font-semibold">Barcode Structure</h1>
        </div>
        {toast && (
          <div className="ml-auto flex items-center gap-1.5 text-green-400 text-sm" data-testid="text-barcode-config-toast">
            <CheckIcon className="w-4 h-4" />
            {toast}
          </div>
        )}
        {!toast && (
          <button
            onClick={handleSave}
            disabled={saving || loading || !config}
            className="ml-auto flex items-center gap-1.5 bg-burgundy-700 hover:bg-burgundy-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
            data-testid="button-barcode-config-save"
          >
            {saving ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <CheckIcon className="w-4 h-4" />}
            Save
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto">
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4 mb-6 flex items-start gap-3">
            <ScaleIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200 text-sm">
              Weighted-item barcodes (scale labels and manufacturer weight PLUs) start with a
              fixed prefix, followed by a PLU segment and an embedded value segment, then a
              check digit — total 13 digits. Define one rule per prefix so the POS can
              recognise weight vs. price vs. plain-PLU codes exactly as your scales and
              suppliers print them.
            </p>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-xl p-3 mb-4 text-red-300 text-sm" data-testid="text-barcode-config-error">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2Icon className="w-8 h-8 text-gray-600 animate-spin" />
            </div>
          ) : config ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="w-4 h-4"
                  data-testid="checkbox-barcode-config-enabled"
                />
                <span className="text-white text-sm font-medium">Enable weight/scale barcode recognition</span>
              </label>

              {config.rules.map((rule) => {
                const len = ruleLength(rule);
                const kindMeta = KIND_OPTIONS.find((k) => k.value === rule.kind)!;
                return (
                  <div
                    key={rule.id}
                    className="bg-gray-900 border border-gray-800 rounded-xl p-4"
                    data-testid={`barcode-rule-${rule.id}`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <input
                        value={rule.label}
                        onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                        className="bg-transparent text-white font-medium text-sm border-b border-transparent hover:border-gray-700 focus:border-burgundy-500 outline-none flex-1"
                        data-testid={`input-barcode-label-${rule.id}`}
                      />
                      <button
                        onClick={() => removeRule(rule.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
                        data-testid={`button-barcode-remove-${rule.id}`}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      <div>
                        <label className="text-gray-500 text-xs block mb-1">Prefix</label>
                        <input
                          value={rule.prefix}
                          onChange={(e) => updateRule(rule.id, { prefix: e.target.value.replace(/\D/g, "") })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm"
                          placeholder="28"
                          data-testid={`input-barcode-prefix-${rule.id}`}
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 text-xs block mb-1">PLU digits</label>
                        <input
                          type="number"
                          min={1}
                          value={rule.plu_digits}
                          onChange={(e) => updateRule(rule.id, { plu_digits: parseInt(e.target.value, 10) || 0 })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm"
                          data-testid={`input-barcode-plu-digits-${rule.id}`}
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 text-xs block mb-1">Value digits</label>
                        <input
                          type="number"
                          min={1}
                          value={rule.value_digits}
                          onChange={(e) => updateRule(rule.id, { value_digits: parseInt(e.target.value, 10) || 0 })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm"
                          data-testid={`input-barcode-value-digits-${rule.id}`}
                        />
                      </div>
                      <div>
                        <label className="text-gray-500 text-xs block mb-1">Divisor</label>
                        <input
                          type="number"
                          min={1}
                          value={rule.value_divisor}
                          onChange={(e) => updateRule(rule.id, { value_divisor: parseFloat(e.target.value) || 1 })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-white text-sm"
                          data-testid={`input-barcode-divisor-${rule.id}`}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {KIND_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => updateRule(rule.id, { kind: opt.value })}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                            rule.kind === opt.value ? badgeMap[opt.color] : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500"
                          }`}
                          data-testid={`button-barcode-kind-${opt.value}-${rule.id}`}
                        >
                          {opt.label}
                        </button>
                      ))}

                      <label className="flex items-center gap-1.5 ml-2 text-gray-400 text-xs">
                        <input
                          type="checkbox"
                          checked={rule.check_digit}
                          onChange={(e) => updateRule(rule.id, { check_digit: e.target.checked })}
                          className="w-3.5 h-3.5"
                          data-testid={`checkbox-barcode-checkdigit-${rule.id}`}
                        />
                        Validate check digit
                      </label>

                      <label className="flex items-center gap-1.5 ml-2 text-gray-400 text-xs">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                          className="w-3.5 h-3.5"
                          data-testid={`checkbox-barcode-enabled-${rule.id}`}
                        />
                        Enabled
                      </label>

                      <span
                        className={`ml-auto text-xs font-mono px-2 py-0.5 rounded ${
                          len === 13 ? "text-gray-500" : "bg-red-950/50 text-red-300"
                        }`}
                        data-testid={`text-barcode-length-${rule.id}`}
                      >
                        {len} / 13 digits{len !== 13 ? " — must total 13" : ""}
                      </span>
                    </div>

                    <p className="text-gray-600 text-xs">
                      {kindMeta.label === "Weight" && `e.g. "${rule.prefix}" + PLU (${rule.plu_digits} digits) + grams (${rule.value_digits} digits) → kg = value / ${rule.value_divisor}`}
                      {kindMeta.label === "Price" && `e.g. "${rule.prefix}" + PLU (${rule.plu_digits} digits) + cents (${rule.value_digits} digits) → price = value / ${rule.value_divisor}`}
                      {kindMeta.label === "PLU only" && `e.g. "${rule.prefix}" + PLU (${rule.plu_digits} digits) — added at qty 1, no embedded value`}
                    </p>
                  </div>
                );
              })}

              <button
                onClick={addRule}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white rounded-xl py-3 text-sm font-medium transition-colors"
                data-testid="button-barcode-add-rule"
              >
                <PlusIcon className="w-4 h-4" />
                Add rule
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
