import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  applyDomainIncidentTransition,
  acknowledgeDomainNotification,
  appendDomainNotificationDelivery,
  appendDomainNotificationsValue,
  appendQueuedDomainNotifications,
  appendOperatorAlertRetryHistory,
  customerDeploymentHostname,
  customerEShopHostname,
  csvCell,
  domainIncidentTransition,
  domainNotificationKind,
  isActiveDomainCheckDue,
  loadDeploymentProfilesWithIncidents,
  registerDeploymentControlRoutes,
  nextPendingDomainNotification,
  retryOperatorAlert,
  sanitizeResolvedOperatorAlert,
  setOperatorAlertRetryLookupForTests,
  withDeadline,
} from "./deployment-control";
import { db, pool } from "./db";
import { deploymentDomainIncidents, deploymentProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperuser, signToken } from "./auth";
import { setCustomerAiPersistenceAlertClaimerForTests } from "./operator-alerting";

const now = Date.parse("2026-09-08T12:00:00.000Z");

test("customer deployment hostnames use the connected globipos.shop domain", () => {
  assert.equal(customerDeploymentHostname("acme-market"), "acme-market.globipos.shop");
  assert.equal(customerEShopHostname("acme-market"), "web-acme-market.globipos.shop");
});

test("active connected domains are checked every six hours", () => {
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "connected",
    domainCheckedAt: new Date(now - 6 * 60 * 60 * 1000),
  }, now), true);
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "connected",
    domainCheckedAt: new Date(now - 5 * 60 * 60 * 1000),
  }, now), false);
});

test("failed domains are retried no more than hourly", () => {
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "failed",
    domainCheckedAt: new Date(now - 60 * 60 * 1000),
  }, now), true);
  assert.equal(isActiveDomainCheckDue({
    status: "active",
    customerDomain: "shop.example.com",
    domainStatus: "failed",
    domainCheckedAt: new Date(now - 59 * 60 * 1000),
  }, now), false);
});

test("draft, suspended, and unconfigured profiles are never scheduled", () => {
  for (const profile of [
    { status: "draft", customerDomain: "shop.example.com", domainStatus: "connected", domainCheckedAt: null },
    { status: "suspended", customerDomain: "shop.example.com", domainStatus: "failed", domainCheckedAt: null },
    { status: "active", customerDomain: null, domainStatus: "pending", domainCheckedAt: null },
  ]) {
    assert.equal(isActiveDomainCheckDue(profile, now), false);
  }
});

test("a stalled domain operation returns a useful timeout result", async () => {
  const result = await withDeadline(
    new Promise<string>(() => {}),
    5,
    "domain probe timed out",
  );
  assert.equal(result, "domain probe timed out");
});

test("domain notifications are emitted only on outage and recovery transitions", () => {
  assert.equal(domainNotificationKind("connected", "failed"), "outage");
  assert.equal(domainNotificationKind("failed", "connected"), "recovery");
  assert.equal(domainNotificationKind("failed", "failed"), null);
  assert.equal(domainNotificationKind("connected", "connected"), null);
  assert.equal(domainNotificationKind("pending", "failed"), "outage");
  assert.equal(domainNotificationKind("unknown", "failed"), "outage");
});

test("failed notification delivery remains pending for the next monitor retry", () => {
  const firstFailure = nextPendingDomainNotification("connected", "failed", null);
  assert.equal(firstFailure, "outage");
  assert.equal(nextPendingDomainNotification("failed", "failed", firstFailure), "outage");

  const afterSuccessfulDelivery = null;
  assert.equal(nextPendingDomainNotification("failed", "failed", afterSuccessfulDelivery), null);
  assert.equal(nextPendingDomainNotification("failed", "connected", afterSuccessfulDelivery), "recovery");
});

test("notification delivery history retains failures after a later success", () => {
  const failed = {
    status: "failed" as const,
    kind: "outage" as const,
    message: "Email provider rejected the message",
    attemptedAt: "2026-09-08T12:00:00.000Z",
  };
  const sent = {
    status: "sent" as const,
    kind: "outage" as const,
    message: "Outage notification delivered to support",
    attemptedAt: "2026-09-08T13:00:00.000Z",
  };
  assert.deepEqual(appendDomainNotificationDelivery([failed], sent), [failed, sent]);
});

