import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "./db";
import { requireSuperuser } from "./auth";
import { checkDomain, type DomainCheck } from "./domain-readiness";
import { sendDomainStatusNotification } from "./email";
import { retryCustomerAiPersistenceAlert } from "./operator-alerting";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { activityLogs, deploymentDomainIncidents, deploymentProfiles, deploymentRollouts, operatorAlertFailures, type OperatorAlertRetryHistoryEntry } from "@shared/schema";

const statusSchema = z.enum(["draft", "active", "suspended"]);
const healthStatusSchema = z.enum(["unknown", "healthy", "warning", "offline", "error"]);
const automationSchema = z.enum(["manual", "github", "replit"]);
export const CUSTOMER_DEPLOYMENT_BASE_DOMAIN = "globipos.shop";
const RESERVED_CUSTOMER_SUBDOMAINS = new Set([
  "admin", "api", "app", "assets", "mail", "pos", "status", "support", "web", "www",
]);

export function customerDeploymentHostname(slug: string): string {
  return `${slug}.${CUSTOMER_DEPLOYMENT_BASE_DOMAIN}`;
}

export function customerEShopHostname(slug: string): string {
  return `web-${slug}.${CUSTOMER_DEPLOYMENT_BASE_DOMAIN}`;
}
const urlSchema = z.string().url().refine(
  value => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  "URL must use http or https",
);
const hostnameSchema = z.string().trim().min(1).max(253).regex(
  /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
  "Enter a hostname without a protocol or path",
);
const versionSchema = z.string().trim().min(1).max(128);
const brandingSchema = z.object({
  companyName: z.string().trim().max(200).optional(),
  legalName: z.string().trim().max(200).optional(),
  logoUrl: urlSchema.optional(),
  primaryColor: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hexadecimal color").optional(),
  legalAddress: z.string().trim().max(1000).optional(),
  taxId: z.string().trim().max(100).optional(),
  storefrontTemplate: z.enum(["classic", "fresh-market"]).optional(),
}).strict();

const profileBaseSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case").min(2).max(63)
    .refine(value => !RESERVED_CUSTOMER_SUBDOMAINS.has(value), "This subdomain is reserved"),
  clientName: z.string().trim().min(1).max(200),
  status: statusSchema.default("draft"),
  backOfficeUrl: urlSchema,
  posServerUrl: urlSchema,
  customerDomain: hostnameSchema.nullable().optional(),
  posDomain: hostnameSchema.nullable().optional(),
  eShopDomain: hostnameSchema.nullable().optional(),
  branding: brandingSchema.default({}),
  enabledFeatures: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  paymentProvider: z.string().trim().min(1).max(100).default("none"),
  emailProvider: z.string().trim().min(1).max(100).default("none"),
  whatsappProvider: z.string().trim().min(1).max(100).default("none"),
  backOfficeVersion: versionSchema.default("unknown"),
  posVersion: versionSchema.default("unknown"),
  targetBackOfficeVersion: versionSchema.nullable().optional(),
  targetPosVersion: versionSchema.nullable().optional(),
  automationProvider: automationSchema.default("manual"),
  externalProjectId: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();

function validateProfileRouting(value: z.infer<typeof profileBaseSchema>, ctx: z.RefinementCtx) {
  const customerDomain = value.customerDomain?.toLowerCase() || null;
  const posDomain = value.posDomain?.toLowerCase() || null;
  const backOfficeHost = new URL(value.backOfficeUrl).hostname.toLowerCase();
  const posHost = new URL(value.posServerUrl).hostname.toLowerCase();
  if (value.enabledFeatures.includes("customer-portal") && value.slug.length > 59) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slug"], message: "Slug must be at most 59 characters when the customer e-shop is enabled" });
  }

  if (customerDomain && backOfficeHost !== customerDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backOfficeUrl"], message: "Back office URL must use the customer domain" });
  }
  if (posDomain && posHost !== posDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["posServerUrl"], message: "POS URL must use the POS domain" });
  }
  if (customerDomain && !posDomain && posHost !== customerDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["posServerUrl"], message: "POS URL must use the customer domain when no POS override is set" });
  }
  if (value.eShopDomain && value.eShopDomain.toLowerCase() !== customerEShopHostname(value.slug)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eShopDomain"], message: "E-shop hostname must use web-<slug>.globipos.shop" });
  }
}

const profileSchema = profileBaseSchema.superRefine(validateProfileRouting);
const profileCreateSchema = profileBaseSchema.extend({
  overrideDomainWarning: z.boolean().optional(),
}).strict().superRefine((value, ctx) => validateProfileRouting(value, ctx));
const profilePatchSchema = profileBaseSchema.partial().extend({
  overrideDomainWarning: z.boolean().optional(),
}).strict();
const heartbeatSchema = z.object({
  backOfficeVersion: versionSchema.optional(),
  posVersion: versionSchema.optional(),
  healthStatus: healthStatusSchema.optional(),
  healthMessage: z.string().trim().max(1000).nullable().optional(),
}).strict();
const rolloutSchema = z.object({
  all: z.boolean().optional(),
  deploymentIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
  targetBackOfficeVersion: versionSchema.nullable().optional(),
  targetPosVersion: versionSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.all === true && value.deploymentIds?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide either all or deploymentIds, not both" });
  }
  if (value.all !== true && !value.deploymentIds?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Set all to true or provide deploymentIds" });
  }
  if (!value.targetBackOfficeVersion && !value.targetPosVersion) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one target version is required" });
  }
});

const incidentHistoryQueryBaseSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z.enum(["all", "ongoing", "recovered"]).default("all"),
});

function validateIncidentDateRange(value: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "End date must be on or after start date" });
  }
}

const incidentHistoryQuerySchema = incidentHistoryQueryBaseSchema.superRefine(validateIncidentDateRange);
const incidentExportQuerySchema = incidentHistoryQueryBaseSchema
  .omit({ page: true, pageSize: true })
  .superRefine(validateIncidentDateRange);

export function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function incidentHistoryFilters(
  deploymentId: string,
  query: z.infer<typeof incidentHistoryQuerySchema>,
) {
  return and(
    eq(deploymentDomainIncidents.deploymentId, deploymentId),
    query.from ? gte(deploymentDomainIncidents.startedAt, new Date(`${query.from}T00:00:00.000Z`)) : undefined,
    query.to ? lte(deploymentDomainIncidents.startedAt, new Date(`${query.to}T23:59:59.999Z`)) : undefined,
    query.status === "ongoing" ? isNull(deploymentDomainIncidents.recoveredAt) : undefined,
    query.status === "recovered" ? isNotNull(deploymentDomainIncidents.recoveredAt) : undefined,
  );
}

