import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Check, Loader2, Search, Zap } from "lucide-react";
import { ACTION_GROUPS, ALL_ACTIONS } from "./pos-layout-editor";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Setting = { key: string; value: string };
const settingKey = (code: string) => `pos_function_definition_${code.toLowerCase()}`;
const quickSaleActions = new Set(["PAY_CASH", "PAY_CARD", "VOID_SALE"]);

export default function PosFunctions() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState(ALL_ACTIONS[0].code);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const settings = useQuery<Setting[]>({ queryKey: ["/api/settings"] });
  const savedDefinitions = useMemo(
    () => new Map((settings.data ?? []).filter(s => s.key.startsWith("pos_function_definition_")).map(s => [s.key, s.value])),
    [settings.data],
  );
  const selected = ALL_ACTIONS.find(action => action.code === selectedCode)!;
  const saved = savedDefinitions.get(settingKey(selected.code)) || selected.description || "";

  useEffect(() => {
    if (!dirty) setDraft(saved);
  }, [saved, dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const value = draft.trim() === selected.description ? "" : draft.trim();
      await apiRequest("PUT", "/api/settings", {
        settings: [{ key: settingKey(selected.code), value, label: selected.label, group: "POS Functions" }],
      });
    },
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Function definition saved", description: "The behavior specification is saved for admins. It does not change checkout logic yet." });
    },
    onError: (error: Error) => toast({ title: "Could not save definition", description: error.message, variant: "destructive" }),
  });

  function selectFunction(code: string) {
    if (code === selectedCode) return;
    if (save.isPending) return;
    if (dirty && !window.confirm("Discard your unsaved definition?")) return;
    const action = ALL_ACTIONS.find(item => item.code === code)!;
    setSelectedCode(code);
    setDraft(savedDefinitions.get(settingKey(code)) || action.description || "");
    setDirty(false);
  }

  const filteredGroups = ACTION_GROUPS.map(group => ({
    ...group,
    actions: group.actions.filter(action =>
      `${action.label} ${action.code} ${action.description} ${group.group}`.toLowerCase().includes(search.toLowerCase().trim()),
    ),
  })).filter(group => group.actions.length);
  const definitionCount = ALL_ACTIONS.filter(action => !!savedDefinitions.get(settingKey(action.code))).length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="POS Functions" description="Review every function available in the POS layout editor and define what each button should do." />
        <Button asChild variant="outline" size="sm"><Link href="/pos/layouts"><ArrowLeft className="mr-2 h-4 w-4" />POS layouts</Link></Button>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Definitions are specifications, not live settings.</strong> Saving a description here does not activate a function on a terminal.
        The current Back Office Quick Sale handles cash, card and void sale; other layout actions need checkout implementation before staff can use them.
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(290px,390px)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">All functions</CardTitle>
              <Badge variant="secondary">{ALL_ACTIONS.length} listed</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{definitionCount} with custom definitions · {ACTION_GROUPS.length} groups</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search POS functions" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search functions…" className="pl-9" />
            </div>
          </CardHeader>
          <CardContent className="max-h-[65vh] space-y-5 overflow-y-auto pt-0">
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
                      return (
                        <button key={action.code} type="button" onClick={() => selectFunction(action.code)}
                          disabled={save.isPending}
                          aria-current={selectedCode === action.code ? "true" : undefined}
                          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${selectedCode === action.code ? "border-primary bg-primary/5" : "border-transparent"}`}
                          data-testid={`pos-function-${action.code}`}>
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{action.label}</span>
                          {savedDefinitions.get(settingKey(action.code)) && <Check className="h-3.5 w-3.5 shrink-0 text-green-600" aria-label="Custom definition saved" />}
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

        <Card className="min-w-0 self-start">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <selected.icon className="h-6 w-6 text-primary" />
                <div>
                  <CardTitle>{selected.label}</CardTitle>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{selected.code}</p>
                </div>
              </div>
              <Badge variant={quickSaleActions.has(selected.code) ? "secondary" : "outline"}>
                {quickSaleActions.has(selected.code) ? "Quick Sale action exists" : "Not wired in Quick Sale"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-md bg-muted/60 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested purpose</h2>
              <p className="mt-1 text-sm">{selected.description}</p>
            </div>
            <div>
              <label htmlFor="function-behavior" className="text-sm font-semibold">Define the behavior</label>
              <p className="mt-1 text-sm text-muted-foreground">
                Specify what happens when pressed, required input, permissions, offline rules and the expected result.
              </p>
              <Textarea id="function-behavior" value={draft} maxLength={2000}
                onChange={event => { setDraft(event.target.value); setDirty(true); }}
                rows={9} className="mt-3 resize-y" placeholder="Describe the exact behavior for this function…" data-testid="input-pos-function-behavior" />
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{savedDefinitions.get(settingKey(selected.code)) ? "Custom definition saved" : "Using suggested purpose"}</span>
                <span>{draft.length}/2000</span>
              </div>
            </div>
            {selected.code === "PAY_VOUCHER" && (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">
                For vouchers, describe whether this redeems a gift balance or applies a coupon, how codes are validated,
                partial use and expiry rules, and what happens on refund.
              </p>
            )}
            {settings.isError && <p role="alert" className="text-sm text-destructive">Could not load saved definitions. Try refreshing before editing.</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { setDraft(selected.description || ""); setDirty(true); }} disabled={save.isPending}>Use suggested purpose</Button>
              <Button onClick={() => save.mutate()} disabled={!dirty || !draft.trim() || save.isPending || settings.isLoading || settings.isError} data-testid="button-save-pos-function">
                {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                Save definition
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}