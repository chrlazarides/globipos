/**
 * Push Notifications — VAPID Key Rotation Round-Trip Test
 *
 * Context: usePushNotifications.ts (customer-app) always unsubscribes any
 * existing browser PushSubscription and removes its endpoint from the server
 * BEFORE creating a fresh subscription against the current VAPID public key.
 * This exists because a PushSubscription is cryptographically bound to the
 * VAPID key that was active at subscribe time — if the server rotates its
 * VAPID keypair, any subscription created under the old key silently stops
 * receiving pushes (webpush.sendNotification fails per-subscription and is
 * swallowed as non-fatal in sendPushToCustomer).
 *
 * This test exercises the SERVER side of that round trip end-to-end, since
 * that is exactly what would regress if the unsubscribe step were removed or
 * broken: the client can't be trusted alone, the server's push-subscription
 * table must actually reflect "old endpoint gone, new endpoint present".
 *
 * Every step asserts the ACTUAL row(s) in `customer_push_subscriptions` via a
 * direct DB query (not just the HTTP status code), because the DELETE route
 * is intentionally idempotent and always returns 200 even when zero rows are
 * removed — a status-code-only test would still pass if the unsubscribe step
 * silently regressed into a no-op.
 *
 * Flow under test (mirrors usePushNotifications.subscribe()):
 *   1. Simulate an existing subscription: POST /api/customer/push/subscribe
 *      with "endpoint A" (as if created under the OLD VAPID key).
 *   2. Simulate a VAPID key rotation happening server-side (conceptually —
 *      the client has no way to know the key changed except that its old
 *      subscription is now stale). The client calls subscribe() again which:
 *        a. DELETE /api/customer/push/subscribe with endpoint A (old)
 *        b. POST /api/customer/push/subscribe with "endpoint B" (new,
 *           as if created against the NEW VAPID key)
 *   3. Assert (via direct DB read) the server no longer stores endpoint A for
 *      this customer, and does store endpoint B — i.e. a push send after
 *      rotation would only ever hit the fresh, valid endpoint.
 *
 * Auth strategy: Bearer JWT signed with the same CUSTOMER_JWT_SECRET derivation
 * used by server/routes.ts (SESSION_SECRET + "_customer"), matching the pattern
 * used for admin/staff tokens in card-charge-idempotency.spec.ts.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { customerPushSubscriptions } from "../shared/schema";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const CUSTOMER_JWT_SECRET = (process.env.SESSION_SECRET || "fallback") + "_customer";

function generateAdminToken(): string {
  return jwt.sign(
    { id: "push-rotation-test-admin", username: "push_rotation_admin", email: "push_rotation_admin@test.local", role: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function generateCustomerToken(customerId: string, customerCode: string): string {
  return jwt.sign(
    { customerId, customerCode, type: "customer" },
    CUSTOMER_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function endpointRowsFor(customerId: string, endpoint: string) {
  return db.select().from(customerPushSubscriptions).where(
    and(eq(customerPushSubscriptions.customerId, customerId), eq(customerPushSubscriptions.endpoint, endpoint))
  );
}

interface Ctx {
  customerId: string;
  customerCode: string;
  token: string;
}

const ctx: Ctx = { customerId: "", customerCode: "", token: "" };

async function apiRaw(
  rc: APIRequestContext,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: object,
  token?: string
) {
  const opts: any = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ctx.token}`,
    },
  };
  if (body) opts.data = body;

  switch (method) {
    case "GET": return rc.get(`${BASE_URL}${path}`, opts);
    case "POST": return rc.post(`${BASE_URL}${path}`, opts);
    case "DELETE": return rc.delete(`${BASE_URL}${path}`, opts);
  }
}

const TS = Date.now();
const OLD_ENDPOINT = `https://fcm.googleapis.com/fcm/send/old-key-endpoint-${TS}`;
const NEW_ENDPOINT = `https://fcm.googleapis.com/fcm/send/new-key-endpoint-${TS}`;

test.describe.serial("Push Notifications — VAPID Key Rotation", () => {

  test("Setup: create a test customer and sign a customer JWT", async ({ request }) => {
    const adminToken = generateAdminToken();
    const res = await request.post(`${BASE_URL}/api/customers`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      data: {
        name: `Push Rotation Test Customer ${TS}`,
        paymentTerms: "cash",
      },
    });
    expect(res.status(), `customer created — ${await res.text()}`).toBeLessThan(300);
    const data = await res.json();
    ctx.customerId = data.id;
    ctx.customerCode = data.code;
    expect(ctx.customerId, "customer has id").toBeTruthy();

    ctx.token = generateCustomerToken(ctx.customerId, ctx.customerCode);

    // Sanity: no leftover rows from a prior failed run using the same TS-based endpoints
    expect((await endpointRowsFor(ctx.customerId, OLD_ENDPOINT)).length).toBe(0);
    expect((await endpointRowsFor(ctx.customerId, NEW_ENDPOINT)).length).toBe(0);
  });

  test("Step 1: subscribe with the OLD endpoint (simulates subscription made under the old VAPID key)", async ({ request }) => {
    const res = await apiRaw(request, "POST", "/api/customer/push/subscribe", {
      endpoint: OLD_ENDPOINT,
      keys: { p256dh: "old-p256dh-key", auth: "old-auth-secret" },
    });
    expect(res!.status(), `old subscription created — ${await res!.text()}`).toBe(200);

    // Real DB assertion: the row must actually exist for this customer+endpoint,
    // with the p256dh/auth keys that were sent.
    const rows = await endpointRowsFor(ctx.customerId, OLD_ENDPOINT);
    expect(rows.length, "exactly one row exists for OLD_ENDPOINT after subscribe").toBe(1);
    expect(rows[0].p256dh).toBe("old-p256dh-key");
    expect(rows[0].auth).toBe("old-auth-secret");
  });

  test("Step 2a: rotation begins — client unsubscribes the old endpoint (DELETE)", async ({ request }) => {
    const res = await apiRaw(request, "DELETE", "/api/customer/push/subscribe", {
      endpoint: OLD_ENDPOINT,
    });
    expect(res!.status(), `old subscription removed — ${await res!.text()}`).toBe(200);

    // Real DB assertion: the row for OLD_ENDPOINT must be GONE. This is the
    // assertion that would catch a regression where the unsubscribe step is
    // removed/broken and old, stale endpoints pile up in the DB.
    const rows = await endpointRowsFor(ctx.customerId, OLD_ENDPOINT);
    expect(rows.length, "OLD_ENDPOINT row must be deleted after DELETE").toBe(0);
  });

  test("Step 2b: client subscribes with the NEW endpoint (bound to the rotated VAPID key)", async ({ request }) => {
    const res = await apiRaw(request, "POST", "/api/customer/push/subscribe", {
      endpoint: NEW_ENDPOINT,
      keys: { p256dh: "new-p256dh-key", auth: "new-auth-secret" },
    });
    expect(res!.status(), `new subscription created — ${await res!.text()}`).toBe(200);

    const rows = await endpointRowsFor(ctx.customerId, NEW_ENDPOINT);
    expect(rows.length, "exactly one row exists for NEW_ENDPOINT after subscribe").toBe(1);
    expect(rows[0].p256dh).toBe("new-p256dh-key");
    expect(rows[0].auth).toBe("new-auth-secret");

    // Full round-trip assertion: after rotation the customer has ONLY the new
    // endpoint on file — the old one did not survive alongside it.
    const oldRows = await endpointRowsFor(ctx.customerId, OLD_ENDPOINT);
    expect(oldRows.length, "OLD_ENDPOINT must still be absent — rotation did not resurrect it").toBe(0);
  });

  test("Step 3: re-deleting the already-removed OLD endpoint is a safe no-op (state unaffected)", async ({ request }) => {
    // The DELETE route is scoped to (endpoint, customerId) and is idempotent —
    // deleting an already-gone endpoint must not error and must not touch
    // unrelated rows (e.g. the still-active NEW_ENDPOINT).
    const res = await apiRaw(request, "DELETE", "/api/customer/push/subscribe", {
      endpoint: OLD_ENDPOINT,
    });
    expect(res!.status(), `deleting already-removed endpoint is a safe no-op — ${await res!.text()}`).toBe(200);

    expect((await endpointRowsFor(ctx.customerId, OLD_ENDPOINT)).length).toBe(0);
    // NEW_ENDPOINT must be untouched by this idempotent delete of a different endpoint
    expect((await endpointRowsFor(ctx.customerId, NEW_ENDPOINT)).length, "unrelated NEW_ENDPOINT row must survive").toBe(1);
  });

  test("Step 4: a subscription cannot be deleted by a forged token for a different customerId", async ({ request }) => {
    // Regression guard for the DB query in DELETE /api/customer/push/subscribe:
    // it must filter by BOTH endpoint AND customerId, otherwise one customer
    // could delete another customer's subscription row by guessing/reusing an
    // endpoint string. We call DELETE for NEW_ENDPOINT using a token for an
    // unrelated (fake) customerId and confirm the real row is NOT removed.
    const otherToken = generateCustomerToken("00000000-0000-0000-0000-000000000000", "OTHER-CODE");
    const res = await apiRaw(request, "DELETE", "/api/customer/push/subscribe", { endpoint: NEW_ENDPOINT }, otherToken);
    expect(res!.status(), `delete request from unrelated customer completes (idempotent no-op) — ${await res!.text()}`).toBe(200);

    // Real DB assertion: NEW_ENDPOINT must still belong to ctx.customerId —
    // proving the cross-customer delete attempt did NOT remove the row.
    const rows = await endpointRowsFor(ctx.customerId, NEW_ENDPOINT);
    expect(rows.length, "NEW_ENDPOINT row must survive a cross-customer delete attempt").toBe(1);
  });

  test("Cleanup: remove NEW_ENDPOINT subscription and test customer", async ({ request }) => {
    const delRes = await apiRaw(request, "DELETE", "/api/customer/push/subscribe", { endpoint: NEW_ENDPOINT });
    expect(delRes!.status()).toBe(200);
    expect((await endpointRowsFor(ctx.customerId, NEW_ENDPOINT)).length, "NEW_ENDPOINT row removed by real owner").toBe(0);

    if (ctx.customerId) {
      const r = await request.delete(`${BASE_URL}/api/customers/${ctx.customerId}`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${generateAdminToken()}` },
      });
      expect([200, 204, 404]).toContain(r.status());
    }
  });
});
