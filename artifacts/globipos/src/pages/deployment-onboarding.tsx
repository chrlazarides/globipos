import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2 } from "lucide-react";

type Event = {
  id: string; kind: "setup" | "release"; step: string | null;
  outcome: "completed" | "published" | "failed"; backOfficeVersion: string | null;
  posVersion: string | null; codeRevision: string | null; notes: string | null;
  recordedBy: string; createdAt: string;
};

const steps = [
  { key: "project", label: "Separate installation", detail: "Create an independent installation from the approved shared code. Record its hosting service ID and published URL in the deployment inventory." },
  { key: "database", label: "Separate database", detail: "Verify this installation has its own production database and no other customer's business data." },
  { key: "published", label: "Publish and verify", detail: "Publish the customer's own installation using its hosting provider; verify the health check and sign-in. This checklist does not publish for you." },
  { key: "domain", label: "Verify hostname and HTTPS", detail: "Configure the installation's hostname and certificate with its hosting provider, then run Check domains in Deployment Control. GoDaddy DNS setup below applies only to globipos.shop hostnames." },
  { key: "company", label: "Company settings", detail: "Set company name, legal and tax details, logo, receipt and invoice settings, and customer-only credentials in the new project." },
  { key: "locations", label: "Locations and stock", detail: "In the customer's Back Office, create every POS location. Import and reconcile that customer's products, prices and stock by location." },
  { key: "terminals", label: "Terminals and cashiers", detail: "Create a unique terminal code for each device, assign it to a location, install or open Terminal, enter this customer's server URL and code, and complete first sync." },
  { key: "verification", label: "Go-live checks", detail: "Test cashier sign-in, a sale, receipt, refund, terminal sync, backups and any enabled portal/rewards features. Only then activate the deployment profile." },
] as const;

type Deployment = {
  id: string; clientName: string; customerDomain: string | null; posDomain?: string | null; eShopDomain: string | null;
  domainStatus: string; backOfficeVersion: string | null; posVersion: string | null;
  targetBackOfficeVersion: string | null; targetPosVersion: string | null;
  lastHeartbeatAt: string | null; externalProjectId: string | null;
};

type DnsPlan = { records: Array<{ type: "A" | "TXT"; name: string; data: string; action: "create" | "already_present" }> };