function durationMinutes(startedAt: Date, recoveredAt: Date | null, now = new Date()) {
  return Math.max(0, Math.floor(((recoveredAt ?? now).getTime() - startedAt.getTime()) / 60_000));
}

function withoutUndefined<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function editableProfile(profile: typeof deploymentProfiles.$inferSelect) {
  return Object.fromEntries(
    Object.keys(profileBaseSchema.shape).map(key => [key, profile[key as keyof typeof profile]]),
  );
}

export function isReservedDeploymentSlug(slug: string) {
  return RESERVED_CUSTOMER_SUBDOMAINS.has(slug) || RESERVED_CUSTOMER_SUBDOMAINS.has(`web-${slug}`);
}
function safeProfile(profile: typeof deploymentProfiles.$inferSelect) {
  const {
    credentialHash: _credentialHash,
    domainCheckClaimedAt: _domainCheckClaimedAt,
    domainCheckClaimToken: _domainCheckClaimToken,
    domainNotificationPending: _domainNotificationPending,
    domainNotificationMessage: _domainNotificationMessage,
    domainNotificationCreatedAt: _domainNotificationCreatedAt,
    ...safe
  } = profile;
  return safe;
}


async function logControlActivity(req: Request, action: string, entity: string, entityId: string, description: string) {
  try {
    await db.insert(activityLogs).values({
      userId: req.user?.id ?? null,
      username: req.user?.username ?? null,
      action,
      entity,
      entityId,
      description,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
  } catch {
    // Activity logging must not prevent a control-plane operation.
  }
}

function validationError(res: Response, error: z.ZodError) {
  return res.status(400).json({ message: "Invalid request", errors: error.flatten() });
}

const DOMAIN_CHECK_MAX_AGE_MS = 15 * 60 * 1000;
const ACTIVE_DOMAIN_RECHECK_MS = 6 * 60 * 60 * 1000;
const FAILED_DOMAIN_RETRY_MS = 60 * 60 * 1000;
const DOMAIN_MONITOR_TICK_MS = 15 * 60 * 1000;
const DOMAIN_CHECK_LEASE_MS = 10 * 60 * 1000;
const DOMAIN_PROBE_TIMEOUT_MS = 20 * 1000;
let domainMonitorStarted = false;
let domainMonitorRunning = false;

export type DomainNotificationKind = "outage" | "recovery" | null;

export type DomainNotificationDelivery = {
  status: "sent" | "failed" | "skipped";
  kind: Exclude<DomainNotificationKind, null>;
  message: string;
  attemptedAt: string;
};

export type QueuedDomainNotification = {
  id: string;
  role: "main" | "eshop";
  kind: Exclude<DomainNotificationKind, null>;
  hostname: string;
  message: string;
  createdAt: string;
};
export function domainNotificationKind(
  previousStatus: string,
  nextStatus: string,
): DomainNotificationKind {
  if (previousStatus !== "failed" && nextStatus === "failed") return "outage";
  if (previousStatus === "failed" && nextStatus === "connected") return "recovery";
  return null;
}

export function nextPendingDomainNotification(
  previousStatus: string,
  nextStatus: string,
  currentPending: DomainNotificationKind,
): DomainNotificationKind {
  return domainNotificationKind(previousStatus, nextStatus) ?? currentPending;
}

type DeploymentWriteSnapshot = Pick<
  typeof deploymentProfiles.$inferSelect,
  "customerDomain" | "posDomain" | "eShopDomain" | "status" | "domainStatus" | "domainCheckedAt" | "eShopDomainStatus" | "eShopDomainCheckedAt"
>;

export type DeploymentWriteGuard = {
  customerDomain: string | null;
  posDomain: string | null;
  eShopDomain?: string | null;
  status?: DeploymentWriteSnapshot["status"];
  domainStatus?: DeploymentWriteSnapshot["domainStatus"];
  domainCheckedAt?: Date | null;
  eShopDomainStatus?: DeploymentWriteSnapshot["eShopDomainStatus"];
  eShopDomainCheckedAt?: Date | null;
};

export function deploymentWriteStillValid(
  guard: DeploymentWriteGuard,
  current: DeploymentWriteSnapshot,
) {
  return current.customerDomain === guard.customerDomain
    && current.posDomain === guard.posDomain
    && (guard.eShopDomain === undefined || current.eShopDomain === guard.eShopDomain)
    && (guard.status === undefined || current.status === guard.status)
    && (guard.domainStatus === undefined || current.domainStatus === guard.domainStatus)
    && (guard.domainCheckedAt === undefined
      || current.domainCheckedAt?.getTime() === guard.domainCheckedAt?.getTime())
    && (guard.eShopDomainStatus === undefined || current.eShopDomainStatus === guard.eShopDomainStatus)
    && (guard.eShopDomainCheckedAt === undefined
      || current.eShopDomainCheckedAt?.getTime() === guard.eShopDomainCheckedAt?.getTime());
}

function deploymentWritePredicate(guard: DeploymentWriteGuard) {
  return and(
    guard.customerDomain === null
      ? isNull(deploymentProfiles.customerDomain)
      : eq(deploymentProfiles.customerDomain, guard.customerDomain),
    guard.posDomain === null
      ? isNull(deploymentProfiles.posDomain)
      : eq(deploymentProfiles.posDomain, guard.posDomain),
    guard.eShopDomain === undefined
      ? undefined
      : guard.eShopDomain === null
        ? isNull(deploymentProfiles.eShopDomain)
        : eq(deploymentProfiles.eShopDomain, guard.eShopDomain),
    guard.status === undefined ? undefined : eq(deploymentProfiles.status, guard.status),
    guard.domainStatus === undefined ? undefined : eq(deploymentProfiles.domainStatus, guard.domainStatus),
    guard.domainCheckedAt === undefined
      ? undefined
      : guard.domainCheckedAt === null
        ? isNull(deploymentProfiles.domainCheckedAt)
        : eq(deploymentProfiles.domainCheckedAt, guard.domainCheckedAt),
    guard.eShopDomainStatus === undefined
      ? undefined
      : eq(deploymentProfiles.eShopDomainStatus, guard.eShopDomainStatus),
    guard.eShopDomainCheckedAt === undefined
      ? undefined
      : guard.eShopDomainCheckedAt === null
        ? isNull(deploymentProfiles.eShopDomainCheckedAt)
        : eq(deploymentProfiles.eShopDomainCheckedAt, guard.eShopDomainCheckedAt),
  );
}

export function isActiveDomainCheckDue(
  profile: Pick<typeof deploymentProfiles.$inferSelect, "status" | "customerDomain" | "domainStatus" | "domainCheckedAt">
    & Partial<Pick<typeof deploymentProfiles.$inferSelect, "eShopDomain" | "eShopDomainStatus" | "eShopDomainCheckedAt">>,
  now = Date.now(),
) {
  if (profile.status !== "active" || !profile.customerDomain) return false;
  const mainDue = !profile.domainCheckedAt || now - profile.domainCheckedAt.getTime() >= (profile.domainStatus === "failed" ? FAILED_DOMAIN_RETRY_MS : ACTIVE_DOMAIN_RECHECK_MS);
  const eShopDue = !!profile.eShopDomain && (
    !profile.eShopDomainCheckedAt
    || now - profile.eShopDomainCheckedAt.getTime() >= (profile.eShopDomainStatus === "failed" ? FAILED_DOMAIN_RETRY_MS : ACTIVE_DOMAIN_RECHECK_MS)
  );
  return mainDue || eShopDue;
}

export function domainIncidentTransition(
  previousStatus: string,
  nextStatus: "connected" | "failed",
) {
  if (nextStatus === "failed" && previousStatus !== "failed") return "start" as const;
  if (nextStatus === "connected") return "recover" as const;
  return "none" as const;
}

export async function applyDomainIncidentTransition(
  tx: Pick<typeof db, "insert" | "update">,
  deploymentId: string,
  transition: ReturnType<typeof domainIncidentTransition>,
  checkedAt: Date,
  reason: string,
  role: "main" | "eshop" = "main",
) {
  if (transition === "start") {
    await tx.insert(deploymentDomainIncidents).values({
      deploymentId,
      startedAt: checkedAt,
      reason,
      role,
    }).onConflictDoNothing();
  } else if (transition === "recover") {
    await tx.update(deploymentDomainIncidents).set({ recoveredAt: checkedAt }).where(and(
      eq(deploymentDomainIncidents.deploymentId, deploymentId),
      eq(deploymentDomainIncidents.role, role),
      isNull(deploymentDomainIncidents.recoveredAt),
    ));
  }
}
export function hasFreshConnectedDomains(profile: Pick<
  typeof deploymentProfiles.$inferSelect,
  "domainStatus" | "domainCheckedAt" | "eShopDomain" | "eShopDomainStatus" | "eShopDomainCheckedAt"
>) {
  const mainReady = profile.domainStatus === "connected"
    && profile.domainCheckedAt instanceof Date
    && Date.now() - profile.domainCheckedAt.getTime() <= DOMAIN_CHECK_MAX_AGE_MS;
  const eShopReady = !profile.eShopDomain || (
    profile.eShopDomainStatus === "connected"
    && profile.eShopDomainCheckedAt instanceof Date
    && Date.now() - profile.eShopDomainCheckedAt.getTime() <= DOMAIN_CHECK_MAX_AGE_MS
  );
  return mainReady && eShopReady;
}

function domainTargets(profile: typeof deploymentProfiles.$inferSelect) {
  return [
    { hostname: profile.customerDomain!, role: "customer" as const },
    ...(profile.posDomain ? [{ hostname: profile.posDomain, role: "pos" as const }] : []),
  ];
}

export function withDeadline<T>(promise: Promise<T>, timeoutMs: number, timeoutValue: T) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function checkProfileDomains(currentProfile: typeof deploymentProfiles.$inferSelect, claimToken?: string) {
  const [checks, eShopCheck] = await Promise.all([
    Promise.all(domainTargets(currentProfile).map(target => withDeadline(
    checkDomain(target.hostname, target.role),
    DOMAIN_PROBE_TIMEOUT_MS,
    {
      hostname: target.hostname,
      role: target.role,
      status: "failed" as const,
      dnsAddresses: [],
      reason: `Domain probe timed out after ${DOMAIN_PROBE_TIMEOUT_MS / 1000} seconds`,
    },
    ))),
    currentProfile.eShopDomain
      ? withDeadline(checkDomain(currentProfile.eShopDomain, "eshop"), DOMAIN_PROBE_TIMEOUT_MS, {
          hostname: currentProfile.eShopDomain,
          role: "eshop" as const,
          status: "failed" as const,
          dnsAddresses: [],
          reason: `Domain probe timed out after ${DOMAIN_PROBE_TIMEOUT_MS / 1000} seconds`,
        })
      : Promise.resolve(null),
  ]);
  const failures = checks.filter(check => check.status === "failed");
  const domainStatus = failures.length ? "failed" : "connected";
  const domainMessage = failures.length
    ? failures.map(check => `${check.hostname}: ${check.reason}`).join("; ")
    : `All ${checks.length} required hostname${checks.length === 1 ? "" : "s"} passed DNS and HTTPS checks.`;
  const checkedAt = new Date();
  const mainNotificationKind = domainNotificationKind(currentProfile.domainStatus, domainStatus);
  const eShopDomainStatus = eShopCheck?.status ?? "pending";
  const eShopNotificationKind = eShopCheck
    ? domainNotificationKind(currentProfile.eShopDomainStatus, eShopDomainStatus)
    : null;
  const notificationKind = mainNotificationKind ?? eShopNotificationKind;
  const notificationMessage = mainNotificationKind
    ? domainMessage
    : eShopCheck ? `${eShopCheck.hostname}: ${eShopCheck.reason}` : domainMessage;
  const newNotifications: QueuedDomainNotification[] = [
    ...(mainNotificationKind ? [{
      id: crypto.randomUUID(),
      role: "main" as const,
      kind: mainNotificationKind,
      hostname: currentProfile.customerDomain!,
      message: domainMessage,
      createdAt: checkedAt.toISOString(),
    }] : []),
    ...(eShopNotificationKind && eShopCheck ? [{
      id: crypto.randomUUID(),
      role: "eshop" as const,
      kind: eShopNotificationKind,
      hostname: eShopCheck.hostname,
      message: `${eShopCheck.hostname}: ${eShopCheck.reason}`,
      createdAt: checkedAt.toISOString(),
    }] : []),
  ];
  const firstNotification = newNotifications[0];
  const writePredicate = deploymentWritePredicate({
    customerDomain: currentProfile.customerDomain,
    posDomain: currentProfile.posDomain,
    eShopDomain: currentProfile.eShopDomain,
    domainCheckedAt: currentProfile.domainCheckedAt,
    eShopDomainCheckedAt: currentProfile.eShopDomainCheckedAt,
  });
  const claimPredicate = claimToken
    ? eq(deploymentProfiles.domainCheckClaimToken, claimToken)
    : undefined;
  const profile = await db.transaction(async tx => {
    const [updated] = await tx.update(deploymentProfiles).set({
      domainStatus,
      domainMessage,
      domainChecks: checks,
      domainCheckedAt: checkedAt,
      eShopDomainStatus,
      eShopDomainMessage: eShopCheck?.reason ?? null,
      eShopDomainCheck: eShopCheck,
      eShopDomainCheckedAt: eShopCheck ? checkedAt : null,
      domainFailureStartedAt: failures.length ? (currentProfile.domainFailureStartedAt ?? checkedAt) : null,
      domainFailureCount: failures.length ? currentProfile.domainFailureCount + 1 : 0,
      ...(newNotifications.length ? {
        domainNotificationQueue: appendDomainNotificationsValue(newNotifications),
        domainNotificationPending: firstNotification.kind,
      } : {}),
      ...(notificationKind ? {
        domainNotificationMessage: notificationMessage,
        domainNotificationCreatedAt: checkedAt,
      } : {}),
      ...(claimToken ? { domainCheckClaimedAt: null, domainCheckClaimToken: null } : {}),
      updatedAt: checkedAt,
    }).where(and(eq(deploymentProfiles.id, currentProfile.id), writePredicate, claimPredicate)).returning();
    if (!updated) return undefined;

    await applyDomainIncidentTransition(
      tx,
      currentProfile.id,
      domainIncidentTransition(currentProfile.domainStatus, domainStatus),
      checkedAt,
      domainMessage,
    );
    if (eShopCheck) {
      await applyDomainIncidentTransition(
        tx,
        currentProfile.id,
        domainIncidentTransition(currentProfile.eShopDomainStatus, eShopCheck.status),
        checkedAt,
        `${eShopCheck.hostname}: ${eShopCheck.reason}`,
        "eshop",
      );
    }
    return updated;
  });
  return { profile, domainStatus, domainMessage };
}

async function claimProfileDomainCheck(profile: typeof deploymentProfiles.$inferSelect, now: Date) {
  const claimToken = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - DOMAIN_CHECK_LEASE_MS);
  const [claimed] = await db.update(deploymentProfiles).set({
    domainCheckClaimedAt: now,
    domainCheckClaimToken: claimToken,
  }).where(and(
    eq(deploymentProfiles.id, profile.id),
    deploymentWritePredicate({
      customerDomain: profile.customerDomain,
      posDomain: profile.posDomain,
      eShopDomain: profile.eShopDomain,
      status: "active",
      domainCheckedAt: profile.domainCheckedAt,
      eShopDomainCheckedAt: profile.eShopDomainCheckedAt,
    }),
    or(isNull(deploymentProfiles.domainCheckClaimedAt), lt(deploymentProfiles.domainCheckClaimedAt, staleBefore)),
  )).returning();
  return claimed ? { profile: claimed, claimToken } : null;
}

export function startActiveDomainMonitor() {
  if (domainMonitorStarted) return;
  domainMonitorStarted = true;
  const run = async () => {
    if (domainMonitorRunning) return;
    domainMonitorRunning = true;
    try {
      const now = Date.now();
      const activeProfiles = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.status, "active"));
      const due = activeProfiles.filter(profile => isActiveDomainCheckDue(profile, now));
      for (const profile of due) {
        try {
          const claim = await claimProfileDomainCheck(profile, new Date());
          if (!claim) continue;
          const result = await checkProfileDomains(claim.profile, claim.claimToken);
          if (!result.profile) continue;
          const notificationKind = domainNotificationKind(profile.domainStatus, result.domainStatus);
          if (notificationKind === "outage") {
            console.error(`[domain-monitor] Active deployment ${profile.slug} failed: ${result.domainMessage}`);
          } else if (notificationKind === "recovery") {
            console.info(`[domain-monitor] Active deployment ${profile.slug} recovered`);
          }
          const eShopTransition = result.profile.eShopDomain
            ? domainNotificationKind(profile.eShopDomainStatus, result.profile.eShopDomainStatus)
            : null;
          if (eShopTransition === "outage") {
            console.error(`[domain-monitor] Active e-shop ${profile.slug} failed: ${result.profile.eShopDomainMessage}`);
          } else if (eShopTransition === "recovery") {
            console.info(`[domain-monitor] Active e-shop ${profile.slug} recovered`);
          }
          const notificationQueue = Array.isArray(result.profile.domainNotificationQueue)
            ? result.profile.domainNotificationQueue as QueuedDomainNotification[]
            : [];
          let remainingNotifications = notificationQueue;
          let deliveryHistory = result.profile.domainNotificationDeliveryHistory;
          for (const pending of notificationQueue) {
            const notificationResult = await sendDomainStatusNotification({
              clientName: result.profile.clientName,
              slug: result.profile.slug,
              customerDomain: pending.hostname,
              posDomain: pending.role === "main" ? result.profile.posDomain : null,
              status: pending.kind === "outage" ? "failed" : "recovered",
              message: pending.message,
              failureStartedAt: pending.role === "main" ? result.profile.domainFailureStartedAt : null,
              checkedAt: new Date(pending.createdAt),
            });
            const attemptedAt = new Date();
            const deliveryStatus = notificationResult.success
              ? "sent"
              : notificationResult.skipped ? "skipped" : "failed";
            const deliveryMessage = notificationResult.success
              ? `${pending.role === "eshop" ? "E-shop " : ""}${pending.kind === "outage" ? "outage" : "recovery"} notification delivered to support`
              : notificationResult.error ?? "Domain notification could not be delivered";
            const delivery: DomainNotificationDelivery = {
              status: deliveryStatus,
              kind: pending.kind,
              message: deliveryMessage,
              attemptedAt: attemptedAt.toISOString(),
            };
            deliveryHistory = appendDomainNotificationDelivery(deliveryHistory, delivery);
            const deliveryUpdate = {
              domainNotificationDeliveryStatus: deliveryStatus,
              domainNotificationDeliveryKind: pending.kind,
              domainNotificationDeliveryMessage: deliveryMessage,
              domainNotificationDeliveryAttemptedAt: attemptedAt,
              domainNotificationDeliveryHistory: deliveryHistory,
            };
            if (notificationResult.success) {
              remainingNotifications = remainingNotifications.filter(entry => entry !== pending);
              await acknowledgeDomainNotification(result.profile.id, pending.id, deliveryUpdate);
            } else {
              await db.update(deploymentProfiles).set(deliveryUpdate)
                .where(eq(deploymentProfiles.id, result.profile.id));
              if (!notificationResult.skipped) {
                console.error(`[domain-monitor] Notification failed for ${profile.slug}: ${notificationResult.error}`);
              }
            }
          }
        } catch (error) {
          console.error(`[domain-monitor] Check failed for ${profile.slug}:`, error);
        }
      }
    } catch (error) {
      console.error("[domain-monitor] Scheduled check failed:", error);
    } finally {
      domainMonitorRunning = false;
    }
  };
  const startupTimer = setTimeout(run, 60_000);
  const monitorTimer = setInterval(run, DOMAIN_MONITOR_TICK_MS);
  startupTimer.unref();
  monitorTimer.unref();
}