test("notification delivery history is bounded to the latest 50 attempts", () => {
  const history = Array.from({ length: 50 }, (_, index) => ({
    status: "skipped" as const,
    kind: "outage" as const,
    message: `Attempt ${index}`,
    attemptedAt: new Date(index * 1000).toISOString(),
  }));
  const latest = {
    status: "sent" as const,
    kind: "recovery" as const,
    message: "Recovery notification delivered to support",
    attemptedAt: "2026-09-08T14:00:00.000Z",
  };
  const result = appendDomainNotificationDelivery(history, latest);
  assert.equal(result.length, 50);
  assert.equal(result[0].message, "Attempt 1");
  assert.deepEqual(result.at(-1), latest);
});

test("simultaneous main recovery and e-shop outage are both queued", () => {
  const createdAt = "2026-09-09T10:00:00.000Z";
  const queue = appendQueuedDomainNotifications([], [
    { id: "main-recovery", role: "main", kind: "recovery", hostname: "acme.globipos.shop", message: "Main recovered", createdAt },
    { id: "eshop-outage", role: "eshop", kind: "outage", hostname: "web-acme.globipos.shop", message: "E-shop failed", createdAt },
  ]);
  assert.deepEqual(queue.map(entry => [entry.role, entry.kind]), [
    ["main", "recovery"],
    ["eshop", "outage"],
  ]);
});

test("domain incidents are created and recovered only on status transitions", () => {
  assert.equal(domainIncidentTransition("connected", "failed"), "start");
  assert.equal(domainIncidentTransition("pending", "failed"), "start");
  assert.equal(domainIncidentTransition("failed", "failed"), "none");
  assert.equal(domainIncidentTransition("connected", "connected"), "recover");
  assert.equal(domainIncidentTransition("pending", "connected"), "recover");
  assert.equal(domainIncidentTransition("failed", "connected"), "recover");
});

test("CSV export cells preserve commas, quotes, and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("DNS, TLS"), '"DNS, TLS"');
  assert.equal(csvCell('bad "certificate"\nretry'), '"bad ""certificate""\nretry"');
  assert.equal(csvCell(null), "");
});

