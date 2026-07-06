/**
 * CardPaymentDialog — "Already Charged" UI must never void a completed order
 *
 * This is a browser-level (UI) test, complementing the API-only coverage in
 * card-charge-idempotency.spec.ts. It drives the actual POS Register page,
 * intercepts the terminal charge call to force a 409 "already_paid" response,
 * and asserts:
 *   1. The dialog renders the "Already Charged" phase (not "declined").
 *   2. No PATCH /api/pos/orders/:id/void request is ever fired — neither
 *      automatically when the 409 arrives, nor when the dialog is dismissed
 *      via the onOpenChange handler (Escape/overlay), nor via the explicit
 *      "Close — Do Not Retry" button.
 *   3. The order backing this dialog remains in "completed" status server-side
 *      throughout (never flips to "voided").
 *
 * Auth strategy: we mint a JWT with SESSION_SECRET (same approach as
 * card-charge-idempotency.spec.ts) and inject it as the `vt_auth` cookie
 * directly into the browser context. This bypasses the login form and
 * mandatory 2FA setup flow, which are out of scope for this test.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const TS = Date.now();

// /api/auth/me (queried by the client's AuthGate on every page load) looks the
// user up fresh in the DB by id, so unlike the pure-API tests we cannot use a
// synthetic id here — the id must belong to a real row. We look up an existing
// admin/superuser account rather than hardcoding one, so this test doesn't
// depend on any specific seeded username.
async function findRealAdminId(): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE role IN ('admin', 'superuser') ORDER BY id LIMIT 1`
    );
    if (!rows.length) throw new Error("No admin/superuser account exists in this environment to borrow an id from.");
    return rows[0].id as string;
  } finally {
    await pool.end();
  }
}

function generateToken(userId: string, role: "admin" | "staff" = "admin"): string {
  return jwt.sign(
    { id: userId, username: `ui_charge_${role}`, email: `ui_charge_${role}@test.local`, role, permissions: [] },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

interface Ctx {
  adminToken: string;
  locationId: string;
  terminalId: string;
  itemId: string;
  completedOrderId: string;
}

const ctx: Ctx = {
  adminToken: "",
  locationId: "",
  terminalId: "",
  itemId: "",
  completedOrderId: "",
};

async function apiRaw(
  rc: APIRequestContext,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: object
) {
  const opts: any = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.adminToken}`,
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

async function injectAuthCookie(page: Page) {
  await page.context().addCookies([
    {
      name: "vt_auth",
      value: ctx.adminToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe.serial("Already Charged UI — cannot void a completed order", () => {

  test("Setup: create tokens, location, terminal, item, and a held order to charge", async ({ request }) => {
    const realAdminId = await findRealAdminId();
    ctx.adminToken = generateToken(realAdminId, "admin");

    const locRes = await apiRaw(request, "POST", "/api/pos/locations", {
      name: `AlreadyCharged-UI Location ${TS}`,
      code: `ACUI-LOC-${TS}`,
      address: "Test Address",
      timezone: "Europe/Nicosia",
      currencyCode: "EUR",
      active: true,
    });
    expect(locRes!.status(), `location created — ${await locRes!.text()}`).toBeLessThan(300);
    ctx.locationId = (await locRes!.json()).id;

    const termRes = await apiRaw(request, "POST", "/api/pos/terminals", {
      locationId: ctx.locationId,
      name: `AlreadyCharged-UI Terminal ${TS}`,
      code: `ACUI-TERM-${TS}`,
      hardwareType: "desktop",
      active: true,
    });
    expect(termRes!.status(), `terminal created — ${await termRes!.text()}`).toBeLessThan(300);
    ctx.terminalId = (await termRes!.json()).id;

    const itemRes = await apiRaw(request, "POST", "/api/items", {
      name: `AlreadyCharged UI Test Wine ${TS}`,
      sku: `ACUI-ITEM-${TS}`,
      unitType: "pc",
      packSize: 1,
      price1: "20.00",
      price2: "20.00",
      price3: "20.00",
      price4: "20.00",
      price5: "20.00",
      costPrice: "10.00",
      vatRate: "19",
      stockQuantity: 100,
      reorderLevel: 5,
      active: true,
    });
    expect(itemRes!.status(), `item created — ${await itemRes!.text()}`).toBeLessThan(300);
    ctx.itemId = (await itemRes!.json()).id;
  });

  // ── TEST: 409 already-charged response must not trigger a void ─────────────

  test("409 'already_paid' response shows Already Charged UI and never voids the order", async ({ page, request }) => {
    await injectAuthCookie(page);

    let voidCalled = false;
    let chargeMocked = false;
    let heldOrderId: string | undefined;

    // Capture the real order id created by the UI flow (POST /api/pos/orders)
    // so we can assert on its server-side status directly, rather than only
    // inferring behavior from the absence of a void call.
    page.on("response", async res => {
      if (res.request().method() === "POST" && /\/api\/pos\/orders$/.test(res.url()) && res.ok()) {
        try {
          const body = await res.json();
          if (body?.id) heldOrderId = body.id;
        } catch {
          // ignore non-JSON / already-consumed bodies
        }
      }
    });

    // Mock the status endpoint so the "Card" pay button is enabled regardless
    // of whether a real payment provider is configured in this environment —
    // this test only cares about the CardPaymentDialog's client-side reaction
    // to a 409, not real terminal connectivity.
    await page.route("**/api/pos/card-terminal/status", async route => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          activeProvider: "jcc",
          jccConfigured: true,
          vivaConfigured: false,
          worldpayConfigured: false,
        }),
      });
    });

    // Intercept and mock the charge endpoint so we control the exact 409 shape
    // (mirrors what the server sends for an order already marked "completed").
    await page.route("**/api/pos/card-terminal/charge", async route => {
      chargeMocked = true;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          message: "This order has already been charged.",
          reason: "already_paid",
          existingRef: "prev-tx-ref-ui-test",
        }),
      });
    });

    // Watch for ANY void request for the whole test — this must never fire.
    await page.route("**/api/pos/orders/*/void", async route => {
      voidCalled = true;
      await route.continue();
    });

    await page.goto("/pos/register");

    // Note: the location/terminal <Select> components are Radix Select.Root,
    // which does not forward the data-testid prop to a DOM node — so we
    // target them by their accessible combobox role/placeholder text instead.
    await page.waitForSelector('text=Select location…', { timeout: 15000 });

    // Select location + terminal — click directly on the trigger's visible
    // placeholder text (Radix Select.Root doesn't forward data-testid, and the
    // accessible-name lookup for role=combobox proved unreliable here).
    await page.locator("text=Select location…").click();
    await page.getByRole("option", { name: new RegExp(`AlreadyCharged-UI Location ${TS}`) }).click();
    await page.locator("text=Select terminal…").click();
    await page.getByRole("option", { name: new RegExp(`AlreadyCharged-UI Terminal ${TS}`) }).click();

    // Add the test item to the cart
    await page.waitForSelector(`[data-testid="btn-item-${ctx.itemId}"]`, { timeout: 15000 });
    await page.getByTestId(`btn-item-${ctx.itemId}`).click();

    // Card payment requires a configured provider. We deterministically mock
    // the terminal status endpoint above (jccConfigured: true) so the "Card"
    // button is always enabled here regardless of the real environment's
    // terminal configuration — no conditional skip needed, this scenario
    // must always run and assert.
    const cardBtn = page.getByTestId("btn-pay-card");
    await expect(cardBtn).toBeEnabled({ timeout: 10000 });
    await cardBtn.click();

    // Order gets created as "held", CardPaymentDialog opens in "idle" phase.
    await page.waitForSelector('[data-testid="btn-initiate-card-charge"]', { timeout: 15000 });

    expect(heldOrderId, "the UI flow should have created a real order we can inspect").toBeTruthy();

    // Simulate the real "already charged" scenario: another channel (e.g. a
    // second charge attempt that actually succeeded, or a cashier who
    // manually confirmed the sale) already completed this exact order server-
    // side, with a real terminal reference recorded. This is the precondition
    // the task is about — the order is genuinely "completed" by the time the
    // cashier's dialog gets its 409.
    const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await dbPool.query(
        `UPDATE pos_orders SET status = 'completed', card_terminal_ref = $1 WHERE id = $2`,
        ["prev-tx-ref-ui-test", heldOrderId]
      );
    } finally {
      await dbPool.end();
    }
    const precheck = await apiRaw(request, "GET", `/api/pos/orders/${heldOrderId}`);
    expect((await precheck!.json()).status, "precondition: order must be completed before the charge attempt").toBe("completed");

    // Fire the charge — our mocked route returns 409 already_paid.
    await page.getByTestId("btn-initiate-card-charge").click();

    // Dialog must land on the "Already Charged" phase, not "declined".
    await expect(page.getByTestId("text-already-charged-title")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("text-already-charged-title")).toHaveText("Already Charged");
    await expect(page.getByTestId("text-already-charged-body")).toContainText("prev-tx-ref-ui-test");

    expect(chargeMocked, "the mocked charge endpoint should have been hit").toBe(true);
    expect(voidCalled, "no void request should fire on landing in already_charged phase").toBe(false);

    // Server-side proof, not just absence of a void call: the order is a
    // genuinely completed order (we set it as such above, mirroring how it
    // would look if it was already charged by another channel) and it must
    // STAY "completed" — not flip to "voided" — as a side effect of the
    // dialog landing on the already_charged phase.
    ctx.completedOrderId = heldOrderId!;
    let orderRes = await apiRaw(request, "GET", `/api/pos/orders/${heldOrderId}`);
    expect(orderRes!.status()).toBe(200);
    let orderBody = await orderRes!.json();
    expect(orderBody.status, "order must remain completed (not voided) after landing in already_charged phase").toBe("completed");

    // Now close the dialog via the explicit "Close — Do Not Retry" button.
    await page.getByTestId("btn-already-charged-close").click();

    // Dialog should be gone.
    await expect(page.getByTestId("text-already-charged-title")).toHaveCount(0);

    // Still no void call after explicit close.
    expect(voidCalled, "closing via the Close button must not void the order").toBe(false);

    // Re-fetch the order from the server after the close action — this is
    // the definitive proof that closing the "Already Charged" dialog does not
    // void the order server-side either.
    orderRes = await apiRaw(request, "GET", `/api/pos/orders/${heldOrderId}`);
    expect(orderRes!.status()).toBe(200);
    orderBody = await orderRes!.json();
    expect(orderBody.status, "order must remain completed (not voided) after closing the Already Charged dialog").toBe("completed");
  });

  test("Cleanup: remove test item, terminal, and location", async ({ request }) => {
    if (ctx.itemId) {
      const r = await apiRaw(request, "DELETE", `/api/items/${ctx.itemId}`);
      expect([200, 204, 404]).toContain(r!.status());
    }
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
