import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildInfo } from "@/lib/build-info";

type Release = {
  id: string;
  outcome: "published" | "failed";
  backOfficeVersion: string;
  posVersion: string;
  codeRevision: string;
  notes: string | null;
  createdAt: string;
};
type Releases = { current: Release | null; history: Release[]; source: "operator_recorded" };
const key = ["/api/control/shared-releases"];

export function SharedRelease() {
  const { toast } = useToast();
  const releases = useQuery<Releases>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", key[0])).json(),
    refetchInterval: 60_000,
  });
  const [form, setForm] = useState({
    outcome: "published" as "published" | "failed",
    codeRevision: "", backOfficeVersion: "", posVersion: "", notes: "",
  });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", key[0], form)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      setForm({ outcome: "published", codeRevision: "", backOfficeVersion: "", posVersion: "", notes: "" });
      toast({ title: "Shared release record saved", description: "No publish was triggered." });
    },
    onError: (error: Error) => toast({ title: "Could not record release", description: error.message, variant: "destructive" }),
  });
  const current = releases.data?.current;
  return <Card>
    <CardHeader className="border-b bg-white px-5 py-4"><CardTitle className="text-base">Shared published release</CardTitle></CardHeader>
    <CardContent className="space-y-5 p-5">
      <p className="text-sm text-slate-600">One code release serves all customers. Recording a release here does not publish or verify running server code.</p>
      <div className="rounded-lg border bg-slate-50 p-4 text-sm">
        <p className="font-semibold">{buildInfo.isDevelopment ? "This preview's frontend build" : "Loaded published frontend build"}</p>
        <p className="mt-1 font-mono">{buildInfo.version} · {buildInfo.reference}</p>
        <p className="mt-1 text-xs text-slate-500">{buildInfo.isDevelopment ? "Development preview, not a production deployment." : "Build embedded in the page currently open in this browser; it does not confirm the API or POS build."}</p>
      </div>
      {releases.isLoading ? <p className="text-sm text-slate-500">Loading release history…</p> : releases.isError ? <p role="alert" className="text-sm text-red-700">Could not load release history: {(releases.error as Error).message}</p> : current ? <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">Last verified published version</p>
        <p className="mt-2 text-sm">Back Office <strong>{current.backOfficeVersion}</strong> · POS <strong>{current.posVersion}</strong></p>
        <p className="mt-1 break-all font-mono text-xs text-slate-600">Code revision {current.codeRevision}</p>
        <p className="mt-1 text-xs text-slate-500">Recorded {new Date(current.createdAt).toLocaleString()}</p>
      </div> : <p className="rounded-lg border p-4 text-sm text-slate-600">No shared release has been verified yet. The deployed code version is unknown.</p>}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Record a shared release result</summary>
        <p className="mt-2 text-xs text-slate-600">Only record a successful result after independently checking the published app. A failed result does not replace the last verified version.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Code revision<Input value={form.codeRevision} onChange={e => setForm(f => ({ ...f, codeRevision: e.target.value }))} placeholder="Git commit SHA" /></label>
          <label className="text-sm">Back Office version<Input value={form.backOfficeVersion} onChange={e => setForm(f => ({ ...f, backOfficeVersion: e.target.value }))} /></label>
          <label className="text-sm">POS version<Input value={form.posVersion} onChange={e => setForm(f => ({ ...f, posVersion: e.target.value }))} /></label>
          <label className="text-sm">Outcome<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value as typeof f.outcome }))}><option value="published">Published and verified manually</option><option value="failed">Failed</option></select></label>
          <label className="text-sm sm:col-span-2">Changes or failure notes<Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} maxLength={2000} /></label>
        </div>
        <Button className="mt-3" disabled={save.isPending || form.codeRevision.trim().length < 7 || !form.backOfficeVersion.trim() || !form.posVersion.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save manual record"}</Button>
      </details>
      <div>
        <h3 className="text-sm font-semibold">Change history</h3>
        {!releases.isLoading && !releases.isError && !releases.data?.history.length && <p className="mt-2 text-sm text-slate-500">No release changes recorded.</p>}
        <div className="mt-2 max-h-64 divide-y overflow-y-auto">{releases.data?.history.map(event => <div key={event.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={event.outcome === "failed" ? "destructive" : "secondary"}>{event.outcome}</Badge><span className="font-mono">{event.codeRevision}</span><span className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</span></div>
          <p className="mt-1 text-xs text-slate-600">Back Office {event.backOfficeVersion} · POS {event.posVersion}</p>
          {event.notes && <p className="mt-1 whitespace-pre-wrap text-slate-700">{event.notes}</p>}
        </div>)}</div>
      </div>
    </CardContent>
  </Card>;
}