test("operator alert retries are exposed only through the superuser control route", () => {
  const source = readFileSync(new URL("./deployment-control.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /app\.post\("\/api\/control\/operator-alerts\/:operation\/retry", requireSuperuser,/,
  );
  assert.match(source, /z\.enum\(\["load", "save"\]\)\.safeParse\(req\.params\.operation\)/);
  assert.match(source, /OPERATOR_ALERT_RETRY_COOLDOWN/);
  assert.match(source, /OPERATOR_ALERT_RETRY_LEASE_CONFLICT/);
  assert.match(source, /Another operator or worker is already delivering this alert/);
});

test("authenticated operator alert retries distinguish cooldown, lease, and not-ready conflicts", async t => {
  const retryEligibleAt = new Date(Date.now() + 60_000);
  let failure: any = {
    alertKey: "customer_ai_health_persistence_failed:load",
    event: "customer_ai_health_persistence_failed",
    operation: "load",
    reason: "Delivery failed",
    occurrenceCount: 1,
    deliveryAttempts: 1,
    status: "failed",
    claimedAt: null,
    claimToken: null,
    nextAttemptAt: retryEligibleAt,
    firstFailedAt: new Date(),
    lastFailedAt: new Date(),
    resolvedAt: null,
    retryHistory: [],
  };
  const app = express();
  app.use(requireAuth);
  app.post("/api/control/operator-alerts/:operation/retry", requireSuperuser, retryOperatorAlert);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const token = signToken({
    id: crypto.randomUUID(),
    username: "alert-route-test",
    email: null,
    role: "superuser",
    permissions: [],
  });
  const requestRetry = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/control/operator-alerts/load/retry`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    return { response, body: await response.json() as Record<string, unknown> };
  };

  setCustomerAiPersistenceAlertClaimerForTests(async () => null);
  setOperatorAlertRetryLookupForTests(async () => failure);
  t.after(async () => {
    setCustomerAiPersistenceAlertClaimerForTests();
    setOperatorAlertRetryLookupForTests();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const cooldown = await requestRetry();
  assert.equal(cooldown.response.status, 409);
  assert.equal(cooldown.body.code, "OPERATOR_ALERT_RETRY_COOLDOWN");
  assert.equal(cooldown.body.retryEligibleAt, retryEligibleAt.toISOString());

  failure = { ...failure, status: "delivering", nextAttemptAt: null, resolvedAt: null };
  const lease = await requestRetry();
  assert.equal(lease.response.status, 409);
  assert.equal(lease.body.code, "OPERATOR_ALERT_RETRY_LEASE_CONFLICT");
  assert.equal(lease.body.message, "Another operator or worker is already delivering this alert. Try again shortly.");

  failure = { ...failure, status: "resolved", nextAttemptAt: null, resolvedAt: new Date() };
  const resolved = await requestRetry();
  assert.equal(resolved.response.status, 409);
  assert.equal(resolved.body.code, "OPERATOR_ALERT_RETRY_NOT_READY");

  failure = undefined;
  const missing = await requestRetry();
  assert.equal(missing.response.status, 409);
  assert.equal(missing.body.code, "OPERATOR_ALERT_RETRY_NOT_READY");
});

test("operator alert retry history keeps only sanitized recent outcomes", () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    attemptedAt: new Date(index * 1000).toISOString(),
    outcome: index % 2 === 0 ? "delivered" as const : "failed" as const,
    operator: { id: `user-${index}`, username: `operator-${index}` },
  }));
  const latest = {
    attemptedAt: "2026-09-08T14:00:00.000Z",
    outcome: "failed" as const,
    operator: { id: null, username: null },
  };
  const result = appendOperatorAlertRetryHistory(history, latest);
  assert.equal(result.length, 10);
  assert.equal(result[0].operator.username, "operator-1");
  assert.deepEqual(result.at(-1), latest);
  assert.deepEqual(Object.keys(result.at(-1)!).sort(), ["attemptedAt", "operator", "outcome"]);
});

test("resolved operator alerts expose only bounded retry outcomes and resolution time", () => {
  const alert = sanitizeResolvedOperatorAlert({
    operation: "save",
    resolvedAt: new Date("2026-09-08T14:05:00.000Z"),
    retryHistory: Array.from({ length: 12 }, (_, index) => ({
      attemptedAt: new Date(index * 1000).toISOString(),
      outcome: index === 11 ? "delivered" as const : "failed" as const,
      operator: { id: `secret-id-${index}`, username: `operator-${index}@example.com` },
    })),
  });
  assert.ok(alert);
  assert.equal(alert.retryHistory.length, 10);
  assert.deepEqual(Object.keys(alert).sort(), ["operation", "resolvedAt", "retryHistory"]);
  assert.deepEqual(Object.keys(alert.retryHistory[0]).sort(), ["attemptedAt", "outcome"]);
  assert.doesNotMatch(JSON.stringify(alert), /secret-id|@example\.com/);
});

test("resolved operator alert history is capped and protected by superuser access", () => {
  const source = readFileSync(new URL("./deployment-control.ts", import.meta.url), "utf8");
  assert.match(source, /\.where\(isNotNull\(operatorAlertFailures\.resolvedAt\)\)/);
  assert.match(source, /\.limit\(20\)/);
  assert.match(source, /app\.get\("\/api\/control\/status", requireSuperuser,/);
});

async function createDeployment(slug: string) {
  const [profile] = await db.insert(deploymentProfiles).values({
    slug,
    clientName: `Incident test ${slug}`,
    backOfficeUrl: `https://${slug}.example.com`,
    posServerUrl: `https://${slug}.example.com`,
    customerDomain: `${slug}.example.com`,
  }).returning();
  return profile;
}

test("database incident lifecycle keeps one open incident and closes it once", async t => {
  const slug = `incident-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });

  const startedAt = new Date("2026-09-08T10:00:00.000Z");
  await db.transaction(async tx => {
    await applyDomainIncidentTransition(tx, profile.id, "start", startedAt, "DNS failed");
    await applyDomainIncidentTransition(tx, profile.id, "start", new Date("2026-09-08T10:05:00.000Z"), "DNS still failed");
  });

  let incidents = await db.select().from(deploymentDomainIncidents)
    .where(eq(deploymentDomainIncidents.deploymentId, profile.id));
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].recoveredAt, null);
  assert.equal(incidents[0].reason, "DNS failed");

  // A routing edit resets readiness but must not manufacture a recovery.
  await db.update(deploymentProfiles).set({
    customerDomain: `${slug}-new.example.com`,
    domainStatus: "pending",
  }).where(eq(deploymentProfiles.id, profile.id));
  incidents = await db.select().from(deploymentDomainIncidents)
    .where(eq(deploymentDomainIncidents.deploymentId, profile.id));
  assert.equal(incidents[0].recoveredAt, null);

  const recoveredAt = new Date("2026-09-08T10:30:00.000Z");
  await applyDomainIncidentTransition(db, profile.id, "recover", recoveredAt, "Connected");
  await applyDomainIncidentTransition(db, profile.id, "recover", new Date("2026-09-08T11:00:00.000Z"), "Connected again");
  incidents = await db.select().from(deploymentDomainIncidents)
    .where(eq(deploymentDomainIncidents.deploymentId, profile.id));
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].recoveredAt?.toISOString(), recoveredAt.toISOString());
});

test("database rejects a storefront hostname reused by another deployment role", async t => {
  const ownerSlug = `eshop-owner-${crypto.randomUUID()}`;
  const collisionSlug = `eshop-collision-${crypto.randomUUID()}`;
  const storefront = customerEShopHostname(ownerSlug);
  const owner = await createDeployment(ownerSlug);
  await db.update(deploymentProfiles).set({ eShopDomain: storefront }).where(eq(deploymentProfiles.id, owner.id));
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, owner.id));
  });

  await assert.rejects(
    db.insert(deploymentProfiles).values({
      slug: collisionSlug,
      clientName: "Collision test",
      backOfficeUrl: `https://${storefront}`,
      posServerUrl: `https://${storefront}`,
      customerDomain: storefront.toUpperCase(),
    }),
    (error: any) => error?.cause?.code === "23505" || error?.code === "23505",
  );
});

