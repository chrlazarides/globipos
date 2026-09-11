import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  GitBranch,
  Loader2,
  Mail,
  MessageCircle,
  Plug,
  Server,
} from "lucide-react";
import { useAuth } from "@/App";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { SystemSetting } from "@shared/schema";
import { erpProviderBinding } from "@shared/erp-provider-binding";

type EmailStatus = {
  connected: boolean;
  configuredFrom?: string;
  actualFrom?: string;
  source?: string;
  error?: string;
};

type WhatsAppStatus = {
  configured: boolean;
  phoneNumberId: string | null;
  verifyToken: "set" | "default";
  webhookUrl: string;
};

type CardTerminalStatus = {
  activeProvider: string | null;
  jccConfigured: boolean;
  vivaConfigured: boolean;
  worldpayConfigured: boolean;
};

type IntegrationCardProps = {
  title: string;
  description: string;
  icon: typeof Mail;
  connected: boolean;
  loading?: boolean;
  statusText: string;
  detail: string;
  href: string;
  action: string;
};

type ErpOption = {
  id: "softone" | "sap-b1" | "custom-api";
  name: string;
  description: string;
  interfaceName: string;
  requirements: string[];
};

type ErpConfig = { provider: "softone" | "sap-b1"; enabled: boolean; policies: Record<string, { enabled: boolean; sourceOfTruth: "globipos" | "erp" }>; lastTestStatus?: string; lastSyncStatus?: string; lastSyncAt?: string };
type ErpAudit = { id: string; recordType: string; recordId: string; status: string; direction: string; errorMessage?: string; createdAt: string };
const erpRecordTypes = ["customers", "items", "stock", "invoices", "payments"] as const;

type ErpBusinessRules = {
  itemOwner: "globipos" | "erp";
  itemSync: "manual" | "15_minutes" | "hourly" | "daily";
  stockOwner: "globipos" | "erp";
  pricingOwner: "globipos" | "erp";
  offerOwner: "globipos" | "erp";
  customerOwner: "globipos" | "erp";
};

const defaultErpRules: ErpBusinessRules = {
  itemOwner: "erp",
  itemSync: "manual",
  stockOwner: "globipos",
  pricingOwner: "erp",
  offerOwner: "globipos",
  customerOwner: "globipos",
};

const erpOptions: ErpOption[] = [
  {
    id: "softone",
    name: "SoftOne",
    description: "Synchronize customers, items, stock, invoices, and payments with SoftOne ERP.",
    interfaceName: "SoftOne Web Services / REST API",
    requirements: ["SoftOne service endpoint", "Company or installation identifier", "API-enabled integration account", "ERP_SOFTONE_WAREHOUSE warehouse code for stock synchronization", "Data synchronization scope"],
  },
  {
    id: "sap-b1",
    name: "SAP Business One",
    description: "Exchange master data and transactions with SAP Business One.",
    interfaceName: "SAP Business One Service Layer",
    requirements: ["Service Layer endpoint", "Company database identifier", "API-enabled integration account", "ERP_SAP_B1_WAREHOUSE warehouse code for stock synchronization", "U_GlobiPOSKey UDF exposed on every synchronized Service Layer entity", "Data synchronization scope"],
  },
  {
    id: "custom-api",
    name: "Other ERP / Custom API",
    description: "Connect another ERP using its supported API, middleware, or webhook interface.",
    interfaceName: "REST API, SOAP service, or webhooks",
    requirements: ["ERP API or middleware endpoint", "Authentication method and deployment secret", "Data field mapping", "Synchronization direction and schedule"],
  },
];

