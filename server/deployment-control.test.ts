import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyDomainIncidentTransition,
  appendDomainNotificationDelivery,
  csvCell,
  domainIncidentTransition,
  domainNotificationKind,
  isActiveDomainCheckDue,
  loadDeploymentProfilesWithIncidents,
  nextPendingDomainNotification,
  withDeadline,
} from "./deployment-control";
import { db, pool } from "./db";
import { deploymentDomainIncidents, deploymentProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";

const now = Date.parse("2026-09-08T12:00:00.000Z");

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
