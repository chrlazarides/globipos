/**
 * Card-Terminal Charge — Duplicate-Charge Prevention Tests
 *
 * Verifies two independent guards that stop a cashier from accidentally
 * double-charging a customer after a timeout:
 *
 * Guard 1 — Idempotency key in-flight tracker (server/routes.ts, chargeInflightKeys Set)
 *   Two concurrent POST /api/pos/card-terminal/charge requests carrying the
 *   same idempotency key are fired simultaneously via Promise.all. Because
 *   Node.js is single-threaded, the first request adds the key to the Set
 *   before its first `await`; the second request then sees the key already
 *   present and receives HTTP 409.
 *
 * Guard 2 — Pre-charge order status guard
 *   If an order is already in a non-"held" state (e.g. "completed"), the
 *   endpoint rejects the charge with HTTP 409 *before* touching the payment
 *   provider, so no real terminal call is wasted.
 *   This also verifies the 409 response body surfaces a human-readable
 *   message that the UI can present to the cashier.
 *
 * Auth strategy: Bearer JWT (same pattern as accounting-audit.spec.ts).
 * No real payment terminal is required — the tests exercise server-side
 * logic only.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import jwt from "jsonwebtoken";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";

function generateToken(role: "admin" | "staff" = "admin"): string {
  return jwt.sign(
    { id: `charge-test-${role}`, username: `charge_${role}`, email: `charge_${role}@test.local`, role },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

interface Ctx {
  adminToken: string;
  staffToken: string;
  locationId: string;
  terminalId: string;
  completedOrderId: string;
  heldOrderId: string;
}

const ctx: Ctx = {
  adminToken: "",
  staffToken: "",
  locationId: "",
  terminalId: "",
  completedOrderId: "",
  heldOrderId: "",
};

async function apiRaw(
  rc: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: object,
  token?: string
) {
  const opts: any = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ctx.adminToken}`,
    },
  };
  if (body) opts.data = body;

  switch (method) {
    case "GET":    return rc.get(`${BASE_URL}${path}`, opts);
    case "POST":   return rc.post(`${BASE_URL}${path}`, opts);
    case "PATCH":  return rc.patch(`${BASE_URL}${path}`, opts);
    case "DELETE": return rc.delete(`${BASE_URL}${path}`, opts);
  }
}

const TS = Date.now();

test.describe.serial("Card Terminal — Duplicate Charge Prevention", () => {

  // ── SETUP ────────────────────────────────────────────────────────────────────

  test("Setup: create tokens, location, terminal, and test orders", async ({ request }) => {
    ctx.adminToken = generateToken("admin");
    ctx.staffToken = generateToken("staff");

    // Create a POS location
    const locRes = await apiRaw(request, "POST", "/api/pos/locations", {
      name: `Charge-Test Location ${TS}`,
      code: `CTEST-LOC-${TS}`,
      address: "Test Address",
      timezone: "Europe/Nicosia",
      currencyCode: "EUR",
      active: true,
    });
    expect(locRes!.status(), `location created — ${await locRes!.text()}`).toBeLessThan(300);
    const locData = await locRes!.json();
    ctx.locationId = locData.id;
    expect(ctx.locationId, "location has id").toBeTruthy();

    // Create a POS terminal in that location
    const termRes = await apiRaw(request, "POST", "/api/pos/terminals", {
      locationId: ctx.locationId,
      name: `Charge-Test Terminal ${TS}`,
      code: `CTEST-TERM-${TS}`,
      hardwareType: "desktop",
      active: true,
    });
    expect(termRes!.status(), `terminal created — ${await termRes!.text()}`).toBeLessThan(300);
    const termData = await termRes!.json();
    ctx.terminalId = termData.id;
    expect(ctx.terminalId, "terminal has id").toBeTruthy();

    // Create an order with status "completed" to simulate an already-paid order
    const completedRes = await apiRaw(request, "POST", "/api/pos/orders", {
      orderNumber: `CTEST-COMPLETED-${TS}`,
      terminalId: ctx.terminalId,
      locationId: ctx.locationId,
      status: "completed",
      paymentMethod: "card",
      subtotal: "50.00",
      discountAmount: "0.00",
      vatAmount: "9.50",
      total: "59.50",
      amountTendered: "59.50",
      changeDue: "0.00",
      cardTerminalRef: "prev-tx-ref",
    });
    expect(completedRes!.status(), `completed order created — ${await completedRes!.text()}`).toBeLessThan(300);
    const completedData = await completedRes!.json();
    ctx.completedOrderId = completedData.id;
    expect(ctx.completedOrderId, "completed order has id").toBeTruthy();

    // Create an order with status "held" for the concurrent idempotency test
    const heldRes = await apiRaw(request, "POST", "/api/pos/orders", {
      orderNumber: `CTEST-HELD-${TS}`,
      terminalId: ctx.terminalId,
      locationId: ctx.locationId,
      status: "held",
      paymentMethod: "card",
      subtotal: "75.00",
      discountAmount: "0.00",
      vatAmount: "14.25",
      total: "89.25",
      amountTendered: "0.00",
      changeDue: "0.00",
    });
    expect(heldRes!.status(), `held order created — ${await heldRes!.text()}`).toBeLessThan(300);
    const heldData = await heldRes!.json();
    ctx.heldOrderId = heldData.id;
    expect(ctx.heldOrderId, "held order has id").toBeTruthy();
  });

  // ── TEST 1: Idempotency key in-flight deduplication ──────────────────────────
  //
  // Fires two charge requests with the SAME idempotency key simultaneously.
  // Because Node.js is single-threaded, the first request sets the key in
  // `chargeInflightKeys` (synchronously, before its first DB await) and the
  // second request then sees it and receives 409. Only one charge attempt fires.

  test("Guard 1: two concurrent requests with same idempotency key → only one proceeds, second gets 409", async ({ request }) => {
    const sharedKey = `idem-test-${TS}-${Math.random().toString(36).slice(2)}`;

    // Both requests carry the same idempotency key. We fire them simultaneously.
    // Playwright's parallel fetch is sufficient — the Node.js event loop ensures
    // the first handler runs synchronously (adding key to Set) before the second
    // handler starts, so the second sees the key and is rejected.
    const [r1, r2] = await Promise.all([
      request.post(`${BASE_URL}/api/pos/card-terminal/charge`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.staffToken}`,
        },
        data: {
          amount: 89.25,
          orderId: ctx.heldOrderId,
          currency: "EUR",
          idempotencyKey: sharedKey,
        },
      }),
      request.post(`${BASE_URL}/api/pos/card-terminal/charge`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ctx.staffToken}`,
        },
        data: {
          amount: 89.25,
          orderId: ctx.heldOrderId,
          currency: "EUR",
          idempotencyKey: sharedKey,
        },
      }),
    ]);

    const statuses = [r1.status(), r2.status()].sort();
    const bodies = await Promise.all([r1.json(), r2.json()]);

    // Exactly one response must be 409 (the duplicate was blocked)
    const conflictResponses = [r1.status(), r2.status()].filter(s => s === 409);
    expect(
      conflictResponses.length,
      `Expected exactly one 409 (duplicate blocked). Statuses: ${statuses.join(", ")}. Bodies: ${JSON.stringify(bodies)}`
    ).toBe(1);

    // The 409 body must contain a human-readable message
    const conflictBody = bodies.find((b: any) => b.success === false && /already in progress|duplicate/i.test(b.message || ""));
    expect(
      conflictBody,
      `409 response should have a descriptive message. Bodies: ${JSON.stringify(bodies)}`
    ).toBeTruthy();

    // The non-409 response is allowed to be any non-409 status
    // (400 for no provider, 404, etc.) — but NOT 409 itself
    const nonConflictStatus = statuses.find(s => s !== 409);
    expect(nonConflictStatus, "the non-blocked request should NOT be a 409").not.toBe(409);
  });

  // ── TEST 2: Pre-charge order status guard → 409 before provider is called ────
  //
  // A charge is attempted on an order whose status is already "completed".
  // The server rejects the request *before* calling any payment provider
  // and surfaces a meaningful 409 response that the UI can display to the cashier.

  test("Guard 2: charge against already-completed order returns 409 with descriptive message", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/pos/card-terminal/charge`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.staffToken}`,
      },
      data: {
        amount: 59.50,
        orderId: ctx.completedOrderId,
        currency: "EUR",
        idempotencyKey: `idem-guard2-${TS}`,
      },
    });

    expect(res.status(), "pre-charge status guard should return 409").toBe(409);

    const body = await res.json();
    expect(body.success, "response body success should be false").toBe(false);
    expect(
      body.message,
      "response body should have a non-empty message"
    ).toBeTruthy();
    expect(
      /completed|duplicate|already/i.test(body.message),
      `message should mention the order state or duplicate prevention. Got: "${body.message}"`
    ).toBe(true);
  });

  // ── TEST 3: Held order can still be charged (guard does not over-block) ───────
  //
  // Confirms the pre-charge guard correctly passes through a "held" order.
  // The charge will fail at the provider step (no provider configured in test
  // env) but it must NOT return 409 from the order-status guard.

  test("Guard 2 (negative): held order is not blocked by status guard", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/pos/card-terminal/charge`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.staffToken}`,
      },
      data: {
        amount: 89.25,
        orderId: ctx.heldOrderId,
        currency: "EUR",
        idempotencyKey: `idem-guard3-${TS}`,
      },
    });

    // Must NOT be 409 — a held order is eligible for charging
    expect(
      res.status(),
      "held order should not be blocked by status guard (409 would be wrong)"
    ).not.toBe(409);

    const body = await res.json();
    // In test env there is no payment provider, so we expect a 400/provider error,
    // NOT a duplicate-charge error
    const isProviderError =
      res.status() === 400 ||
      (body.message && /provider|configured|terminal/i.test(body.message));
    expect(
      isProviderError,
      `Expected a provider-not-configured error for held order. Status: ${res.status()}, body: ${JSON.stringify(body)}`
    ).toBe(true);
  });

  // ── TEST 4: 409 message surfaces properly (not swallowed silently) ────────────
  //
  // Verifies that when the backend returns 409, the response JSON body contains
  // the fields the frontend CardPaymentDialog reads (success: false, message: string).
  // This ensures the cashier sees a clear "already charged" message rather than
  // a silent failure.

  test("Guard 2 (UI contract): 409 response body matches CardPaymentDialog expected shape", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/pos/card-terminal/charge`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.staffToken}`,
      },
      data: {
        amount: 59.50,
        orderId: ctx.completedOrderId,
        currency: "EUR",
        idempotencyKey: `idem-uicontract-${TS}`,
      },
    });

    expect(res.status()).toBe(409);

    const body = await res.json();

    // CardPaymentDialog reads `data.success` and `data.message`
    expect(typeof body.success, "body.success must be boolean").toBe("boolean");
    expect(body.success, "body.success must be false for 409").toBe(false);
    expect(typeof body.message, "body.message must be a string").toBe("string");
    expect(body.message.length, "body.message must be non-empty").toBeGreaterThan(0);

    // The apiRequest helper in queryClient.ts reads json.message on error — confirm
    // it is present so throwIfResNotOk surfaces the right text to the toast
    expect(
      body.message,
      "body.message should describe the duplication scenario"
    ).toMatch(/completed|duplicate|already/i);
  });

  // ── CLEANUP ───────────────────────────────────────────────────────────────────

  test("Cleanup: remove test terminal and location", async ({ request }) => {
    if (ctx.terminalId) {
      const r = await apiRaw(request, "DELETE", `/api/pos/terminals/${ctx.terminalId}`);
      expect([200, 204, 404]).toContain(r!.status());
    }
    if (ctx.locationId) {
      const r = await apiRaw(request, "DELETE", `/api/pos/locations/${ctx.locationId}`);
      expect([200, 204, 404]).toContain(r!.status());
    }
  });
});
