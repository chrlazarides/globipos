import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
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
import type { SystemSetting } from "@shared/schema";

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

  const githubRepo = settings.data?.find(setting => setting.key === "pos_github_repo")?.value;
  const cardProvider = card.data?.activeProvider;
  const providerConfigured = cardProvider === "jcc"
    ? card.data?.jccConfigured
    : cardProvider === "viva"
      ? card.data?.vivaConfigured
      : cardProvider === "worldpay"
        ? card.data?.worldpayConfigured
        : false;

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
    </div>
  );
}