test("existing deployments remain valid without an e-shop hostname", async t => {
  const slug = `no-eshop-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });
  assert.equal(profile.eShopDomain, null);
  assert.equal(profile.eShopDomainStatus, "pending");
});

test("activation rejects a failed e-shop check unless explicitly overridden", async t => {
  const slug = `eshop-activation-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  const checkedAt = new Date();
  await db.update(deploymentProfiles).set({
    enabledFeatures: ["customer-portal"],
    eShopDomain: customerEShopHostname(slug),
    domainStatus: "connected",
    domainCheckedAt: checkedAt,
    eShopDomainStatus: "failed",
    eShopDomainCheckedAt: checkedAt,
    eShopDomainMessage: "HTTPS failed",
  }).where(eq(deploymentProfiles.id, profile.id));
  const app = express();
  app.use(express.json());
  app.use(requireAuth);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  registerDeploymentControlRoutes(app);
  process.env.NODE_ENV = previousNodeEnv;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });
  const token = signToken({ id: crypto.randomUUID(), username: "superuser", email: null, role: "superuser", permissions: [] });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control/deployments/${profile.id}`;
  const patch = (body: unknown) => fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rejected = await patch({ status: "active" });
  const rejectionBody = await rejected.json();
  assert.equal(rejected.status, 409, JSON.stringify(rejectionBody));
  assert.equal(rejectionBody.code, "DOMAIN_NOT_READY");
  const overridden = await patch({ status: "active", overrideDomainWarning: true });
  assert.equal(overridden.status, 200);
});

test("main and e-shop outages retain independent incident lifecycles", async t => {
  const slug = `independent-incidents-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });
  const startedAt = new Date("2026-09-09T08:00:00.000Z");
  await applyDomainIncidentTransition(db, profile.id, "start", startedAt, "Main domain failed");
  await applyDomainIncidentTransition(db, profile.id, "start", startedAt, "E-shop failed", "eshop");
  await applyDomainIncidentTransition(db, profile.id, "recover", new Date("2026-09-09T08:10:00.000Z"), "Main recovered");

  const incidents = await db.select().from(deploymentDomainIncidents)
    .where(eq(deploymentDomainIncidents.deploymentId, profile.id));
  assert.equal(incidents.length, 2);
  assert.ok(incidents.find(incident => incident.role === "main")?.recoveredAt);
  assert.equal(incidents.find(incident => incident.role === "eshop")?.recoveredAt, null);
});

test("acknowledging one notification preserves a concurrently appended notification", async t => {
  const slug = `notification-race-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });
  const original = {
    id: crypto.randomUUID(),
    role: "main" as const,
    kind: "recovery" as const,
    hostname: `${slug}.example.com`,
    message: "Main recovered",
    createdAt: new Date().toISOString(),
  };
  const appended = {
    id: crypto.randomUUID(),
    role: "eshop" as const,
    kind: "outage" as const,
    hostname: customerEShopHostname(slug),
    message: "E-shop failed",
    createdAt: new Date().toISOString(),
  };
  await db.update(deploymentProfiles).set({ domainNotificationQueue: [original] })
    .where(eq(deploymentProfiles.id, profile.id));
  await db.update(deploymentProfiles).set({ domainNotificationQueue: [original, appended] })
    .where(eq(deploymentProfiles.id, profile.id));
  const result = await acknowledgeDomainNotification(profile.id, original.id, {
    domainNotificationDeliveryStatus: "sent",
  });
  assert.deepEqual(result.domainNotificationQueue, [appended]);
});

test("a slow check appends new notifications without restoring an acknowledged snapshot", async t => {
  const slug = `notification-enqueue-race-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });
  const acknowledged = {
    id: crypto.randomUUID(),
    role: "main" as const,
    kind: "recovery" as const,
    hostname: `${slug}.example.com`,
    message: "Main recovered",
    createdAt: new Date().toISOString(),
  };
  const newlyDetected = {
    id: crypto.randomUUID(),
    role: "eshop" as const,
    kind: "outage" as const,
    hostname: customerEShopHostname(slug),
    message: "E-shop failed",
    createdAt: new Date().toISOString(),
  };
  await db.update(deploymentProfiles).set({ domainNotificationQueue: [acknowledged] })
    .where(eq(deploymentProfiles.id, profile.id));
  await acknowledgeDomainNotification(profile.id, acknowledged.id, {
    domainNotificationDeliveryStatus: "sent",
  });
  const [updated] = await db.update(deploymentProfiles).set({
    domainNotificationQueue: appendDomainNotificationsValue([newlyDetected]),
  }).where(eq(deploymentProfiles.id, profile.id)).returning({
    domainNotificationQueue: deploymentProfiles.domainNotificationQueue,
  });
  assert.deepEqual(updated.domainNotificationQueue, [newlyDetected]);
});

