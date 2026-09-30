import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Loader2, Plus, RefreshCw, Search, Trash2, Zap } from "lucide-react";
import { ACTION_GROUPS, ALL_ACTIONS } from "./pos-layout-editor";
import {
  cloneFunctionDefinition, configuredGroups, customFunctionKey, definitionKey, readCustomFunctions, readDefinition,
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
  const groups = useMemo(() => configuredGroups(ACTION_GROUPS, custom, savedSettings), [custom, settings.data]);
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
  const [cloneTemplate, setCloneTemplate] = useState<FunctionDefinition | null>(null);
  const [cloneSource, setCloneSource] = useState("");

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

  function beginCreation(clone = false) {
    if (!leaveUnsaved()) return;
    const source = cloneFunctionDefinition(stored);
    setDraft({ ...stored, label: selected.label, description: selected.description || "" });
    setDirty(false);
    setCloneTemplate(clone ? source : null);
    setCloneSource(clone ? selected.label : "");
    setNewCode("CUSTOM_");
    setNewLabel(clone ? `${selected.label} Copy`.slice(0, 80) : "");
    setNewPurpose(clone ? selected.description || "" : "");
    setNewBehavior(clone ? source.behavior : "");
    setCreating(true);
  }

  const save = useMutation({
    mutationFn: async (approved: boolean) => {
      const behavior = draft.behavior.trim();
      const label = draft.label.trim();
      if (!behavior) throw new Error("Enter a behavior before saving.");
      if (!label || label.length > 80 || (isCustom && draft.description.length > 200)) {
        throw new Error("Enter a function name of up to 80 characters and a purpose of up to 200 characters.");
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
        rules: draft.mode === "conditional" ? draft.rules : [], approved,
        label: isCustom ? undefined : label,
      };
      if (wouldCreateFunctionCycle(selected.code, definition, actions, savedSettings)) {
        throw new Error("This setup calls itself through a macro or conditional rule. Remove the loop.");
      }
      const entries = [{
        key: definitionKey(selected.code),
        value: JSON.stringify(definition),
        label,
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
    onSuccess: async (_data, approved) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setDirty(false);
      toast({ title: approved ? "Function setup approved" : "Function draft saved",
        description: "Approval records this setup for the function list; it does not by itself activate checkout or printing behavior." });
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
      const latest = await settings.refetch();
      if (latest.isError || !latest.data) throw new Error("Could not verify the current function list. Refresh and try again.");
      if ([...ALL_ACTIONS, ...readCustomFunctions(latest.data, ALL_ACTIONS)].some(action => action.code === code)) {
        throw new Error("That function code already exists.");
      }
      if (!label || !description || !behavior) throw new Error("Enter a name, purpose and behavior.");
      if (label.length > 80 || description.length > 200 || behavior.length > 2000) throw new Error("The name, purpose or behavior is too long.");
      const definition: FunctionDefinition = cloneTemplate
        ? cloneFunctionDefinition(cloneTemplate, behavior)
        : { behavior, mode: "single", steps: [], rules: [], approved: false };
      if (wouldCreateFunctionCycle(code, definition, [...actions, { code, label, description, icon: Zap }], savedSettings)) {
        throw new Error("The copied setup would create a recursive function call.");
      }
      await apiRequest("PUT", "/api/settings", {
        settings: [
          { key: customFunctionKey(code), value: JSON.stringify({ code, label, description }), label, group: "POS Functions" },
          { key: definitionKey(code), value: JSON.stringify(definition), label, group: "POS Functions" },
        ],
      });
      return code;
    },
    onSuccess: async code => {
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setSelectedCode(code);
      setDirty(false);
      setCreating(false);
      setCloneTemplate(null); setCloneSource("");
      setNewCode("CUSTOM_"); setNewLabel(""); setNewPurpose(""); setNewBehavior("");
      setSearch("");
      toast({ title: cloneTemplate ? "Function cloned as a draft" : "Function created as a draft",
        description: "Review its specific behavior, then use Save & approve when ready. Approval does not implement checkout behavior." });
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
  const approvedCount = actions.filter(action => readDefinition(savedSettings, action.code, "").approved).length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="POS Functions" description="Edit, rename, clone and approve function behavior setups." />
        <Button asChild variant="outline" size="sm"><Link href="/pos/layouts"><ArrowLeft className="mr-2 h-4 w-4" />POS layouts</Link></Button>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Approval is for the saved setup, not a checkout release.</strong> A badge confirms an admin saved the function as approved.
        It does not prove the behavior runs on a Terminal, issue vouchers or change payments. Test on a layout before rollout.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">All functions</CardTitle>
              <Badge variant="secondary">{actions.length} listed</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{approvedCount} approved · {definedCount} saved definitions · {custom.length} custom functions</p>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search POS functions" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search functions or behavior…" className="pl-9" />
              </div>
              <Button size="sm" onClick={() => beginCreation()} disabled={save.isPending || create.isPending || !settings.isSuccess}>
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
                          <Badge variant={definition.approved ? "default" : "outline"} className="mt-0.5 shrink-0 text-[10px]">
                            {definition.approved ? "Approved" : savedSettings.some(setting => setting.key === definitionKey(action.code) && setting.value) ? "Draft" : "Not set"}
                          </Badge>
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
            <CardHeader><CardTitle>{cloneTemplate ? `Clone ${cloneSource}` : "Create a function"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {cloneTemplate
                  ? `The new function copies the saved ${cloneTemplate.mode} setup and rules, but gets its own code and starts as a draft. Review it before approval.`
                  : "Create a draft with its own name and behavior. Then set up any macro steps or conditions and approve it."}
              </p>
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
                <Button variant="outline" onClick={() => { setCreating(false); setCloneTemplate(null); setCloneSource(""); }}>Cancel</Button>
                <Button disabled={settings.isLoading || settings.isError || create.isPending || !newCode || !newLabel.trim() || !newPurpose.trim() || !newBehavior.trim()} onClick={() => create.mutate()}>
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{cloneTemplate ? "Create clone" : "Create function"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="min-w-0 self-start">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><CardTitle>{selected.label}</CardTitle><p className="mt-1 font-mono text-xs text-muted-foreground">{selected.code}</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={stored.approved ? "default" : "outline"}>{stored.approved ? "Approved setup" : "Not approved"}</Badge>
                  <Badge variant={quickSaleActions.has(selected.code) ? "secondary" : "outline"}>
                    {quickSaleActions.has(selected.code) ? "Quick Sale action exists" : "Not wired in Quick Sale"}
                  </Badge>
                  <Button size="sm" variant="outline" disabled={save.isPending || create.isPending || !settings.isSuccess}
                    onClick={() => beginCreation(true)}><Copy className="mr-1 h-4 w-4" />Clone</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className={isCustom ? "grid gap-3 sm:grid-cols-2" : "space-y-2"}>
                <div><label htmlFor="edit-function-name" className="text-sm font-medium">Function name</label>
                  <Input id="edit-function-name" maxLength={80} value={draft.label} onChange={event => update({ label: event.target.value })} />
                  {!isCustom && <p className="mt-1 text-xs text-muted-foreground">The function code stays the same. Buttons already placed on layouts keep their own labels until edited there.</p>}
                </div>
                {isCustom && <div><label htmlFor="edit-function-purpose" className="text-sm font-medium">Short purpose</label>
                  <Input id="edit-function-purpose" maxLength={200} value={draft.description} onChange={event => update({ description: event.target.value })} /></div>}
              </div>
              {!isCustom && (
                <div className="rounded-md bg-muted/60 p-4">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Built-in purpose</h2>
                  <p className="mt-1 text-sm">{selected.description}</p>
                </div>
              )}
              {dirty && stored.approved && <p className="text-xs text-amber-800">These edits are not approved. Saving a draft removes approval; Save &amp; approve replaces the approved setup.</p>}
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
                <Button variant="outline" disabled={save.isPending || !dirty} onClick={() => {
                  setDraft({ ...stored, label: selected.label, description: selected.description || "" }); setDirty(false);
                }}>Discard edits</Button>
                {stored.approved && !dirty && <Button variant="outline" onClick={() => save.mutate(false)} disabled={save.isPending || !settings.isSuccess}>
                  Remove approval
                </Button>}
                <Button variant="outline" onClick={() => save.mutate(false)} disabled={!dirty || !draft.behavior.trim() || !draft.label.trim() || save.isPending || !settings.isSuccess}
                  data-testid="button-save-pos-function">
                  Save draft
                </Button>
                <Button onClick={() => save.mutate(true)} disabled={(!dirty && !!stored.approved) || !draft.behavior.trim() || !draft.label.trim() || save.isPending || !settings.isSuccess}
                  data-testid="button-approve-pos-function">
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Save &amp; approve
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}