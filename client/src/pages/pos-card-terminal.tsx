import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, CheckCircle2, AlertCircle, ExternalLink, Settings, Loader2, Wifi, WifiOff } from "lucide-react";

interface CardTerminalStatus {
  provider: string | null;
  jccConfigured: boolean;
  vivaConfigured: boolean;
  worldpayConfigured: boolean;
  activeProvider: string | null;
}

interface SystemSetting { key: string; value: string; }

const PROVIDERS = [
  {
    id: "jcc",
    name: "JCC Payment Systems",
    description: "Cyprus-based card processing — ideal for local businesses",
    logo: "🇨🇾",
    docUrl: "https://www.jcc.com.cy/en/merchants/",
    envVars: ["JCC_MERCHANT_ID", "JCC_API_KEY", "JCC_TERMINAL_ID"],
    fields: [
      { key: "JCC_MERCHANT_ID", label: "Merchant ID", placeholder: "e.g. 123456789" },
      { key: "JCC_TERMINAL_ID", label: "Terminal ID", placeholder: "e.g. T001" },
      { key: "JCC_API_KEY", label: "API Key", placeholder: "Provided by JCC", secret: true },
    ],
    instructions: [
      "Contact JCC Payment Systems to register as a merchant",
      "Request card-present terminal integration credentials",
      "Set the three environment variables shown below",
      "Restart the application — the POS will route card payments through JCC",
    ],
  },
  {
    id: "viva",
    name: "Viva Wallet",
    description: "Pan-European payment processing with soft POS support",
    logo: "🏦",
    docUrl: "https://developer.vivawallet.com/integration-reference/card-present/",
    envVars: ["VIVA_CLIENT_ID", "VIVA_CLIENT_SECRET", "VIVA_MERCHANT_ID", "VIVA_SOURCE_CODE"],
    fields: [
      { key: "VIVA_CLIENT_ID", label: "Client ID", placeholder: "OAuth Client ID" },
      { key: "VIVA_CLIENT_SECRET", label: "Client Secret", placeholder: "OAuth Client Secret", secret: true },
      { key: "VIVA_MERCHANT_ID", label: "Merchant ID", placeholder: "Your Viva merchant ID" },
      { key: "VIVA_SOURCE_CODE", label: "Source Code", placeholder: "Payment source code" },
    ],
    instructions: [
      "Create a Viva Wallet merchant account at vivawallet.com",
      "In the developer portal, create a Smart Checkout app to get OAuth credentials",
      "Enable 'Card Present' / 'Soft POS' permissions on your app",
      "Set the four environment variables below and restart",
    ],
  },
  {
    id: "worldpay",
    name: "Worldpay",
    description: "Global card processing — supports chip, contactless & magnetic stripe",
    logo: "🌍",
    docUrl: "https://developer.worldpay.com/docs/access-worldpay/api",
    envVars: ["WORLDPAY_ENTITY_ID", "WORLDPAY_API_KEY", "WORLDPAY_TERMINAL_GROUP"],
    fields: [
      { key: "WORLDPAY_ENTITY_ID", label: "Entity ID", placeholder: "Worldpay entity identifier" },
      { key: "WORLDPAY_API_KEY", label: "API Key", placeholder: "API authentication key", secret: true },
      { key: "WORLDPAY_TERMINAL_GROUP", label: "Terminal Group", placeholder: "Terminal group code" },
    ],
    instructions: [
      "Sign up for a Worldpay merchant account",
      "Request 'Access Worldpay' API credentials from your account manager",
      "Obtain your Terminal Group code from the Worldpay console",
      "Configure the environment variables below and restart the application",
    ],
  },
];