function IntegrationCard({
  title,
  description,
  icon: Icon,
  connected,
  loading,
  statusText,
  detail,
  href,
  action,
}: IntegrationCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          {loading ? (
            <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Checking</Badge>
          ) : connected ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />{statusText}</Badge>
          ) : (
            <Badge variant="secondary"><CircleAlert className="mr-1 h-3 w-3" />{statusText}</Badge>
          )}
        </div>
        <div>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="mt-1.5 leading-5">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-4">
        <p className="min-h-10 text-sm text-muted-foreground">{detail}</p>
        <Button asChild variant="outline" className="w-full justify-between">
          <Link href={href}>
            {action}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedErp, setSelectedErp] = useState<ErpOption | null>(null);
  const [erpSaving, setErpSaving] = useState(false);
  const [erpRules, setErpRules] = useState<ErpBusinessRules>(defaultErpRules);
  const isSuperuser = user?.role === "superuser";
  const email = useQuery<EmailStatus>({ queryKey: ["/api/email-status"] });
  const whatsapp = useQuery<WhatsAppStatus>({ queryKey: ["/api/admin/whatsapp/status"] });
  const card = useQuery<CardTerminalStatus>({ queryKey: ["/api/pos/card-terminal/status"] });
  const settings = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const control = useQuery<{ enabled: boolean; automationDispatch?: string }>({
    queryKey: ["/api/control/status"],
    enabled: isSuperuser,
    retry: false,
  });
  const erpConfigs = useQuery<ErpConfig | null>({ queryKey: ["/api/admin/erp-integrations"], enabled: user?.role === "admin" || isSuperuser, retry: false });
  const erpAudit = useQuery<ErpAudit[]>({
    queryKey: ["/api/admin/erp-integrations/audit"],
    enabled: user?.role === "admin" || isSuperuser,
    retry: false,
  });

  const githubRepo = settings.data?.find(setting => setting.key === "pos_github_repo")?.value;
  const cardProvider = card.data?.activeProvider;
  const providerConfigured = cardProvider === "jcc"
    ? card.data?.jccConfigured
    : cardProvider === "viva"
      ? card.data?.vivaConfigured
      : cardProvider === "worldpay"
        ? card.data?.worldpayConfigured
        : false;
  const selectedConfig = erpConfigs.data;
  const providerBinding = erpProviderBinding(selectedConfig, selectedErp?.id);
  const matchingConfig = providerBinding.matchingConfig;
  const openErp = (option: ErpOption) => {
    if (option.id === "custom-api") {
      const saved = settings.data?.find(setting => setting.key === `erp_business_rules_${option.id}`)?.value;
      try {
        setErpRules(saved ? { ...defaultErpRules, ...JSON.parse(saved) } : defaultErpRules);
      } catch {
        setErpRules(defaultErpRules);
      }
    }
    setSelectedErp(option);
  };
  const saveCustomRules = useMutation({
    mutationFn: async () => {
      if (!selectedErp || selectedErp.id !== "custom-api") return;
      await apiRequest("PUT", "/api/settings", {
        settings: [{
          key: `erp_business_rules_${selectedErp.id}`,
          value: JSON.stringify(erpRules),
          label: `${selectedErp.name} Business Rules`,
          group: "integrations",
        }],
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "ERP business rules saved" });
      setSelectedErp(null);
    },
    onError: (error: Error) => toast({ title: "Could not save ERP rules", description: error.message, variant: "destructive" }),
  });
  const setRule = <K extends keyof ErpBusinessRules>(key: K, value: ErpBusinessRules[K]) => {
    setErpRules(current => ({ ...current, [key]: value }));
  };
  const saveErp = async (body: Record<string, unknown>, endpoint = "") => {
    setErpSaving(true);
    try {
      const response = await fetch(`/api/admin/erp-integrations${endpoint}`, {
        method: endpoint ? "POST" : "PUT",
        headers: endpoint ? undefined : { "Content-Type": "application/json" },
        body: endpoint ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "ERP operation failed");
      toast({ title: endpoint === "/test" ? "Connection test succeeded" : endpoint === "/sync" ? "Sync completed" : "ERP settings saved", description: endpoint === "/sync" ? `${result.succeeded} synced, ${result.failed} failed, ${result.skipped} skipped.` : undefined });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/erp-integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/erp-integrations/audit"] });
    } catch (error: any) {
      toast({ title: "ERP operation failed", description: error.message, variant: "destructive" });
    } finally { setErpSaving(false); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Integrations"
        subtitle="Monitor and configure the external services connected to GlobiPOS."
        icon={<Plug className="h-5 w-5" />}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <IntegrationCard
          title="Email delivery"
          description="Transactional email through the configured delivery provider."
          icon={Mail}
          connected={email.data?.connected === true}
          loading={email.isLoading}
          statusText={email.data?.connected ? "Connected" : "Needs setup"}
          detail={email.data?.connected
            ? `Sending from ${email.data.actualFrom || email.data.configuredFrom || "the configured address"}.`
            : email.data?.error || "Configure a sender and provider credentials before sending email."}
          href="/settings"
          action="Open email settings"
        />

        <IntegrationCard
          title="WhatsApp"
          description="Customer messages, orders, and webhook delivery through WhatsApp."
          icon={MessageCircle}
          connected={whatsapp.data?.configured === true}
          loading={whatsapp.isLoading}
          statusText={whatsapp.data?.configured ? "Connected" : "Needs setup"}
          detail={whatsapp.data?.configured
            ? `Phone number ID configured; webhook verification is ${whatsapp.data.verifyToken}.`
            : "Connect the WhatsApp token and phone number before receiving customer messages."}
          href="/whatsapp-orders"
          action="Open WhatsApp"
        />

        <IntegrationCard
          title="Card payments"
          description="JCC, Viva, or Worldpay terminal processing for POS payments."
          icon={CreditCard}
          connected={providerConfigured === true}
          loading={card.isLoading}
          statusText={providerConfigured ? `${cardProvider?.toUpperCase()} active` : "Needs setup"}
          detail={providerConfigured
            ? `${cardProvider?.toUpperCase()} is selected and its required credentials are present.`
            : "Choose a payment provider and complete its terminal configuration."}
          href="/pos/card-terminal"
          action="Configure card terminal"
        />

        <IntegrationCard
          title="POS release delivery"
          description="Installer releases and verified download links supplied through GitHub."
          icon={GitBranch}
          connected={Boolean(githubRepo)}
          loading={settings.isLoading}
          statusText={githubRepo ? "Repository set" : "Needs setup"}
          detail={githubRepo || "Set the GitHub repository used to publish and verify POS installers."}
          href="/pos/download"
          action="Open POS downloads"
        />

        <IntegrationCard
          title="POS terminal fleet"
          description="Registered tills, device health, and synchronization with the back office."
          icon={Server}
          connected
          statusText="Available"
          detail="Manage terminal registrations and inspect synchronization health."
          href="/pos/terminals"
          action="Manage terminals"
        />

        {isSuperuser && (
          <IntegrationCard
            title="Customer deployments"
            description="Provider-neutral automation and health monitoring for isolated customers."
            icon={Plug}
            connected={control.data?.enabled === true}
            loading={control.isLoading}
            statusText={control.data?.enabled ? "Control enabled" : "Unavailable"}
            detail={control.data?.automationDispatch === "not_attached"
              ? "Deployment profiles are connected; automatic rollout dispatch is not attached yet."
              : "Monitor customer domains, versions, and rollout automation."}
            href="/deployment-control"
            action="Open deployment control"
          />
        )}
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">ERP systems</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect GlobiPOS to an external ERP while keeping credentials in deployment secrets.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {erpOptions.map(option => (
            <Card key={option.id} className="flex h-full flex-col">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-blue-50 p-2.5 text-blue-700">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <Badge variant="outline">Available</Badge>
                </div>
                <div>
                  <CardTitle className="text-lg">{option.name}</CardTitle>
                  <CardDescription className="mt-1.5 leading-5">{option.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="mt-auto space-y-4">
                <p className="text-sm text-muted-foreground">
                  Connection method: <span className="font-medium text-foreground">{option.interfaceName}</span>
                </p>
                <Button variant="outline" className="w-full justify-between" onClick={() => openErp(option)}>
                  Configure integration
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Dialog open={Boolean(selectedErp)} onOpenChange={open => !open && setSelectedErp(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Connect {selectedErp?.name}</DialogTitle>
            <DialogDescription>Set which system owns each record type for this customer deployment, then test or trigger synchronization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">Connection method</p>
              <p className="mt-1 text-sm text-muted-foreground">{selectedErp?.interfaceName}</p>
            </div>
            <div>
              <p className="text-sm font-medium">Required for setup</p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {selectedErp?.requirements.map(requirement => (
                  <li key={requirement} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {requirement}
                  </li>
                ))}
              </ul>
            </div>
            {selectedErp?.id === "custom-api" ? (
              <div className="space-y-4 border-t pt-4">
                <div>
                  <h3 className="font-semibold">Business rules</h3>
                  <p className="text-sm text-muted-foreground">Choose the source of truth and when item data is synchronized.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Who creates and maintains items?</Label>
                    <Select value={erpRules.itemOwner} onValueChange={value => setRule("itemOwner", value as ErpBusinessRules["itemOwner"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="erp">ERP</SelectItem><SelectItem value="globipos">GlobiPOS</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Item synchronization</Label>
                    <Select value={erpRules.itemSync} onValueChange={value => setRule("itemSync", value as ErpBusinessRules["itemSync"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual only</SelectItem>
                        <SelectItem value="15_minutes">Every 15 minutes</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {([
                    ["stockOwner", "Stock quantities"],
                    ["pricingOwner", "Prices"],
                    ["offerOwner", "Special offers"],
                    ["customerOwner", "Customers"],
                  ] as const).map(([key, label]) => (
                    <div className="space-y-2" key={key}>
                      <Label>{label} source of truth</Label>
                      <Select value={erpRules[key]} onValueChange={value => setRule(key, value as "globipos" | "erp")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="erp">ERP</SelectItem><SelectItem value="globipos">GlobiPOS</SelectItem></SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">The selected source of truth wins when the same record changes in both systems. Automatic deletion is never enabled by these rules.</p>
              </div>
            ) : (user?.role === "admin" || isSuperuser) ? (
              <div className="space-y-3">
                  <>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div><p className="text-sm font-medium">Enable connection</p><p className="text-xs text-muted-foreground">Credentials remain in deployment secrets.</p></div>
                       <Switch checked={selectedConfig?.provider === selectedErp?.id && selectedConfig?.enabled === true} onCheckedChange={enabled => saveErp({
                         provider: selectedErp!.id, enabled, policies: selectedConfig?.provider === selectedErp?.id ? (selectedConfig?.policies ?? {}) : {},
                      })} disabled={erpSaving} />
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Sync policy</p>
                      {erpRecordTypes.map(recordType => {
                         const policy = matchingConfig?.policies?.[recordType] ?? { enabled: false, sourceOfTruth: "globipos" as const };
                        return <div key={recordType} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded border p-2 text-sm">
                          <span className="capitalize">{recordType}</span>
                           <Switch checked={policy.enabled} onCheckedChange={enabled => saveErp({ provider: selectedErp!.id, enabled: matchingConfig?.enabled ?? false, policies: { ...(matchingConfig?.policies ?? {}), [recordType]: { ...policy, enabled } } })} disabled={erpSaving} />
                           <select aria-label={`${recordType} source of truth`} className="rounded border bg-background p-1 text-xs" value={policy.sourceOfTruth} onChange={event => saveErp({ provider: selectedErp!.id, enabled: matchingConfig?.enabled ?? false, policies: { ...(matchingConfig?.policies ?? {}), [recordType]: { ...policy, sourceOfTruth: event.target.value } } })} disabled={erpSaving}>
                            <option value="globipos">GlobiPOS</option><option value="erp">ERP</option>
                          </select>
                        </div>;
                      })}
                    </div>
                     {providerBinding.mismatchLabel && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">{providerBinding.mismatchLabel}. Test and sync apply only to that provider.</p>}
                     <div className="flex gap-2"><Button variant="outline" disabled={!providerBinding.canTest || erpSaving} onClick={() => { if (providerBinding.canTest) void saveErp({}, "/test"); }}>Test connection</Button><Button disabled={!providerBinding.canRun || erpSaving} onClick={() => { if (providerBinding.canRun) void saveErp({}, "/sync"); }}>Run sync</Button></div>
                     {matchingConfig && <p className="text-xs text-muted-foreground">Last test: {matchingConfig.lastTestStatus || "not run"} · Last sync: {matchingConfig.lastSyncStatus || "not run"}</p>}
                    <div className="max-h-32 space-y-1 overflow-auto rounded border p-2 text-xs">
                      <p className="font-medium">Recent sync audit</p>
                      {erpAudit.data?.length ? erpAudit.data.slice(0, 10).map(entry => <p key={entry.id}>{entry.status} · {entry.direction} · {entry.recordType} {entry.recordId}{entry.errorMessage ? ` — ${entry.errorMessage}` : ""}</p>) : <p className="text-muted-foreground">No sync events for this deployment.</p>}
                    </div>
                  </>
              </div>
            ) : <p className="text-sm text-muted-foreground">Only administrators can configure ERP synchronization.</p>}
            <p className="text-xs leading-5 text-muted-foreground">Connection passwords and API credentials are deployment secrets and are never saved in this profile or displayed here.</p>
          </div>
          <DialogFooter>
            <Button variant={selectedErp?.id === "custom-api" ? "outline" : "default"} onClick={() => setSelectedErp(null)}>
              {selectedErp?.id === "custom-api" ? "Cancel" : "Close"}
            </Button>
            {selectedErp?.id === "custom-api" && (
              <Button onClick={() => saveCustomRules.mutate()} disabled={saveCustomRules.isPending}>
                {saveCustomRules.isPending ? "Saving..." : "Save business rules"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}