function DnsSetup({ deployment }: { deployment: Deployment }) {
  const { toast } = useToast();
  const [role, setRole] = useState<"customer" | "pos" | "eshop">("customer");
  const [address, setAddress] = useState("");
  const [txtName, setTxtName] = useState("");
  const [txtValue, setTxtValue] = useState("");
  const [preview, setPreview] = useState<{ plan: DnsPlan; input: { role: typeof role; address: string; txtName: string; txtValue: string } } | null>(null);
  const revision = useRef(0);
  const hostname = role === "customer" ? deployment.customerDomain : role === "pos" ? deployment.posDomain : deployment.eShopDomain;
  const reset = () => { revision.current++; setPreview(null); };
  const payload = { role, address: address.trim(), txtName: txtName.trim(), txtValue };
  const check = useMutation({
    mutationFn: async ({ input, version }: { input: typeof payload; version: number }) => ({
      plan: await (await apiRequest("POST", `/api/control/deployments/${deployment.id}/dns/preview`, input)).json() as DnsPlan,
      input, version,
    }),
    onSuccess: result => { if (result.version === revision.current) setPreview({ plan: result.plan, input: result.input }); },
    onError: (error: Error) => toast({ title: "DNS preview failed", description: error.message, variant: "destructive" }),
  });
  const apply = useMutation({
    mutationFn: async (input: typeof payload) => (await apiRequest("POST", `/api/control/deployments/${deployment.id}/dns/apply`, input)).json() as Promise<DnsPlan>,
    onSuccess: result => {
      setPreview(null);
      toast({ title: "DNS setup finished", description: result.records.some(r => r.action === "create") ? "Allow time for DNS and HTTPS, then run Check domains." : "These records already existed. Run Check domains." });
    },
    onError: (error: Error) => { setPreview(null); toast({ title: "DNS setup not confirmed", description: error.message, variant: "destructive" }); },
  });
  return <section className="space-y-3 rounded-md border p-3 text-sm">
    <h4 className="font-semibold">Create this customer's GoDaddy DNS records</h4>
    <p className="text-muted-foreground">First add the exact hostname in the customer's Replit project under Publishing → Domains. Copy the A address, TXT record name and TXT value Replit shows. This does not add the hostname to Replit for you, and it will never replace existing GoDaddy records.</p>
    <label className="block">Hostname
      <select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={role} onChange={e => { setRole(e.target.value as typeof role); setAddress(""); setTxtName(""); setTxtValue(""); reset(); }}>
        <option value="customer">{deployment.customerDomain || "Customer hostname not set"}</option>
        {deployment.posDomain && <option value="pos">{deployment.posDomain} (POS)</option>}
        {deployment.eShopDomain && <option value="eshop">{deployment.eShopDomain} (e-shop)</option>}
      </select>
    </label>
    <p className="font-mono text-xs">{hostname || "Set a customer hostname in the deployment profile first."}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label>Replit A address<Input value={address} onChange={e => { setAddress(e.target.value); reset(); }} placeholder="Public IPv4 address from Replit" /></label>
      <label>Replit TXT name<Input value={txtName} onChange={e => { setTxtName(e.target.value); reset(); }} placeholder={`Full name, e.g. ${hostname || "customer.globipos.shop"}`} /></label>
    </div>
    <label className="block">Replit TXT value<Input value={txtValue} onChange={e => { setTxtValue(e.target.value); reset(); }} placeholder="Exact verification text from Replit" /></label>
    <Button variant="outline" disabled={!hostname || !address || !txtName || !txtValue || check.isPending || apply.isPending} onClick={() => { reset(); check.mutate({ input: payload, version: revision.current }); }}>Preview DNS changes</Button>
    {preview && <div className="space-y-2 rounded-md border bg-slate-50 p-3">
      <p className="font-medium">Review before creating records</p>
      {preview.plan.records.map(record => <p key={record.type} className="break-all font-mono text-xs">{record.action === "create" ? "Create" : "Already present"} · {record.type} · {record.name}.globipos.shop → {record.data}</p>)}
      <p className="text-xs text-muted-foreground">Existing records are never replaced. GoDaddy may take time to propagate; Replit must still verify the hostname and issue HTTPS.</p>
      <Button disabled={apply.isPending || !preview.plan.records.some(r => r.action === "create")} onClick={() => {
        if (window.confirm(`Create the missing DNS records for ${hostname} in GoDaddy? This changes live DNS.`)) apply.mutate(preview.input);
      }}>{apply.isPending ? "Creating…" : "Create missing records in GoDaddy"}</Button>
    </div>}
  </section>;
}