export default function PosCardTerminal() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("jcc");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: status } = useQuery<CardTerminalStatus>({
    queryKey: ["/api/pos/card-terminal/status"],
    staleTime: 30000,
  });

  const { data: settings = [] } = useQuery<SystemSetting[]>({
    queryKey: ["/api/settings"],
    staleTime: 30000,
  });

  const activeProvider = settings.find(s => s.key === "card_terminal_provider")?.value || null;

  const setProviderMutation = useMutation({
    mutationFn: (provider: string) =>
      apiRequest("POST", "/api/settings/card_terminal_provider", { value: provider }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Card terminal provider saved" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const testMutation = useMutation({
    mutationFn: (provider: string) =>
      apiRequest("POST", "/api/pos/card-terminal/test", { provider }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.success) {
        toast({ title: "Connection successful", description: data.message });
      } else {
        toast({ variant: "destructive", title: "Connection failed", description: data.message });
      }
    },
    onError: () => toast({ variant: "destructive", title: "Test failed", description: "Check your credentials and try again" }),
  });

  const currentProvider = PROVIDERS.find(p => p.id === activeTab)!;
  const isProviderConfigured = (id: string) => {
    if (!status) return false;
    if (id === "jcc") return status.jccConfigured;
    if (id === "viva") return status.vivaConfigured;
    if (id === "worldpay") return status.worldpayConfigured;
    return false;
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Card Terminal Integration"
        subtitle="Connect a card payment terminal (JCC, Viva Wallet, or Worldpay) to your POS"
        icon={<CreditCard className="w-5 h-5" />}
      />

      {/* Active provider banner */}
      <Card className={activeProvider ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20" : "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20"}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            {activeProvider
              ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              : <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />}
            <div>
              <p className={`font-medium ${activeProvider ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>
                {activeProvider
                  ? `Active provider: ${PROVIDERS.find(p => p.id === activeProvider)?.name ?? activeProvider}`
                  : "No card terminal provider configured"}
              </p>
              <p className="text-xs text-muted-foreground">
                {activeProvider
                  ? "Card payments at the POS will route through this provider."
                  : "Configure credentials below and select a provider to enable card payments."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          {PROVIDERS.map(p => (
            <TabsTrigger key={p.id} value={p.id} className="flex items-center gap-1.5" data-testid={`tab-provider-${p.id}`}>
              <span>{p.logo}</span>
              <span className="hidden sm:inline">{p.name.split(" ")[0]}</span>
              {isProviderConfigured(p.id) && <span className="w-2 h-2 rounded-full bg-green-500 ml-1" />}
              {activeProvider === p.id && <Badge variant="default" className="ml-1 text-[10px] h-4">Active</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>

        {PROVIDERS.map(provider => (
          <TabsContent key={provider.id} value={provider.id} className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span>{provider.logo}</span> {provider.name}
                    </CardTitle>
                    <CardDescription className="mt-1">{provider.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {isProviderConfigured(provider.id)
                      ? <Badge variant="default" className="text-xs"><Wifi className="w-3 h-3 mr-1" />Configured</Badge>
                      : <Badge variant="secondary" className="text-xs"><WifiOff className="w-3 h-3 mr-1" />Not set</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Setup instructions */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Setup Steps</p>
                  <ol className="space-y-1.5">
                    {provider.instructions.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
                        <span className="text-muted-foreground">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <a
                    href={provider.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-3 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {provider.name} Developer Docs
                  </a>
                </div>

                <Separator />

                {/* Environment variable reference */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Required Environment Variables</p>
                  <div className="rounded-lg border bg-muted/30 divide-y">
                    {provider.fields.map(field => (
                      <div key={field.key} className="flex items-center gap-3 px-3 py-2.5">
                        <code className="text-xs font-mono text-primary flex-1">{field.key}</code>
                        <span className="text-xs text-muted-foreground">{field.label}</span>
                        {field.secret && <Badge variant="outline" className="text-[10px] h-4">secret</Badge>}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Set these in your environment secrets (Replit Secrets tab or .env file). Restart the app after updating.
                  </p>
                </div>

                <Separator />

                {/* Actions */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testMutation.mutate(provider.id)}
                    disabled={testMutation.isPending}
                    data-testid={`button-test-${provider.id}`}
                  >
                    {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Settings className="w-3.5 h-3.5 mr-1.5" />}
                    Test Connection
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setProviderMutation.mutate(provider.id)}
                    disabled={setProviderMutation.isPending || activeProvider === provider.id}
                    data-testid={`button-activate-${provider.id}`}
                  >
                    {setProviderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CreditCard className="w-3.5 h-3.5 mr-1.5" />}
                    {activeProvider === provider.id ? "Active" : "Set as Active"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* Integration note */}
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">
            <strong>How it works:</strong> Once configured, the POS terminal will send card payment requests to the selected provider's API. 
            Physical card terminals must be registered in the provider's merchant console and associated with the terminal codes configured above. 
            The POS receives a success/failure response and records the payment accordingly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
