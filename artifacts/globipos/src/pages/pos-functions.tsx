import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Loader2, Plus, RefreshCw, Search, Trash2, Zap } from "lucide-react";
import { ACTION_GROUPS, ALL_ACTIONS } from "./pos-layout-editor";
import {
  configuredGroups, customFunctionKey, definitionKey, readCustomFunctions, readDefinition,
  validFunctionCode, voucherExampleRules, wouldCreateFunctionCycle,
  type FunctionDefinition, type PosSetting,
} from "@/lib/pos-function-config";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PosFunctionRules } from "@/components/pos-function-rules";
import { PosFunctionSimulator } from "@/components/pos-function-simulator";

const quickSaleActions = new Set(["PAY_CASH", "PAY_CARD", "VOID_SALE"]);
const MAX_STEPS = 20;
type Draft = FunctionDefinition & { label: string; description: string };

function summarizeRules(rules: FunctionDefinition["rules"]): string {
  const outcomes = {
    print_credit_note: "print credit-note voucher",
    propose_gift_voucher: "propose gift voucher amount",
    run_function: "call function",
    custom: "custom outcome",
  };
  return rules.map(rule =>
    `If ${rule.transactionType === "any" ? "sale/return" : rule.transactionType}, ${rule.receiptSign === "any" ? "any total" : `${rule.receiptSign} total`} → ${outcomes[rule.result]}${rule.result === "run_function" && rule.functionCode ? ` (${rule.functionCode})` : ""}`
  ).join("; ");
}

