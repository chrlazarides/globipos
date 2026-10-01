import { useState, useEffect } from "react";
import { ShieldIcon, WifiOffIcon, Loader2Icon, ArrowLeftIcon, CheckIcon } from "lucide-react";
import type { FallbackRule } from "../types";
import { getFallbackRules, updateFallbackRule } from "../lib/db";

interface FallbackRulesProps {
  onClose: () => void;
}

const BEHAVIOR_OPTIONS = [
  { value: "allow",              label: "Allow",              description: "Proceed without server confirmation", color: "green" },
  { value: "block",              label: "Block",              description: "Reject the operation entirely", color: "red" },
  { value: "block_with_message", label: "Block (with prompt)", description: "Block but show explanation to cashier", color: "amber" },
];

export function FallbackRules({ onClose }: FallbackRulesProps) {
  const [rules, setRules]   = useState<FallbackRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast]   = useState<string | null>(null);

  useEffect(() => {
    getFallbackRules().then(setRules).finally(() => setLoading(false));
  }, []);

  async function handleChange(ruleKey: string, behavior: string) {
    setSaving(ruleKey);
    try {
      await updateFallbackRule(ruleKey, behavior);
      setRules((prev) =>
        prev.map((r) =>
          r.rule_key === ruleKey ? { ...r, offline_behavior: behavior as FallbackRule["offline_behavior"] } : r
        )
      );
      setToast("Rule saved");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setToast("Failed to save");
    } finally {
      setSaving(null);
    }
  }

  const colorFor = (v: string) =>
    BEHAVIOR_OPTIONS.find((o) => o.value === v)?.color ?? "gray";

  const bgMap: Record<string, string> = {
    green: "bg-green-900/40 border-green-700 text-green-300",
    red:   "bg-red-900/40 border-red-700 text-red-300",
    amber: "bg-amber-900/40 border-amber-700 text-amber-300",
    gray:  "bg-gray-800 border-gray-700 text-gray-300",
  };

  return (
    <div className="fixed inset-0 z-40 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-3">
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeftIcon className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldIcon className="w-5 h-5 text-amber-400" />
          <h1 className="text-white font-semibold">Offline Fallback Rules</h1>
        </div>
        {toast && (
          <div className="ml-auto flex items-center gap-1.5 text-green-400 text-sm">
            <CheckIcon className="w-4 h-4" />
            {toast}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-4 mb-6 flex items-start gap-3">
            <WifiOffIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200 text-sm">
              These rules control what happens when the terminal cannot reach the server within 800ms.
              Changes take effect immediately on this terminal.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2Icon className="w-8 h-8 text-gray-600 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div
                  key={rule.rule_key}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4"
                  data-testid={`fallback-rule-${rule.rule_key}`}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h3 className="text-white font-medium text-sm">{rule.label}</h3>
                      {rule.description && (
                        <p className="text-gray-500 text-xs mt-0.5">{rule.description}</p>
                      )}
                    </div>
                    {saving === rule.rule_key && (
                      <Loader2Icon className="w-4 h-4 text-gray-500 animate-spin flex-shrink-0" />
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {BEHAVIOR_OPTIONS.map((opt) => {
                      const isSelected = rule.offline_behavior === opt.value;
                      const classes = isSelected
                        ? `${bgMap[opt.color]} border`
                        : "bg-gray-800 border border-gray-700 text-gray-500 hover:border-gray-500";
                      return (
                        <button
                          key={opt.value}
                          onClick={() => handleChange(rule.rule_key, opt.value)}
                          disabled={saving === rule.rule_key}
                          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors text-left ${classes}`}
                          data-testid={`fallback-${rule.rule_key}-${opt.value}`}
                        >
                          <div className="font-semibold">{opt.label}</div>
                          <div className="mt-0.5 opacity-70 leading-tight">{opt.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