export async function loadActiveOperatorAlertFailures() {
  return db.select().from(operatorAlertFailures)
    .where(and(
      isNull(operatorAlertFailures.resolvedAt),
      inArray(operatorAlertFailures.status, ["pending", "delivering", "failed"]),
    ))
    .orderBy(desc(operatorAlertFailures.lastFailedAt));
}

type OperatorAlertRetryHistoryEntryInput = {
  attemptedAt: string;
  outcome: "delivered" | "failed";
  operator: { id: string | null; username: string | null };
};

export type ResolvedOperatorAlert = {
  operation: string;
  resolvedAt: Date;
  retryHistory: Array<{
    attemptedAt: string;
    outcome: "delivered" | "failed";
  }>;
};

export function sanitizeResolvedOperatorAlert(
  alert: Pick<typeof operatorAlertFailures.$inferSelect, "operation" | "resolvedAt" | "retryHistory">,
): ResolvedOperatorAlert | null {
  if (!alert.resolvedAt) return null;
  const retryHistory = Array.isArray(alert.retryHistory)
    ? alert.retryHistory.flatMap(entry => {
        if (!entry || typeof entry !== "object") return [];
        const candidate = entry as Partial<OperatorAlertRetryHistoryEntry>;
        if (typeof candidate.attemptedAt !== "string" || (candidate.outcome !== "delivered" && candidate.outcome !== "failed")) return [];
        return [{ attemptedAt: candidate.attemptedAt, outcome: candidate.outcome }];
      }).slice(-10)
    : [];
  return { operation: alert.operation, resolvedAt: alert.resolvedAt, retryHistory };
}

