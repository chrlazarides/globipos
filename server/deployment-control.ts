import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { activityLogs, deploymentProfiles, deploymentRollouts } from "@shared/schema";
import { requireSuperuser } from "./auth";

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
const profileUpdateSchema = profileBaseSchema.partial();
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

function withoutUndefined<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function editableProfile(profile: typeof deploymentProfiles.$inferSelect) {
  return Object.fromEntries(
    Object.keys(profileBaseSchema.shape).map(key => [key, profile[key as keyof typeof profile]]),
  );
}

function safeProfile(profile: typeof deploymentProfiles.$inferSelect) {
  const { credentialHash: _credentialHash, ...safe } = profile;
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

export function registerDeploymentControlRoutes(app: Express) {
  if (process.env.NODE_ENV !== "development" && process.env.CONTROL_PLANE_ENABLED !== "true") {
    return;
  }

  app.get("/api/control/status", requireSuperuser, (_req, res) => {
    res.json({ enabled: true, environment: process.env.NODE_ENV, automationDispatch: "not_attached" });
  });

  app.get("/api/control/deployments", requireSuperuser, async (_req, res) => {
    const profiles = await db.select().from(deploymentProfiles).orderBy(deploymentProfiles.clientName);
    res.json(profiles.map(safeProfile));
  });

  app.post("/api/control/deployments", requireSuperuser, async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    try {
      const [profile] = await db.insert(deploymentProfiles).values(parsed.data).returning();
      await logControlActivity(req, "create", "deployment_profile", profile.id, `Created deployment profile ${profile.slug}`);
      res.status(201).json(safeProfile(profile));
    } catch (error: any) {
      if (error?.code === "23505") return res.status(409).json({ message: "Deployment slug already exists" });
      throw error;
    }
  });

  app.patch("/api/control/deployments/:id", requireSuperuser, async (req, res) => {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, parsed.error);
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "No updates supplied" });
    const id = String(req.params.id);
    const [currentProfile] = await db.select().from(deploymentProfiles).where(eq(deploymentProfiles.id, id));
    if (!currentProfile) return res.status(404).json({ message: "Deployment profile not found" });
    const merged = profileSchema.safeParse({ ...editableProfile(currentProfile), ...parsed.data });
    if (!merged.success) return validationError(res, merged.error);
    const [profile] = await db.update(deploymentProfiles)
      .set(withoutUndefined({ ...parsed.data, updatedAt: new Date() }))
      .where(eq(deploymentProfiles.id, id))
      .returning();
    await logControlActivity(req, "update", "deployment_profile", profile.id, `Updated deployment profile ${profile.slug}`);
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
    const { credentialHash: _credentialHash, createdAt, updatedAt, lastHeartbeatAt, healthStatus, healthMessage, ...manifest } = profile;
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