export default function PosFunctions() {
  const { toast } = useToast();
  const settings = useQuery<PosSetting[]>({
    queryKey: ["/api/settings"], staleTime: 0, refetchOnWindowFocus: true, refetchOnMount: "always",
  });
  const savedSettings = settings.data ?? [];
  const custom = useMemo(() => readCustomFunctions(savedSettings, ALL_ACTIONS), [settings.data]);
  const groups = useMemo(() => configuredGroups(ACTION_GROUPS, custom), [custom]);
  const actions = useMemo(() => groups.flatMap(group => group.actions), [groups]);
  const [selectedCode, setSelectedCode] = useState(ALL_ACTIONS[0].code);
  const [draft, setDraft] = useState<Draft>({ behavior: "", mode: "single", steps: [], rules: [], label: "", description: "" });
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [stepCode, setStepCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState("CUSTOM_");
  const [newLabel, setNewLabel] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const [newBehavior, setNewBehavior] = useState("");

  const selected = actions.find(action => action.code === selectedCode) || ALL_ACTIONS[0];
  const isCustom = custom.some(action => action.code === selected.code);
  const stored = readDefinition(savedSettings, selected.code, selected.description || "");

  useEffect(() => {
    if (!dirty) setDraft({ ...stored, label: selected.label, description: selected.description || "" });
  }, [selectedCode, settings.data, dirty]);

  function update(patch: Partial<Draft>) {
    setDraft(previous => ({ ...previous, ...patch }));
    setDirty(true);
  }

  function leaveUnsaved(): boolean {
    return !dirty || window.confirm("Discard your unsaved function changes?");
  }

  function selectFunction(code: string) {
    if (save.isPending || create.isPending || code === selectedCode || !leaveUnsaved()) return;
    const action = actions.find(item => item.code === code)!;
    setSelectedCode(code);
    setDraft({ ...readDefinition(savedSettings, code, action.description || ""), label: action.label, description: action.description || "" });
    setDirty(false);
    setCreating(false);
    setStepCode("");
  }

  const save = useMutation({
    mutationFn: async () => {
      const behavior = draft.behavior.trim();
      const label = draft.label.trim();
      if (!behavior) throw new Error("Enter a behavior before saving.");
      if (isCustom && (!label || label.length > 80 || draft.description.length > 200)) {
        throw new Error("Custom functions need a name (up to 80 characters) and a purpose of up to 200 characters.");
      }
      if (draft.mode === "macro" &&
          (!draft.steps.length || draft.steps.length > MAX_STEPS ||
           draft.steps.some(code => !actions.some(action => action.code === code)))) {
        throw new Error("Add between 1 and 20 valid macro steps.");
      }
      if (draft.mode === "conditional" &&
          (!draft.rules.length || draft.rules.length > MAX_STEPS ||
           draft.rules.some(rule => rule.note.length > 500 ||
             (rule.result === "custom" && !rule.note.trim()) ||
             (rule.result === "run_function" && !actions.some(action => action.code === rule.functionCode))))) {
        throw new Error("Add valid conditional rules. A custom outcome needs details; a called function must exist.");
      }
      const definition: FunctionDefinition = {
        behavior, mode: draft.mode, steps: draft.mode === "macro" ? draft.steps : [],
        rules: draft.mode === "conditional" ? draft.rules : [],
      };
      if (wouldCreateFunctionCycle(selected.code, definition, actions, savedSettings)) {
        throw new Error("This setup calls itself through a macro or conditional rule. Remove the loop.");
      }
      const entries = [{
        key: definitionKey(selected.code),
        value: JSON.stringify(definition),
        label: selected.label,
        group: "POS Functions",
      }];
      if (isCustom) entries.push({
        key: customFunctionKey(selected.code),
        value: JSON.stringify({ code: selected.code, label, description: draft.description.trim() }),
        label,
        group: "POS Functions",
      });
      await apiRequest("PUT", "/api/settings", { settings: entries });
    },
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Function setup saved", description: "Behavior, steps and conditions are saved as specifications; they do not execute on the POS yet." });
    },
    onError: (error: Error) => toast({ title: "Could not save function", description: error.message, variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: async () => {
      const code = newCode.trim().toUpperCase().replace(/[\s-]+/g, "_");
      const label = newLabel.trim();
      const description = newPurpose.trim();
      const behavior = newBehavior.trim();
      if (!validFunctionCode(code)) throw new Error("Use CUSTOM_ followed by letters, numbers or underscores, starting with a letter.");
      if (actions.some(action => action.code === code)) throw new Error("That function code already exists.");
      if (!label || !description || !behavior) throw new Error("Enter a name, purpose and behavior.");
      if (label.length > 80 || description.length > 200 || behavior.length > 2000) throw new Error("The name, purpose or behavior is too long.");
      await apiRequest("PUT", "/api/settings", {
        settings: [
          { key: customFunctionKey(code), value: JSON.stringify({ code, label, description }), label, group: "POS Functions" },
          { key: definitionKey(code), value: JSON.stringify({ behavior, mode: "single", steps: [], rules: [] }), label, group: "POS Functions" },
        ],
      });
      return code;
    },
    onSuccess: async code => {
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setSelectedCode(code);
      setDirty(false);
      setCreating(false);
      setNewCode("CUSTOM_"); setNewLabel(""); setNewPurpose(""); setNewBehavior("");
      setSearch("");
      toast({ title: "Function created", description: "You can now add it to a POS layout. It will not run until its checkout handler is implemented." });
    },
    onError: (error: Error) => toast({ title: "Could not create function", description: error.message, variant: "destructive" }),
  });

  const filteredGroups = groups.map(group => ({
    ...group,
    actions: group.actions.filter(action => {
      const definition = readDefinition(savedSettings, action.code, action.description || "");
      return `${action.label} ${action.code} ${action.description} ${definition.behavior} ${summarizeRules(definition.rules)} ${definition.rules.map(rule => rule.note).join(" ")} ${group.group}`.toLowerCase().includes(search.toLowerCase().trim());
    }),
  })).filter(group => group.actions.length);
  const definedCount = actions.filter(action => savedSettings.some(setting => setting.key === definitionKey(action.code) && setting.value)).length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="POS Functions" description="List, edit and create function behaviors, macros and conditional rules." />
        <Button asChild variant="outline" size="sm"><Link href="/pos/layouts"><ArrowLeft className="mr-2 h-4 w-4" />POS layouts</Link></Button>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Setup only — not live checkout logic.</strong> New functions appear in the layout editor, but custom functions, conditional rules and saved macro steps
        do not run at checkout. Quick Sale currently handles cash, card and void sale; the browser Terminal has a separate implementation.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">All functions</CardTitle>
              <Badge variant="secondary">{actions.length} listed</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{definedCount} saved definitions · {custom.length} custom functions</p>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search POS functions" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search functions or behavior…" className="pl-9" />
              </div>
              <Button size="sm" onClick={() => { if (leaveUnsaved()) setCreating(true); }} disabled={save.isPending || create.isPending}>
                <Plus className="mr-1 h-4 w-4" />New
              </Button>
              <Button variant="outline" size="icon" aria-label="Refresh function list" title="Refresh function list" onClick={() => settings.refetch()} disabled={settings.isFetching}>
                <RefreshCw className={`h-4 w-4 ${settings.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="max-h-[68vh] space-y-5 overflow-y-auto pt-0">
            {filteredGroups.map(group => {
              const GroupIcon = group.icon;
              return (
                <section key={group.group}>
                  <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <GroupIcon className={`h-4 w-4 ${group.color}`} />{group.group}<span>({group.actions.length})</span>
                  </h2>
                  <div className="space-y-1">
                    {group.actions.map(action => {
                      const Icon = action.icon;
                      const definition = readDefinition(savedSettings, action.code, action.description || "");
                      return (
                        <button key={action.code} type="button" onClick={() => selectFunction(action.code)}
                          disabled={save.isPending || create.isPending}
                          aria-current={!creating && selectedCode === action.code ? "true" : undefined}
                          className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted ${!creating && selectedCode === action.code ? "border-primary bg-primary/5" : "border-transparent"}`}
                          data-testid={`pos-function-${action.code}`}>
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{action.label}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {definition.mode === "macro" ? `Macro · ${definition.steps.length} steps · ` : definition.mode === "conditional" ? `Conditions · ${definition.rules.length} rules · ` : ""}
                              {definition.behavior}
                            </span>
                            {definition.mode === "conditional" && definition.rules.length > 0 &&
                              <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground" title={summarizeRules(definition.rules)}>{summarizeRules(definition.rules)}</span>}
                          </span>
                          {savedSettings.some(setting => setting.key === definitionKey(action.code) && setting.value) &&
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-label="Definition saved" />}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {!filteredGroups.length && <p className="text-sm text-muted-foreground">No functions match your search.</p>}
          </CardContent>
        </Card>

        {creating ? (
          <Card className="min-w-0 self-start">
            <CardHeader><CardTitle>Create a function</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Create its name and behavior here. Then select it to set up macro steps or conditions.</p>
              <div><label htmlFor="new-function-name" className="text-sm font-medium">Name</label>
                <Input id="new-function-name" maxLength={80} value={newLabel} onChange={event => setNewLabel(event.target.value)} placeholder="e.g. Redeem Staff Meal" /></div>
              <div><label htmlFor="new-function-code" className="text-sm font-medium">Function code</label>
                <Input id="new-function-code" maxLength={40} value={newCode} onChange={event => setNewCode(event.target.value.toUpperCase().replace(/[\s-]+/g, "_"))} placeholder="CUSTOM_STAFF_MEAL" />
                <p className="mt-1 text-xs text-muted-foreground">Start with CUSTOM_ to keep it distinct from built-in functions. This layout-button ID cannot be changed later.</p></div>
              <div><label htmlFor="new-function-purpose" className="text-sm font-medium">Short purpose</label>
                <Input id="new-function-purpose" maxLength={200} value={newPurpose} onChange={event => setNewPurpose(event.target.value)} placeholder="What this button is for" /></div>
              <div><label htmlFor="new-function-behavior" className="text-sm font-medium">Behavior</label>
                <Textarea id="new-function-behavior" maxLength={2000} rows={5} value={newBehavior} onChange={event => setNewBehavior(event.target.value)} placeholder="What should happen when pressed?" /></div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
                <Button disabled={settings.isLoading || settings.isError || create.isPending || !newCode || !newLabel.trim() || !newPurpose.trim() || !newBehavior.trim()} onClick={() => create.mutate()}>
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create function
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="min-w-0 self-start">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><CardTitle>{selected.label}</CardTitle><p className="mt-1 font-mono text-xs text-muted-foreground">{selected.code}</p></div>
                <Badge variant={quickSaleActions.has(selected.code) ? "secondary" : "outline"}>
                  {quickSaleActions.has(selected.code) ? "Quick Sale action exists" : "Not wired in Quick Sale"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {isCustom ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><label htmlFor="edit-function-name" className="text-sm font-medium">Function name</label>
                    <Input id="edit-function-name" maxLength={80} value={draft.label} onChange={event => update({ label: event.target.value })} /></div>
                  <div><label htmlFor="edit-function-purpose" className="text-sm font-medium">Short purpose</label>
                    <Input id="edit-function-purpose" maxLength={200} value={draft.description} onChange={event => update({ description: event.target.value })} /></div>
                </div>
              ) : (
                <div className="rounded-md bg-muted/60 p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Built-in purpose</h2>
                  <p className="mt-1 text-sm">{selected.description}</p>
                </div>
              )}
              <div>
                <label htmlFor="function-behavior" className="text-sm font-semibold">Behavior</label>
                <p className="mt-1 text-sm text-muted-foreground">Describe required input, permissions, offline rules and expected result.</p>
                <Textarea id="function-behavior" value={draft.behavior} maxLength={2000} rows={6}
                  onChange={event => update({ behavior: event.target.value })}
                  className="mt-3 resize-y" placeholder="Describe the behavior…" data-testid="input-pos-function-behavior" />
                <p className="mt-1 text-right text-xs text-muted-foreground">{draft.behavior.length}/2000</p>
              </div>
              <fieldset className="space-y-3 rounded-md border p-4">
                <legend className="px-1 text-sm font-semibold">Setup type</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" checked={draft.mode === "single"} onChange={() => update({ mode: "single" })} />Single function</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={draft.mode === "macro"} onChange={() => update({ mode: "macro" })} />Macro (ordered steps)</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={draft.mode === "conditional"} onChange={() => update({ mode: "conditional" })} />Conditions (if / then)</label>
                </div>
                {draft.mode === "macro" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">Choose existing functions in order. Steps are saved as a setup plan; they do not run at checkout.</p>
                    <ol className="space-y-2">
                      {draft.steps.map((code, index) => (
                        <li key={`${index}-${code}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                          <span className="min-w-0 flex-1 truncate">{index + 1}. {actions.find(action => action.code === code)?.label || `Missing function: ${code}`}</span>
                          <Button aria-label={`Move step ${index + 1} up`} size="icon" variant="ghost" disabled={!index} onClick={() => {
                            const next = [...draft.steps]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update({ steps: next });
                          }}><ArrowUp className="h-4 w-4" /></Button>
                          <Button aria-label={`Move step ${index + 1} down`} size="icon" variant="ghost" disabled={index === draft.steps.length - 1} onClick={() => {
                            const next = [...draft.steps]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; update({ steps: next });
                          }}><ArrowDown className="h-4 w-4" /></Button>
                          <Button aria-label={`Remove step ${index + 1}`} size="icon" variant="ghost" onClick={() => update({ steps: draft.steps.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button>
                        </li>
                      ))}
                    </ol>
                    <div className="flex gap-2">
                      <select aria-label="Choose macro step" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
                        value={stepCode} onChange={event => setStepCode(event.target.value)}>
                        <option value="">Choose a function…</option>
                        {groups.map(group => <optgroup key={group.group} label={group.group}>
                          {group.actions.filter(action => action.code !== selected.code).map(action =>
                            <option key={action.code} value={action.code}>{action.label} ({action.code})</option>)}
                        </optgroup>)}
                      </select>
                      <Button variant="outline" disabled={!stepCode || draft.steps.length >= MAX_STEPS} onClick={() => { update({ steps: [...draft.steps, stepCode] }); setStepCode(""); }}>
                        <Plus className="mr-1 h-4 w-4" />Add step
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">{draft.steps.length}/{MAX_STEPS} steps. Repeated steps are allowed; recursive macros are not.</p>
                  </div>
                )}
                {draft.mode === "conditional" && (
                  <PosFunctionRules
                    code={selected.code} rules={draft.rules} actions={actions} onChange={rules => update({ rules })}
                    onLoadVoucherExample={selected.code === "PAY_VOUCHER" ? () => {
                      if (draft.rules.length && !window.confirm("Replace the current unsaved rules with the voucher example?")) return;
                      update({ rules: voucherExampleRules() });
                    } : undefined}
                  />
                )}
              </fieldset>
              {settings.isSuccess && (
                <>
                  <PosFunctionSimulator key={selected.code} code={selected.code} definition={draft}
                    actions={actions} settings={savedSettings} unsaved={dirty} />
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                    <span>To test the saved function on a real layout with items and a receipt, open a layout simulation.</span>
                    <Button asChild variant="outline" size="sm"><Link href="/pos/layouts">Choose layout to simulate</Link></Button>
                  </div>
                </>
              )}
              {selected.code === "PAY_VOUCHER" && <p className="rounded-md border p-3 text-sm text-muted-foreground">For vouchers, specify gift balance vs coupon, code validation, partial use, expiry and refund rules.</p>}
              {settings.isError && <p role="alert" className="text-sm text-destructive">Could not load settings. Refresh before editing.</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={save.isPending} onClick={() => {
                  setDraft({ ...stored, label: selected.label, description: selected.description || "" }); setDirty(false);
                }}>Discard edits</Button>
                <Button onClick={() => save.mutate()} disabled={!dirty || !draft.behavior.trim() || save.isPending || settings.isLoading || settings.isError}
                  data-testid="button-save-pos-function">
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}Save setup
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}