export async function loadResolvedOperatorAlerts(): Promise<ResolvedOperatorAlert[]> {
  const alerts = await db.select({
    operation: operatorAlertFailures.operation,
    resolvedAt: operatorAlertFailures.resolvedAt,
    retryHistory: operatorAlertFailures.retryHistory,
  }).from(operatorAlertFailures)
    .where(isNotNull(operatorAlertFailures.resolvedAt))
    .orderBy(desc(operatorAlertFailures.resolvedAt))
    .limit(20);
  return alerts.flatMap(alert => {
    const sanitized = sanitizeResolvedOperatorAlert(alert);
    return sanitized ? [sanitized] : [];
  });
}

export function registerDeploymentControlRoutes(app: Express) {
  if (process.env.NODE_ENV !== "development" && process.env.CONTROL_PLANE_ENABLED !== "true") {
    return;
  }
  startActiveDomainMonitor();

  app.get("/api/control/status", requireSuperuser, async (_req, res) => {
    const [alertDeliveryFailures, resolvedOperatorAlerts] = await Promise.all([
      loadActiveOperatorAlertFailures(),
      loadResolvedOperatorAlerts(),
    ]);
    res.json({
      enabled: true,
      environment: process.env.NODE_ENV,
      automationDispatch: "not_attached",
      alertDeliveryFailures,
      resolvedOperatorAlerts,
    });
  });

  app.post("/api/control/operator-alerts/:operation/retry", requireSuperuser, retryOperatorAlert);

  app.get("/api/control/deployments", requireSuperuser, async (_req, res) => {
    res.json(await loadDeploymentProfilesWithIncidents());
  });

  app.get("/api/control/deployments/:id/incidents", requireSuperuser, async (req, res) => {
    const parsed = incidentHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed.error);
    const deploymentId = String(req.params.id);
    const [profile] = await db.select({ id: deploymentProfiles.id, clientName: deploymentProfiles.clientName, slug: deploymentProfiles.slug })
      .from(deploymentProfiles).where(eq(deploymentProfiles.id, deploymentId));
    if (!profile) return res.status(404).json({ message: "Deployment profile not found" });
    const where = incidentHistoryFilters(deploymentId, parsed.data);
    const [countRows, incidents] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(deploymentDomainIncidents).where(where),
      db.select().from(deploymentDomainIncidents).where(where)
        .orderBy(desc(deploymentDomainIncidents.startedAt), desc(deploymentDomainIncidents.id))
        .limit(parsed.data.pageSize)
        .offset((parsed.data.page - 1) * parsed.data.pageSize),
    ]);
    const count = countRows[0]?.count ?? 0;
    res.json({
      deployment: profile,
      incidents,
      pagination: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / parsed.data.pageSize)),
      },
    });
  });

  app.get("/api/control/deployments/:id/incidents/export", requireSuperuser, async (req, res) => {
    const parsed = incidentExportQuerySchema.safeParse(req.query);
    if (!parsed.success) return validationError(res, parsed.error);
    const deploymentId = String(req.params.id);
    const [profile] = await db.select({ id: deploymentProfiles.id, clientName: deploymentProfiles.clientName, slug: deploymentProfiles.slug })
      .from(deploymentProfiles).where(eq(deploymentProfiles.id, deploymentId));
    if (!profile) return res.status(404).json({ message: "Deployment profile not found" });
    const incidents = await db.select().from(deploymentDomainIncidents)
      .where(incidentHistoryFilters(deploymentId, { ...parsed.data, page: 1, pageSize: 20 }))
      .orderBy(asc(deploymentDomainIncidents.startedAt), asc(deploymentDomainIncidents.id));
    const generatedAt = new Date();
    const rows = incidents.map(incident => [
      profile.clientName,
      profile.slug,
      incident.startedAt.toISOString(),
      incident.recoveredAt?.toISOString() ?? null,
      durationMinutes(incident.startedAt, incident.recoveredAt, generatedAt),
      incident.recoveredAt ? "recovered" : "ongoing",
      incident.reason,
    ].map(csvCell).join(","));
    const csv = [
      "deployment,deployment_slug,started_at,recovered_at,duration_minutes,status,reason",
      ...rows,
    ].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${profile.slug}-domain-incidents.csv"`);
    res.send(`\uFEFF${csv}\r\n`);
  });

  app.post("/api/control/deployments", requireSuperuser, async (req, res) => {
    const requestedSlug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const generatedHostname = requestedSlug ? customerDeploymentHostname(requestedSlug) : "";
    const parsed = profileCreateSchema.safeParse(generatedHostname ? {
      ...req.body,
      customerDomain: generatedHostname,
      posDomain: null,
      backOfficeUrl: `https://${generatedHostname}`,
      posServerUrl: `https://${generatedHostname}`,
    } : req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const { overrideDomainWarning, ...requestedValues } = parsed.data;
    const profileValues = {
      ...requestedValues,
      eShopDomain: requestedValues.enabledFeatures.includes("customer-portal")
        ? customerEShopHostname(requestedValues.slug)
        : null,
    };
    if (profileValues.status === "active" && !overrideDomainWarning) {
      return res.status(409).json({
        message: "A new deployment cannot be active before its domains are checked. Create it as a draft, run the domain check, then activate it.",
        code: "DOMAIN_NOT_READY",
        domainStatus: "pending",
      });
    }
    try {
      const requestedDomains = [profileValues.customerDomain, profileValues.posDomain, profileValues.eShopDomain].filter((value): value is string => !!value);
      const [domainOwner] = requestedDomains.length ? await db.select({ id: deploymentProfiles.id }).from(deploymentProfiles)
        .where(or(
          inArray(deploymentProfiles.customerDomain, requestedDomains),
          inArray(deploymentProfiles.posDomain, requestedDomains),
          inArray(deploymentProfiles.eShopDomain, requestedDomains),
        )).limit(1) : [];
      if (domainOwner) {
        return res.status(409).json({ message: `The hostname ${profileValues.customerDomain} is already assigned to another deployment`, code: "DOMAIN_ALREADY_ASSIGNED" });
      }
      const [profile] = await db.insert(deploymentProfiles).values(profileValues).returning();
      await logControlActivity(req, overrideDomainWarning ? "override_domain_activation" : "create", "deployment_profile", profile.id, overrideDomainWarning ? `Created and activated ${profile.slug} with an explicit domain warning override` : `Created deployment profile ${profile.slug}`);
      res.status(201).json(safeProfile(profile));
    } catch (error: any) {
      if (error?.code === "23505") {
        const domainCollision = String(error?.message || "").includes("deployment hostname");
        return res.status(409).json({
          message: domainCollision ? "One of these hostnames is already assigned to another deployment" : "Deployment slug already exists",
          code: domainCollision ? "DOMAIN_ALREADY_ASSIGNED" : "SLUG_ALREADY_ASSIGNED",
        });
      }
      throw error;
    }
  });

  app.patch("/api/control/deployments/:id", requireSuperuser, async (req, res) => {
    const requestedSlug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const generatedHostname = requestedSlug ? customerDeploymentHostname(requestedSlug) : "";
    const parsed = profilePatchSchema.safeParse(generatedHostname ? {
      ...req.body,
      customerDomain: generatedHostname,
      posDomain: null,
      backOfficeUrl: `https://${generatedHostname}`,
      posServerUrl: `https://${generatedHostname}`,
    } : req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "No updates supplied" });
    const id = String(req.params.id);
    const [currentProfile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, id));
    if (!currentProfile) return res.status(404).json({ message: "Deployment profile not found" });
    const { overrideDomainWarning, ...parsedUpdates } = parsed.data;
    const updates = { ...parsedUpdates };
    if (updates.slug !== undefined || updates.enabledFeatures !== undefined) {
      const targetSlug = updates.slug ?? currentProfile.slug;
      const targetFeatures = updates.enabledFeatures ?? currentProfile.enabledFeatures as string[];
      updates.eShopDomain = targetFeatures.includes("customer-portal")
        ? customerEShopHostname(targetSlug)
        : null;
    }
    const merged = profileSchema.safeParse({ ...editableProfile(currentProfile), ...updates });
    if (!merged.success) return validationError(res, merged.error);
    const routingChanged = (
      updates.customerDomain !== undefined && updates.customerDomain !== currentProfile.customerDomain
    ) || (
      updates.posDomain !== undefined && updates.posDomain !== currentProfile.posDomain
    ) || (
      updates.eShopDomain !== undefined && updates.eShopDomain !== currentProfile.eShopDomain
    );
    const targetStatus = updates.status ?? currentProfile.status;
    if (routingChanged) {
      const nextDomains = [
        updates.customerDomain ?? currentProfile.customerDomain,
        updates.posDomain ?? currentProfile.posDomain,
        updates.eShopDomain ?? currentProfile.eShopDomain,
      ].filter((value): value is string => !!value);
      if (nextDomains.length) {
        const [domainOwner] = await db.select({ id: deploymentProfiles.id }).from(deploymentProfiles)
          .where(or(
            inArray(deploymentProfiles.customerDomain, nextDomains),
            inArray(deploymentProfiles.posDomain, nextDomains),
            inArray(deploymentProfiles.eShopDomain, nextDomains),
          ))
          .limit(1);
        if (domainOwner && domainOwner.id !== id) {
          return res.status(409).json({ message: "One of these hostnames is already assigned to another deployment", code: "DOMAIN_ALREADY_ASSIGNED" });
        }
      }
    }
    const needsActivationApproval = targetStatus === "active" && (
      currentProfile.status !== "active" || routingChanged
    );
    if (needsActivationApproval && (!hasFreshConnectedDomains(currentProfile) || routingChanged) && !overrideDomainWarning) {
      return res.status(409).json({
        message: "Required customer domains are not connected with a recent check. Run the domain check before activation, or deliberately override this warning.",
        code: "DOMAIN_NOT_READY",
        domainStatus: currentProfile.domainStatus,
        domainMessage: currentProfile.domainMessage,
        eShopDomainStatus: currentProfile.eShopDomainStatus,
        eShopDomainMessage: currentProfile.eShopDomainMessage,
      });
    }
    const writeGuard: DeploymentWriteGuard = {
      customerDomain: currentProfile.customerDomain,
      posDomain: currentProfile.posDomain,
      eShopDomain: currentProfile.eShopDomain,
      ...((routingChanged || updates.status !== undefined) ? { status: currentProfile.status } : {}),
      ...(needsActivationApproval && !overrideDomainWarning ? {
        domainStatus: currentProfile.domainStatus,
        domainCheckedAt: currentProfile.domainCheckedAt,
        eShopDomainStatus: currentProfile.eShopDomainStatus,
        eShopDomainCheckedAt: currentProfile.eShopDomainCheckedAt,
      } : {}),
    };
    const [profile] = await db.update(deploymentProfiles)
      .set(withoutUndefined({
        ...updates,
        ...(routingChanged ? { domainStatus: "pending", domainMessage: "Hostname changed; run the domain check again.", domainChecks: [], domainCheckedAt: null, eShopDomainStatus: "pending", eShopDomainMessage: updates.eShopDomain === null ? null : "E-shop hostname changed; run the domain check again.", eShopDomainCheck: null, eShopDomainCheckedAt: null, domainFailureStartedAt: null, domainFailureCount: 0, domainCheckClaimedAt: null, domainCheckClaimToken: null, domainNotificationPending: null, domainNotificationMessage: null, domainNotificationCreatedAt: null } : {}),
        updatedAt: new Date(),
      }))
      .where(and(eq(deploymentProfiles.id, id), deploymentWritePredicate(writeGuard)))
      .returning();
    if (!profile) {
      return res.status(409).json({ message: "Deployment routing or domain readiness changed while saving. Review the latest profile and try again.", code: "DEPLOYMENT_CHANGED" });
    }
    await logControlActivity(req, overrideDomainWarning ? "override_domain_activation" : "update", "deployment_profile", profile.id, overrideDomainWarning ? `Activated ${profile.slug} with an explicit domain warning override (previous status: ${currentProfile.domainStatus})` : `Updated deployment profile ${profile.slug}`);
    res.json(safeProfile(profile));
  });

  app.post("/api/control/deployments/:id/check-domains", requireSuperuser, async (req, res) => {
    const id = String(req.params.id);
    const [currentProfile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, id));
    if (!currentProfile) return res.status(404).json({ message: "Deployment profile not found" });
    if (!currentProfile.customerDomain) {
      return res.status(400).json({ message: "A primary customer hostname is required before checking domains" });
    }
    const { profile, domainStatus, domainMessage } = await checkProfileDomains(currentProfile);
    if (!profile) {
      return res.status(409).json({ message: "Hostname settings changed while the check was running. Run the domain check again.", code: "DOMAIN_CHANGED_DURING_CHECK" });
    }
    await logControlActivity(req, "check_domains", "deployment_profile", id, `Domain check ${domainStatus} for ${profile.slug}: ${domainMessage}`);
    res.json(safeProfile(profile));
  });

  app.delete("/api/control/deployments/:id", requireSuperuser, async (req, res) => {
    const id = String(req.params.id);
    const [profile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, id));
    if (!profile) return res.status(404).json({ message: "Deployment profile not found" });
    if (profile.status !== "draft") return res.status(409).json({ message: "Only draft deployment profiles can be deleted" });
    await db.delete(deploymentProfiles).where(and(eq(deploymentProfiles.id, profile.id), eq(deploymentProfiles.status, "draft")));
    await logControlActivity(req, "delete", "deployment_profile", profile.id, `Deleted draft deployment profile ${profile.slug}`);
    res.status(204).send();
  });

  app.post("/api/control/deployments/:id/rotate-credential", requireSuperuser, async (req, res) => {
    const id = String(req.params.id);
    const token = `gdp_${crypto.randomBytes(32).toString("base64url")}`;
    const credentialHash = crypto.createHash("sha256").update(token).digest("hex");
    const [profile] = await db.update(deploymentProfiles)
      .set({ credentialHash, updatedAt: new Date() })
      .where(eq(deploymentProfiles.id, id))
      .returning();
    if (!profile) return res.status(404).json({ message: "Deployment profile not found" });
    await logControlActivity(req, "rotate_credential", "deployment_profile", profile.id, `Rotated agent credential for ${profile.slug}`);
    res.json({ deployment: safeProfile(profile), credential: token, message: "Store this credential now; it will not be shown again." });
  });

  app.get("/api/control/deployments/:id/export", requireSuperuser, async (req, res) => {
    const profileId = String(req.params.id);
    const [profile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, profileId));
    if (!profile) return res.status(404).json({ message: "Deployment profile not found" });
    const {
      credentialHash: _credentialHash,
      domainCheckClaimedAt: _domainCheckClaimedAt,
      domainCheckClaimToken: _domainCheckClaimToken,
      domainNotificationPending: _domainNotificationPending,
      domainNotificationMessage: _domainNotificationMessage,
      domainNotificationCreatedAt: _domainNotificationCreatedAt,
      domainNotificationDeliveryStatus: _domainNotificationDeliveryStatus,
      domainNotificationDeliveryKind: _domainNotificationDeliveryKind,
      domainNotificationDeliveryMessage: _domainNotificationDeliveryMessage,
      domainNotificationDeliveryAttemptedAt: _domainNotificationDeliveryAttemptedAt,
      domainNotificationDeliveryHistory: _domainNotificationDeliveryHistory,
      createdAt,
      updatedAt,
      lastHeartbeatAt,
      healthStatus,
      healthMessage,
      ...manifest
    } = profile;
    res.json({ manifestVersion: 1, deployment: manifest });
  });

  app.get("/api/control/rollouts", requireSuperuser, async (_req, res) => {
    res.json(await db.select().from(deploymentRollouts).orderBy(desc(deploymentRollouts.createdAt)));
  });

  app.post("/api/control/rollouts", requireSuperuser, async (req, res) => {
    const parsed = rolloutSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const activeProfiles = parsed.data.all
      ? await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.status, "active"))
      : await db.select().from(deploymentProfiles).where(and(inArray(deploymentProfiles.id, parsed.data.deploymentIds!), eq(deploymentProfiles.status, "active")));
    const deploymentIds = activeProfiles.map(profile => profile.id);
    if (!deploymentIds.length) return res.status(400).json({ message: "No active deployment profiles matched this rollout" });
    const targets = withoutUndefined({
      targetBackOfficeVersion: parsed.data.targetBackOfficeVersion,
      targetPosVersion: parsed.data.targetPosVersion,
      updatedAt: new Date(),
    });
    await db.update(deploymentProfiles).set(targets).where(inArray(deploymentProfiles.id, deploymentIds));
    const [rollout] = await db.insert(deploymentRollouts).values({
      scope: parsed.data.all ? "all" : "selected",
      deploymentIds,
      targetBackOfficeVersion: parsed.data.targetBackOfficeVersion ?? null,
      targetPosVersion: parsed.data.targetPosVersion ?? null,
      status: "queued",
      initiatedBy: req.user!.id,
      notes: parsed.data.notes ?? null,
    }).returning();
    await logControlActivity(req, "create", "deployment_rollout", rollout.id, `Created queued rollout for ${deploymentIds.length} active deployment(s)`);
    res.status(201).json({ ...rollout, automation: { status: "queued", message: "Automation dispatch is not attached; this rollout remains queued." } });
  });

  app.post("/api/control/heartbeat", async (req, res) => {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Deployment credential required" });
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const credentialHash = crypto.createHash("sha256").update(token).digest("hex");
    const [profile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.credentialHash, credentialHash));
    if (!profile) return res.status(401).json({ message: "Invalid deployment credential" });
    if (profile.status === "suspended") return res.status(403).json({ message: "Deployment profile is suspended" });
    await db.update(deploymentProfiles).set(withoutUndefined({
      ...parsed.data,
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })).where(eq(deploymentProfiles.id, profile.id));
    res.json({ ok: true, deploymentId: profile.id });
  });
}