test("deployment API grouping returns only the five newest incidents", async t => {
  const slug = `history-${crypto.randomUUID()}`;
  const profile = await createDeployment(slug);
  t.after(async () => {
    await db.delete(deploymentProfiles).where(eq(deploymentProfiles.id, profile.id));
  });
  for (let index = 0; index < 7; index++) {
    const startedAt = new Date(Date.UTC(2026, 8, 1, index));
    await db.insert(deploymentDomainIncidents).values({
      deploymentId: profile.id,
      startedAt,
      recoveredAt: new Date(startedAt.getTime() + 10 * 60_000),
      reason: `Failure ${index}`,
    });
  }

  const profiles = await loadDeploymentProfilesWithIncidents();
  const result = profiles.find((candidate: any) => candidate.id === profile.id);
  assert.ok(result);
  assert.deepEqual(result.domainIncidents.map((incident: any) => incident.reason), [
    "Failure 6", "Failure 5", "Failure 4", "Failure 3", "Failure 2",
  ]);
});

test("reconciliation migration restores former 0008 and 0009 collision states", async t => {
  const slug = `backfill-${crypto.randomUUID()}`;
  const client = await pool.connect();
  t.after(() => client.release());
  const reconciliation = readFileSync(
    new URL("../migrations/0010_deployment_domain_notification_delivery.sql", import.meta.url),
    "utf8",
  );
  await client.query("BEGIN");
  try {
    await client.query("DROP TABLE IF EXISTS deployment_domain_incidents");
    await client.query("DROP INDEX IF EXISTS portal_orders_customer_checkout_key_unique");
    await client.query("ALTER TABLE portal_orders DROP COLUMN IF EXISTS checkout_key");
    await client.query("DROP INDEX IF EXISTS customer_loyalty_points_source_unique");
    await client.query(`
      ALTER TABLE deployment_profiles
        ADD COLUMN IF NOT EXISTS domain_status text NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS domain_message text,
        ADD COLUMN IF NOT EXISTS domain_checked_at timestamp,
        ADD COLUMN IF NOT EXISTS domain_failure_started_at timestamp
    `);
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO deployment_profiles (
        slug, client_name, back_office_url, pos_server_url, customer_domain,
        domain_status, domain_message, domain_failure_started_at
      ) VALUES ($1, $2, $3, $3, $4, 'failed', 'HTTPS unavailable', $5)
      RETURNING id
    `, [
      slug,
      `Incident test ${slug}`,
      `https://${slug}.example.com`,
      `${slug}.example.com`,
      new Date("2026-09-08T09:00:00.000Z"),
    ]);
    await client.query(reconciliation);
    await client.query(reconciliation);
    const checkoutColumn = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'portal_orders' AND column_name = 'checkout_key'
    `);
    const checkoutIndexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE indexname IN (
        'portal_orders_customer_checkout_key_unique',
        'customer_loyalty_points_source_unique'
      )
    `);
    assert.equal(checkoutColumn.rowCount, 1);
    assert.equal(checkoutIndexes.rowCount, 2);
    const incidents = await client.query<{ started_at: Date; reason: string }>(`
      SELECT started_at, reason
      FROM deployment_domain_incidents
      WHERE deployment_id = $1
    `, [inserted.rows[0].id]);
    assert.equal(incidents.rowCount, 1);
    assert.equal(incidents.rows[0].started_at.toISOString(), "2026-09-08T09:00:00.000Z");
    assert.equal(incidents.rows[0].reason, "HTTPS unavailable");
  } finally {
    await client.query("ROLLBACK");
  }
});
