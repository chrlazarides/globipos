import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "./db";
import { requireSuperuser } from "./auth";
import { checkDomain, type DomainCheck } from "./domain-readiness";
import { sendDomainStatusNotification } from "./email";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { activityLogs, deploymentDomainIncidents, deploymentProfiles, deploymentRollouts, operatorAlertFailures } from "@shared/schema";

const statusSchema = z.enum(["draft", "active", "suspended"]);
const healthStatusSchema = z.enum(["unknown", "healthy", "warning", "offline", "error"]);
const automationSchema = z.enum(["manual", "github", "replit"]);
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
}).strict();

const profileBaseSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case").min(2).max(80),
  clientName: z.string().trim().min(1).max(200),
  status: statusSchema.default("draft"),
  backOfficeUrl: urlSchema,
  posServerUrl: urlSchema,
  customerDomain: hostnameSchema.nullable().optional(),
  posDomain: hostnameSchema.nullable().optional(),
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

  if (customerDomain && backOfficeHost !== customerDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backOfficeUrl"], message: "Back office URL must use the customer domain" });
  }
  if (posDomain && posHost !== posDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["posServerUrl"], message: "POS URL must use the POS domain" });
  }
  if (customerDomain && !posDomain && posHost !== customerDomain) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["posServerUrl"], message: "POS URL must use the customer domain when no POS override is set" });
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
  "customerDomain" | "posDomain" | "status" | "domainStatus" | "domainCheckedAt"
>;

export type DeploymentWriteGuard = {
  customerDomain: string | null;
  posDomain: string | null;
  status?: DeploymentWriteSnapshot["status"];
  domainStatus?: DeploymentWriteSnapshot["domainStatus"];
  domainCheckedAt?: Date | null;
};

export function deploymentWriteStillValid(
  guard: DeploymentWriteGuard,
  current: DeploymentWriteSnapshot,
) {
  return current.customerDomain === guard.customerDomain
    && current.posDomain === guard.posDomain
    && (guard.status === undefined || current.status === guard.status)
    && (guard.domainStatus === undefined || current.domainStatus === guard.domainStatus)
    && (guard.domainCheckedAt === undefined
      || current.domainCheckedAt?.getTime() === guard.domainCheckedAt?.getTime());
}

function deploymentWritePredicate(guard: DeploymentWriteGuard) {
  return and(
    guard.customerDomain === null
      ? isNull(deploymentProfiles.customerDomain)
      : eq(deploymentProfiles.customerDomain, guard.customerDomain),
    guard.posDomain === null
      ? isNull(deploymentProfiles.posDomain)
      : eq(deploymentProfiles.posDomain, guard.posDomain),
    guard.status === undefined ? undefined : eq(deploymentProfiles.status, guard.status),
    guard.domainStatus === undefined ? undefined : eq(deploymentProfiles.domainStatus, guard.domainStatus),
    guard.domainCheckedAt === undefined
      ? undefined
      : guard.domainCheckedAt === null
        ? isNull(deploymentProfiles.domainCheckedAt)
        : eq(deploymentProfiles.domainCheckedAt, guard.domainCheckedAt),
  );
}