export function appendDomainNotificationDelivery(
  history: unknown,
  delivery: DomainNotificationDelivery,
): DomainNotificationDelivery[] {
  const entries = Array.isArray(history) ? history : [];
  return [...entries, delivery].slice(-50) as DomainNotificationDelivery[];
}

export async function loadDeploymentProfilesWithIncidents(
  database: Pick<typeof db, "select"> = db,
) {
  const [profiles, incidents] = await Promise.all([
    database.select().from(deploymentProfiles).orderBy(deploymentProfiles.clientName),
    database.select().from(deploymentDomainIncidents).where(sql`
      ${deploymentDomainIncidents.id} IN (
        SELECT incident_id
        FROM (
          SELECT id AS incident_id,
            row_number() OVER (PARTITION BY deployment_id ORDER BY started_at DESC) AS incident_rank
          FROM deployment_domain_incidents
        ) ranked_incidents
        WHERE incident_rank <= 5
      )
    `).orderBy(desc(deploymentDomainIncidents.startedAt)),
  ]);
  const recentByDeployment = new Map<string, typeof incidents>();
  for (const incident of incidents) {
    const recent = recentByDeployment.get(incident.deploymentId) ?? [];
    if (recent.length < 5) {
      recent.push(incident);
      recentByDeployment.set(incident.deploymentId, recent);
    }
  }
  return profiles.map((profile: typeof deploymentProfiles.$inferSelect) => ({
    ...safeProfile(profile),
    domainIncidents: recentByDeployment.get(profile.id) ?? [],
  }));
}