export function DeploymentOnboarding({ deployment, onClose }: { deployment: Deployment | null; onClose: () => void }) {
  const { toast } = useToast();
  const [revision, setRevision] = useState("");
  const [backOfficeVersion, setBackOfficeVersion] = useState("");
  const [posVersion, setPosVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"published" | "failed">("published");
  const key = ["/api/control/deployments", deployment?.id, "events"];
  const events = useQuery<Event[]>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/control/deployments/${deployment!.id}/events`)).json(),
    enabled: !!deployment,
  });
  const save = useMutation({
    mutationFn: async (body: object) => (await apiRequest("POST", `/api/control/deployments/${deployment!.id}/events`, body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/control/deployments"] });
      toast({ title: "Operator record saved" });
      setNotes("");
    },
    onError: (error: Error) => toast({ title: "Could not save record", description: error.message, variant: "destructive" }),
  });
  const completed = new Set((events.data ?? []).filter(e => e.kind === "setup").map(e => e.step));
  const recordRelease = () => {
    if (!revision.trim() || !backOfficeVersion.trim() || !posVersion.trim()) {
      toast({ title: "Revision and both versions are required", variant: "destructive" });
      return;
    }
    save.mutate({ kind: "release", outcome, codeRevision: revision.trim(), backOfficeVersion: backOfficeVersion.trim(), posVersion: posVersion.trim(), notes: notes.trim() });
  };

  return <Dialog open={!!deployment} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>Setup and releases — {deployment?.clientName}</DialogTitle>
        <DialogDescription>Operator-recorded checklist and release history. Nothing here creates a project, changes a database, or publishes to Replit.</DialogDescription>
      </DialogHeader>
      {deployment && <>
        <div className="rounded-lg border bg-slate-50 p-3 text-sm">
          <p><strong>Customer hostname:</strong> <span className="font-mono">{deployment.customerDomain || "Not set"}</span></p>
          {deployment.eShopDomain && <p><strong>Optional e-shop:</strong> <span className="font-mono">{deployment.eShopDomain}</span></p>}
          <p><strong>Hosting project or service ID:</strong> {deployment.externalProjectId || "Not recorded — add it under Edit URL"}</p>
          <p><strong>Last recorded versions:</strong> Back Office {deployment.backOfficeVersion || "unknown"} · POS {deployment.posVersion || "unknown"}{deployment.lastHeartbeatAt ? ` · last heartbeat ${new Date(deployment.lastHeartbeatAt).toLocaleString()}` : " · no heartbeat"}</p>
          <p><strong>Requested versions:</strong> Back Office {deployment.targetBackOfficeVersion || "none"} · POS {deployment.targetPosVersion || "none"}</p>
        </div>
        <section className="space-y-2"><h3 className="font-semibold">New customer setup</h3>
          {events.isLoading && <p className="text-sm text-muted-foreground">Loading setup history…</p>}
          {events.isError && <p role="alert" className="text-sm text-red-700">Could not load setup history: {(events.error as Error).message}</p>}
          {steps.map(step => <div key={step.key} className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">{completed.has(step.key) && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}{step.label}</span>
              <Button size="sm" variant="outline" disabled={save.isPending || events.isLoading || events.isError || completed.has(step.key)} onClick={() => save.mutate({ kind: "setup", step: step.key })}>Record done</Button>
            </div>
            <p className="mt-1 text-muted-foreground">{step.detail}</p>
          </div>)}
        </section>
        {deployment.customerDomain?.endsWith(".globipos.shop") && <DnsSetup key={deployment.id} deployment={deployment} />}
        <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">Record a manual release</h3>
          <p className="text-sm text-muted-foreground">After publishing and testing a customer installation, record the actual result here. A successful record updates the inventory's versions and clears matching target versions; a failed record leaves them unchanged. This is an operator attestation, not proof of an automatic publish. A queued fleet rollout is only a request.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-sm">Code revision<Input value={revision} onChange={e => setRevision(e.target.value)} placeholder="Git commit SHA" /></label>
            <label className="text-sm">Back Office version<Input value={backOfficeVersion} onChange={e => setBackOfficeVersion(e.target.value)} placeholder="e.g. 1.4.0" /></label>
            <label className="text-sm">POS version<Input value={posVersion} onChange={e => setPosVersion(e.target.value)} placeholder="e.g. 1.4.0" /></label>
          </div>
          <label className="block text-sm">Outcome<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={outcome} onChange={e => setOutcome(e.target.value as "published" | "failed")}><option value="published">Published and verified manually</option><option value="failed">Failed</option></select></label>
          <label className="block text-sm">Notes (optional)<Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What was verified, or why did publishing fail?" maxLength={2000} /></label>
          <Button disabled={save.isPending} onClick={recordRelease}>Save release record</Button>
        </section>
        <section className="space-y-2 border-t pt-4"><h3 className="font-semibold">Customer history</h3>
          {!events.isLoading && !events.isError && !events.data?.length && <p className="text-sm text-muted-foreground">No setup or release records yet.</p>}
          {(events.data || []).map(event => <div key={event.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{event.kind === "setup" ? steps.find(s => s.key === event.step)?.label || event.step : `Release ${event.outcome}`}</span><Badge variant={event.outcome === "failed" ? "destructive" : "secondary"}>{event.outcome}</Badge></div>
            {event.kind === "release" && <p className="font-mono text-xs">Revision {event.codeRevision} · Back Office {event.backOfficeVersion} · POS {event.posVersion}</p>}
            {event.notes && <p className="whitespace-pre-wrap">{event.notes}</p>}
            <p className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()} · operator {event.recordedBy}</p>
          </div>)}
        </section>
      </>}
    </DialogContent>
  </Dialog>;
}