export function isActiveDomainCheckDue(
  profile: Pick<typeof deploymentProfiles.$inferSelect, "status" | "customerDomain" | "domainStatus" | "domainCheckedAt">,
  now = Date.now(),
) {
  if (profile.status !== "active" || !profile.customerDomain) return false;
  if (!profile.domainCheckedAt) return true;
  const interval = profile.domainStatus === "failed" ? FAILED_DOMAIN_RETRY_MS : ACTIVE_DOMAIN_RECHECK_MS;
  return now - profile.domainCheckedAt.getTime() >= interval;
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
) {
  if (transition === "start") {
    await tx.insert(deploymentDomainIncidents).values({
      deploymentId,
      startedAt: checkedAt,
      reason,
    }).onConflictDoNothing();
  } else if (transition === "recover") {
    await tx.update(deploymentDomainIncidents).set({ recoveredAt: checkedAt }).where(and(
      eq(deploymentDomainIncidents.deploymentId, deploymentId),
      isNull(deploymentDomainIncidents.recoveredAt),
    ));
  }
}
function hasFreshConnectedDomains(profile: typeof deploymentProfiles.$inferSelect) {
  return profile.domainStatus === "connected"
    && profile.domainCheckedAt instanceof Date
    && Date.now() - profile.domainCheckedAt.getTime() <= DOMAIN_CHECK_MAX_AGE_MS;
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
  const checks = await Promise.all(domainTargets(currentProfile).map(target => withDeadline(
    checkDomain(target.hostname, target.role),
    DOMAIN_PROBE_TIMEOUT_MS,
    {
      hostname: target.hostname,
      role: target.role,
      status: "failed" as const,
      dnsAddresses: [],
      reason: `Domain probe timed out after ${DOMAIN_PROBE_TIMEOUT_MS / 1000} seconds`,
    },
  )));
  const failures = checks.filter(check => check.status === "failed");
  const domainStatus = failures.length ? "failed" : "connected";
  const domainMessage = failures.length
    ? failures.map(check => `${check.hostname}: ${check.reason}`).join("; ")
    : `All ${checks.length} required hostname${checks.length === 1 ? "" : "s"} passed DNS and HTTPS checks.`;
  const checkedAt = new Date();
  const notificationKind = domainNotificationKind(currentProfile.domainStatus, domainStatus);
  const pendingNotification = nextPendingDomainNotification(
    currentProfile.domainStatus,
    domainStatus,
    currentProfile.domainNotificationPending as DomainNotificationKind,
  );
  const writePredicate = deploymentWritePredicate({
    customerDomain: currentProfile.customerDomain,
    posDomain: currentProfile.posDomain,
    domainCheckedAt: currentProfile.domainCheckedAt,
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
      domainFailureStartedAt: failures.length ? (currentProfile.domainFailureStartedAt ?? checkedAt) : null,
      domainFailureCount: failures.length ? currentProfile.domainFailureCount + 1 : 0,
      domainNotificationPending: pendingNotification,
      ...(notificationKind ? {
        domainNotificationMessage: domainMessage,
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
      status: "active",
      domainCheckedAt: profile.domainCheckedAt,
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
          const pendingNotification = result.profile.domainNotificationPending as DomainNotificationKind;
          if (pendingNotification) {
            const notificationResult = await sendDomainStatusNotification({
              clientName: result.profile.clientName,
              slug: result.profile.slug,
              customerDomain: result.profile.customerDomain!,
              posDomain: result.profile.posDomain,
              status: pendingNotification === "outage" ? "failed" : "recovered",
              message: result.profile.domainNotificationMessage ?? result.domainMessage,
              failureStartedAt: result.profile.domainFailureStartedAt,
              checkedAt: result.profile.domainNotificationCreatedAt ?? result.profile.domainCheckedAt!,
            });
            const attemptedAt = new Date();
            const deliveryStatus = notificationResult.success
              ? "sent"
              : notificationResult.skipped ? "skipped" : "failed";
            const deliveryMessage = notificationResult.success
              ? `${pendingNotification === "outage" ? "Outage" : "Recovery"} notification delivered to support`
              : notificationResult.error ?? "Domain notification could not be delivered";
            const delivery: DomainNotificationDelivery = {
              status: deliveryStatus,
              kind: pendingNotification,
              message: deliveryMessage,
              attemptedAt: attemptedAt.toISOString(),
            };
            const deliveryUpdate = {
              domainNotificationDeliveryStatus: deliveryStatus,
              domainNotificationDeliveryKind: pendingNotification,
              domainNotificationDeliveryMessage: deliveryMessage,
              domainNotificationDeliveryAttemptedAt: attemptedAt,
              domainNotificationDeliveryHistory: appendDomainNotificationDelivery(
                result.profile.domainNotificationDeliveryHistory,
                delivery,
              ),
            };
            if (notificationResult.success) {
              await db.update(deploymentProfiles).set({
                ...deliveryUpdate,
                domainNotificationPending: null,
                domainNotificationMessage: null,
                domainNotificationCreatedAt: null,
              }).where(and(
                eq(deploymentProfiles.id, result.profile.id),
                eq(deploymentProfiles.domainNotificationPending, pendingNotification),
                result.profile.domainNotificationCreatedAt
                  ? eq(deploymentProfiles.domainNotificationCreatedAt, result.profile.domainNotificationCreatedAt)
                  : isNull(deploymentProfiles.domainNotificationCreatedAt),
              ));
            } else {
              await db.update(deploymentProfiles).set(deliveryUpdate).where(and(
                eq(deploymentProfiles.id, result.profile.id),
                eq(deploymentProfiles.domainNotificationPending, pendingNotification),
                result.profile.domainNotificationCreatedAt
                  ? eq(deploymentProfiles.domainNotificationCreatedAt, result.profile.domainNotificationCreatedAt)
                  : isNull(deploymentProfiles.domainNotificationCreatedAt),
              ));
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
  setTimeout(run, 60_000);
  setInterval(run, DOMAIN_MONITOR_TICK_MS);
}

export function registerDeploymentControlRoutes(app: Express) {
  if (process.env.NODE_ENV !== "development" && process.env.CONTROL_PLANE_ENABLED !== "true") {
    return;
  }
  startActiveDomainMonitor();

  app.get("/api/control/status", requireSuperuser, async (_req, res) => {
    const alertDeliveryFailures = await db.select().from(operatorAlertFailures)
      .where(isNull(operatorAlertFailures.resolvedAt))
      .orderBy(desc(operatorAlertFailures.lastFailedAt));
    res.json({
      enabled: true,
      environment: process.env.NODE_ENV,
      automationDispatch: "not_attached",
      alertDeliveryFailures,
    });
  });

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
    const parsed = profileCreateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    const { overrideDomainWarning, ...profileValues } = parsed.data;
    if (profileValues.status === "active" && !overrideDomainWarning) {
      return res.status(409).json({
        message: "A new deployment cannot be active before its domains are checked. Create it as a draft, run the domain check, then activate it.",
        code: "DOMAIN_NOT_READY",
        domainStatus: "pending",
      });
    }
    try {
      const [profile] = await db.insert(deploymentProfiles).values(profileValues).returning();
      await logControlActivity(req, overrideDomainWarning ? "override_domain_activation" : "create", "deployment_profile", profile.id, overrideDomainWarning ? `Created and activated ${profile.slug} with an explicit domain warning override` : `Created deployment profile ${profile.slug}`);
      res.status(201).json(safeProfile(profile));
    } catch (error: any) {
      if (error?.code === "23505") return res.status(409).json({ message: "Deployment slug already exists" });
      throw error;
    }
  });

  app.patch("/api/control/deployments/:id", requireSuperuser, async (req, res) => {
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "No updates supplied" });
    const id = String(req.params.id);
    const [currentProfile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, id));
    if (!currentProfile) return res.status(404).json({ message: "Deployment profile not found" });
    const { overrideDomainWarning, ...updates } = parsed.data;
    const merged = profileSchema.safeParse({ ...editableProfile(currentProfile), ...updates });
    if (!merged.success) return validationError(res, merged.error);
    const routingChanged = (
      updates.customerDomain !== undefined && updates.customerDomain !== currentProfile.customerDomain
    ) || (
      updates.posDomain !== undefined && updates.posDomain !== currentProfile.posDomain
    );
    const targetStatus = updates.status ?? currentProfile.status;
    const needsActivationApproval = targetStatus === "active" && (
      currentProfile.status !== "active" || routingChanged
    );
    if (needsActivationApproval && (!hasFreshConnectedDomains(currentProfile) || routingChanged) && !overrideDomainWarning) {
      return res.status(409).json({
        message: "Required customer domains are not connected with a recent check. Run the domain check before activation, or deliberately override this warning.",
        code: "DOMAIN_NOT_READY",
        domainStatus: currentProfile.domainStatus,
        domainMessage: currentProfile.domainMessage,
      });
    }
    const writeGuard: DeploymentWriteGuard = {
      customerDomain: currentProfile.customerDomain,
      posDomain: currentProfile.posDomain,
      ...((routingChanged || updates.status !== undefined) ? { status: currentProfile.status } : {}),
      ...(needsActivationApproval && !overrideDomainWarning ? {
        domainStatus: currentProfile.domainStatus,
        domainCheckedAt: currentProfile.domainCheckedAt,
      } : {}),
    };
    const [profile] = await db.update(deploymentProfiles)
      .set(withoutUndefined({
        ...updates,
        ...(routingChanged ? { domainStatus: "pending", domainMessage: "Hostname changed; run the domain check again.", domainChecks: [], domainCheckedAt: null, domainFailureStartedAt: null, domainFailureCount: 0, domainCheckClaimedAt: null, domainCheckClaimToken: null, domainNotificationPending: null, domainNotificationMessage: null, domainNotificationCreatedAt: null } : {}),
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