export function appendOperatorAlertRetryHistory(
  history: unknown,
  entry: OperatorAlertRetryHistoryEntryInput,
): OperatorAlertRetryHistoryEntry[] {
  const existing = Array.isArray(history)
    ? history.filter((item): item is OperatorAlertRetryHistoryEntry => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<OperatorAlertRetryHistoryEntry>;
        return typeof candidate.attemptedAt === "string"
          && (candidate.outcome === "delivered" || candidate.outcome === "failed")
          && !!candidate.operator
          && typeof candidate.operator === "object";
      })
    : [];
  return [...existing, entry].slice(-10);
}

let loadOperatorAlertForRetry = async (alertKey: string): Promise<RetryableOperatorAlert | undefined> => {
  const [failure] = await db.select().from(operatorAlertFailures)
    .where(eq(operatorAlertFailures.alertKey, alertKey));
  return failure;
};

type RetryableOperatorAlert = typeof operatorAlertFailures.$inferSelect;

export function setOperatorAlertRetryLookupForTests(
  lookup?: (alertKey: string) => Promise<RetryableOperatorAlert | undefined>,
) {
  loadOperatorAlertForRetry = lookup ?? (async alertKey => {
    const [failure] = await db.select().from(operatorAlertFailures)
      .where(eq(operatorAlertFailures.alertKey, alertKey));
    return failure;
  });
}

