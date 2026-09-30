import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Loader2, Plus, RefreshCw, Search, Trash2, Zap } from "lucide-react";
import { ACTION_GROUPS, ALL_ACTIONS } from "./pos-layout-editor";
import {
  cloneFunctionDefinition, configuredGroups, customFunctionKey, definitionKey, isExternalTargetApproved, readCustomFunctions, readDefinition,
  validExternalLaunch, validFunctionCode, voucherExampleRules, wouldCreateFunctionCycle,
  type ExternalLaunch, type FunctionDefinition, type MacroCondition, type PosSetting,
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
import { PosFunctionStatus } from "@/components/pos-function-status";

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

  function updateStepCondition(index: number, patch: Partial<MacroCondition>) {
    const conditions = draft.steps.map((_, i) => draft.stepConditions?.[i] ?? null);
    conditions[index] = { transactionType: "any", receiptSign: "any", ...conditions[index], ...patch };
    update({ stepConditions: conditions });
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
    mutationFn: async (intent: "draft" | "approve" | "approve-target" | "revoke-target") => {
      const approved = intent === "approve";
      const behavior = draft.behavior.trim();
      const label = draft.label.trim();
      if (!behavior) throw new Error("Enter a behavior before saving.");
      if (!label || label.length > 80 || (isCustom && draft.description.length > 200)) {
        throw new Error("Enter a function name of up to 80 characters and a purpose of up to 200 characters.");
      }
      if (draft.launch && !validExternalLaunch(draft.launch)) {
        throw new Error("Enter a valid URL or registered app link. Web destinations need http(s); apps need their own URI scheme.");
      }
      if (draft.launch && draft.mode !== "single") {
        throw new Error("An external destination needs Single function setup type.");
      }
      if (approved && ["OPEN_BROWSER", "RUN_EXTERNAL_PROGRAM"].includes(selected.code) && !draft.launch) {
        throw new Error("Configure an external destination before approving this button.");
      }
      if (intent === "approve-target" && !draft.launch) {
        throw new Error("Enter a valid external destination before approving the target.");
      }
      if (approved && draft.launch && !isExternalTargetApproved(draft)) {
        throw new Error("Approve this exact external target separately before approving the function.");
      }
      if (selected.code === "OPEN_BROWSER" && draft.launch && draft.launch.type === "app") {
        throw new Error("Browser in Journal needs a web address, not an app link.");
      }
      if (draft.mode === "macro" &&
          (!draft.steps.length || draft.steps.length > MAX_STEPS ||
           draft.steps.some(code => !actions.some(action => action.code === code)))) {
        throw new Error("Add between 1 and 20 valid macro steps.");
      }
      if (draft.mode === "macro" && draft.stepConditions?.some(condition => condition &&
          (!["any", "sale", "return"].includes(condition.transactionType) ||
           !["any", "positive", "negative", "zero"].includes(condition.receiptSign)))) {
        throw new Error("Each macro step must use a valid sale/return and receipt-total condition.");
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
        stepConditions: draft.mode === "macro" ? draft.steps.map((_, index) => draft.stepConditions?.[index] ?? null) : undefined,
        label: isCustom ? undefined : label,
        launch: draft.launch,
        launchApproval: intent === "approve-target" && draft.launch ? { ...draft.launch }
          : intent === "revoke-target" ? undefined
          : isExternalTargetApproved(draft) ? { ...draft.launch! } : undefined,
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
    onSuccess: async (_data, intent) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setDirty(false);
      toast({
        title: intent === "approve-target" ? "External target approved" :
          intent === "revoke-target" ? "External target approval removed" :
          intent === "approve" ? "Function setup approved" : "Function draft saved",
        description: intent === "approve-target"
          ? "The function remains a draft. Review it, then use Save & approve to make the external button available on its assigned layout."
          : "An external button runs only when both its function setup and exact destination are approved.",
      });
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
  const approvedCount = actions.filter(action => {
    const definition = readDefinition(savedSettings, action.code, "");
    return definition.approved && (!definition.launch || isExternalTargetApproved(definition));
  }).length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="POS Functions" description="Edit, rename, clone and approve function behavior setups." />
        <Button asChild variant="outline" size="sm"><Link href="/pos/layouts"><ArrowLeft className="mr-2 h-4 w-4" />POS layouts</Link></Button>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>External buttons need two approvals.</strong> An approved function with an independently approved target can launch on its assigned Terminal layout.
        Other written behavior does not automatically become a live payment, voucher or macro handler. Test on a layout before rollout.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,430px)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">All functions</CardTitle>
              <Badge variant="secondary">{actions.length} listed</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{ALL_ACTIONS.length} standard · {approvedCount} approved (including external targets) · {definedCount} saved definitions · {custom.length} custom functions</p>
            <p className="text-xs text-muted-foreground">Green identifies a standard catalog function or an approved setup. It does not certify that every behavior runs live. External targets need separate approval.</p>
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
                           <PosFunctionStatus definition={definition}
                             standard={ALL_ACTIONS.some(item => item.code === action.code)}
                             saved={savedSettings.some(setting => setting.key === definitionKey(action.code) && setting.value)}
                             compact />
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
                  <PosFunctionStatus definition={stored} standard={!isCustom}
                    saved={savedSettings.some(setting => setting.key === definitionKey(selected.code) && setting.value)} />
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
              <div className="space-y-3 rounded-md border p-4">
                <h2 className="text-sm font-semibold">External destination</h2>
                <p className="text-xs text-muted-foreground">
                   An assigned button can launch only after both its function setup and its exact destination are approved.
                  Server-hosted programs need a web address; POS buttons never execute arbitrary commands.
                </p>
                <select aria-label="External destination type" className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={draft.launch?.type ?? (["OPEN_BROWSER", "RUN_EXTERNAL_PROGRAM"].includes(selected.code) ? "web" : "none")}
                  onChange={event => update({ launch: event.target.value === "none" ? undefined :
                    { type: event.target.value as ExternalLaunch["type"], target: draft.launch?.target ?? "" } })}>
                  {!["OPEN_BROWSER", "RUN_EXTERNAL_PROGRAM"].includes(selected.code) && <option value="none">No external destination</option>}
                  <option value="web">Website in journal</option>
                  <option value="server">Server-hosted web program in journal</option>
                  {selected.code !== "OPEN_BROWSER" && <option value="app">Installed app (registered URI link)</option>}
                </select>
                {(draft.launch || ["OPEN_BROWSER", "RUN_EXTERNAL_PROGRAM"].includes(selected.code)) && (
                  <div>
                    <label htmlFor="external-target" className="text-sm font-medium">
                      {draft.launch?.type === "app" ? "Registered app link" : "Website URL"}
                    </label>
                    <Input id="external-target" maxLength={2048} value={draft.launch?.target ?? ""}
                      onChange={event => update({ launch: {
                        type: draft.launch?.type ?? "web", target: event.target.value,
                      } })} placeholder={draft.launch?.type === "app" ? "myapp://open" : "https://example.com/app"} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {draft.launch?.type === "app"
                        ? "The application and its URI handler must already be installed on the POS device. It opens outside the journal."
                        : "The site must allow embedding in a frame. If it blocks embedding, staff can open it in a separate tab."}
                    </p>
                  </div>
                )}
                 {draft.launch && (
                   <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                     <span className={`text-xs ${isExternalTargetApproved(draft) ? "text-green-700" : "text-amber-700"}`}>
                       {isExternalTargetApproved(draft) ? "This exact external target is approved." : "Target not approved. This button cannot launch it."}
                     </span>
                     {isExternalTargetApproved(draft) ? (
                       <Button variant="outline" size="sm" disabled={save.isPending || !settings.isSuccess}
                         onClick={() => save.mutate("revoke-target")}>Remove target approval</Button>
                     ) : (
                       <Button variant="outline" size="sm" disabled={save.isPending || !settings.isSuccess || !validExternalLaunch(draft.launch) || draft.mode !== "single"}
                         onClick={() => save.mutate("approve-target")}>Approve target &amp; save draft</Button>
                     )}
                   </div>
                 )}
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
                    <p className="text-xs text-muted-foreground">Each step presses a function button in order when its conditions match. The simulator traces the keypresses; they do not run at live checkout.</p>
                    <ol className="space-y-2">
                      {draft.steps.map((code, index) => (
                        <li key={`${index}-${code}`} className="rounded-md border px-2 py-2 text-sm">
                          <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{index + 1}. {actions.find(action => action.code === code)?.label || `Missing function: ${code}`}</span>
                          <Button aria-label={`Move step ${index + 1} up`} size="icon" variant="ghost" disabled={!index} onClick={() => {
                            const next = [...draft.steps]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            const conditions = draft.steps.map((_, i) => draft.stepConditions?.[i] ?? null);
                            [conditions[index - 1], conditions[index]] = [conditions[index], conditions[index - 1]];
                            update({ steps: next, stepConditions: conditions });
                          }}><ArrowUp className="h-4 w-4" /></Button>
                          <Button aria-label={`Move step ${index + 1} down`} size="icon" variant="ghost" disabled={index === draft.steps.length - 1} onClick={() => {
                            const next = [...draft.steps]; [next[index + 1], next[index]] = [next[index], next[index + 1]];
                            const conditions = draft.steps.map((_, i) => draft.stepConditions?.[i] ?? null);
                            [conditions[index + 1], conditions[index]] = [conditions[index], conditions[index + 1]];
                            update({ steps: next, stepConditions: conditions });
                          }}><ArrowDown className="h-4 w-4" /></Button>
                          <Button aria-label={`Remove step ${index + 1}`} size="icon" variant="ghost" onClick={() => update({
                            steps: draft.steps.filter((_, i) => i !== index),
                            stepConditions: draft.steps.flatMap((_, i) => i === index ? [] : [draft.stepConditions?.[i] ?? null]),
                          })}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <select aria-label={`Step ${index + 1} transaction condition`} className="h-8 rounded border bg-background px-2 text-xs"
                              value={draft.stepConditions?.[index]?.transactionType ?? "any"}
                              onChange={event => updateStepCondition(index, { transactionType: event.target.value as MacroCondition["transactionType"] })}>
                              <option value="any">Any sale or return</option><option value="sale">Sale only</option><option value="return">Return only</option>
                            </select>
                            <select aria-label={`Step ${index + 1} receipt condition`} className="h-8 rounded border bg-background px-2 text-xs"
                              value={draft.stepConditions?.[index]?.receiptSign ?? "any"}
                              onChange={event => updateStepCondition(index, { receiptSign: event.target.value as MacroCondition["receiptSign"] })}>
                              <option value="any">Any total</option><option value="positive">Positive total</option>
                              <option value="negative">Negative total</option><option value="zero">Zero total</option>
                            </select>
                          </div>
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
                      <Button variant="outline" disabled={!stepCode || draft.steps.length >= MAX_STEPS} onClick={() => {
                        update({ steps: [...draft.steps, stepCode], stepConditions: [...draft.steps.map((_, i) => draft.stepConditions?.[i] ?? null), null] });
                        setStepCode("");
                      }}>
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
                 {stored.approved && !dirty && <Button variant="outline" onClick={() => save.mutate("draft")} disabled={save.isPending || !settings.isSuccess}>
                  Remove approval
                </Button>}
                 <Button variant="outline" onClick={() => save.mutate("draft")} disabled={!dirty || !draft.behavior.trim() || !draft.label.trim() || save.isPending || !settings.isSuccess}
                  data-testid="button-save-pos-function">
                  Save draft
                </Button>
                 <Button onClick={() => save.mutate("approve")} disabled={(!dirty && !!stored.approved) || !draft.behavior.trim() || !draft.label.trim() || save.isPending || !settings.isSuccess}
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