export async function retryOperatorAlert(req: Request, res: Response) {
  const operation = z.enum(["load", "save"]).safeParse(req.params.operation);
  if (!operation.success) return res.status(400).json({ message: "Unknown operator alert operation" });
  const outcome = await retryCustomerAiPersistenceAlert(operation.data);
  const alertKey = `customer_ai_health_persistence_failed:${operation.data}`;
  if (outcome === "not_claimed") {
    const failure = await loadOperatorAlertForRetry(alertKey);
    const now = Date.now();
    if (failure?.nextAttemptAt && failure.nextAttemptAt.getTime() > now) {
      return res.status(409).json({
        message: `This alert is cooling down. Retry is available at ${failure.nextAttemptAt.toISOString()}.`,
        code: "OPERATOR_ALERT_RETRY_COOLDOWN",
        retryEligibleAt: failure.nextAttemptAt,
      });
    }
    if (failure?.status === "delivering") {
      return res.status(409).json({
        message: "Another operator or worker is already delivering this alert. Try again shortly.",
        code: "OPERATOR_ALERT_RETRY_LEASE_CONFLICT",
      });
    }
    return res.status(409).json({
      message: "This alert is no longer unresolved and cannot be retried.",
      code: "OPERATOR_ALERT_RETRY_NOT_READY",
    });
  }
  const currentFailure = await loadOperatorAlertForRetry(alertKey);
  if (currentFailure) {
    await db.update(operatorAlertFailures).set({
      retryHistory: appendOperatorAlertRetryHistory(currentFailure.retryHistory, {
        attemptedAt: new Date().toISOString(),
        outcome,
        operator: {
          id: req.user?.id ?? null,
          username: req.user?.username ?? null,
        },
      }),
    }).where(eq(operatorAlertFailures.alertKey, alertKey));
  }
  await logControlActivity(req, "retry", "operator_alert", alertKey, `Retried customer AI history ${operation.data} alert delivery: ${outcome}`);
  const failure = await loadOperatorAlertForRetry(alertKey);
  res.status(outcome === "delivered" ? 200 : 502).json({ outcome, alert: failure ?? null });
}

export function appendDomainNotificationsValue(notifications: QueuedDomainNotification[]) {
  return sql`${deploymentProfiles.domainNotificationQueue} || ${JSON.stringify(notifications)}::jsonb`;
}

export function appendQueuedDomainNotifications(
  queue: unknown,
  notifications: QueuedDomainNotification[],
) {
  const existing = Array.isArray(queue) ? queue as QueuedDomainNotification[] : [];
  return [...existing, ...notifications].slice(-20);
}

export async function acknowledgeDomainNotification(
  deploymentId: string,
  notificationId: string,
  deliveryUpdate: Record<string, unknown>,
) {
  const [updated] = await db.update(deploymentProfiles).set({
    ...deliveryUpdate,
    domainNotificationQueue: sql`coalesce((
      select jsonb_agg(entry)
      from jsonb_array_elements(${deploymentProfiles.domainNotificationQueue}) entry
      where entry->>'id' <> ${notificationId}
    ), '[]'::jsonb)`,
  }).where(eq(deploymentProfiles.id, deploymentId)).returning({
    domainNotificationQueue: deploymentProfiles.domainNotificationQueue,
  });
  return updated;
}
