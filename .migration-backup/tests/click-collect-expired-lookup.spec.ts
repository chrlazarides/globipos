import { expect, test, type APIRequestContext } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  customers,
  portalOrderItems,
  portalOrders,
  posInbox,
  posLocations,
  posTerminals,
} from "../shared/schema";

const BASE_URL = "http://localhost:5000";
const RUN = Date.now().toString(36);
const DISPLAY_PREFIX = `${RUN.slice(-6).padStart(6, "0")}a1`.slice(0, 8);
const AMBIGUOUS_PREFIX = `${RUN.slice(-6).padStart(6, "0")}b2`.slice(0, 8);
const terminalCode = `CC-LOOKUP-${RUN}`;
const locationId = `cc-location-${RUN}`;
const terminalId = `cc-terminal-${RUN}`;
const customerId = `cc-customer-${RUN}`;
const orderId = `${DISPLAY_PREFIX}-0000-4000-8000-000000000001`;
const ambiguousOrderIds = [
  `${AMBIGUOUS_PREFIX}-0000-4000-8000-000000000001`,
  `${AMBIGUOUS_PREFIX}-0000-4000-8000-000000000002`,
];
const allOrderIds = [orderId, ...ambiguousOrderIds];

function terminalRequest(request: APIRequestContext, path: string, method: "get" | "post" = "get") {
  return request[method](`${BASE_URL}${path}`, {
    headers: { "X-Terminal-Code": terminalCode },
  });
}

test.describe.serial("Expired Click & Collect manual lookup", () => {
  test.beforeAll(async () => {
    await db.insert(customers).values({
      id: customerId,
      name: `Click Collect Customer ${RUN}`,
      code: `CC-${RUN}`,
      email: `click-collect-${RUN}@test.local`,
    });
    await db.insert(posLocations).values({
      id: locationId,
      name: `Click Collect Location ${RUN}`,
      code: `CC-LOC-${RUN}`,
    });
    await db.insert(posTerminals).values({
      id: terminalId,
      locationId,
      name: `Click Collect Terminal ${RUN}`,
      code: terminalCode,
      active: true,
    });
    await db.insert(portalOrders).values([
      {
        id: orderId,
        customerId,
        status: "pending",
        source: "portal",
        subtotal: "18.50",
        vatAmount: "3.52",
        total: "22.02",
      },
      ...ambiguousOrderIds.map((id) => ({
        id,
        customerId,
        status: "pending",
        source: "portal",
        subtotal: "1.00",
        vatAmount: "0.19",
        total: "1.19",
      })),
    ]);
    await db.insert(portalOrderItems).values([
      {
        orderId,
        itemId: `cc-item-1-${RUN}`,
        itemName: "Reserve Red",
        quantity: 2,
        unitPrice: "7.25",
        total: "14.50",
      },
      {
        orderId,
        itemId: `cc-item-2-${RUN}`,
        itemName: "Sparkling Water",
        quantity: 4,
        unitPrice: "1.00",
        total: "4.00",
      },
    ]);
  });

  test.afterAll(async () => {
    await db.delete(posInbox).where(eq(posInbox.terminalId, terminalId));
    await db.delete(portalOrderItems).where(inArray(portalOrderItems.orderId, allOrderIds));
    await db.delete(portalOrders).where(inArray(portalOrders.id, allOrderIds));
    await db.delete(posTerminals).where(eq(posTerminals.id, terminalId));
    await db.delete(posLocations).where(eq(posLocations.id, locationId));
    await db.delete(customers).where(eq(customers.id, customerId));
  });

  test("finds the portal order by its displayed eight-character number without an inbox item", async ({ request }) => {
    const inboxRows = await db.select().from(posInbox).where(eq(posInbox.terminalId, terminalId));
    expect(inboxRows, "the fallback must not depend on a usable terminal inbox notification").toEqual([]);

    const response = await terminalRequest(request, `/api/orders/${DISPLAY_PREFIX.toUpperCase()}`);
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      id: orderId,
      order_number: DISPLAY_PREFIX.toUpperCase(),
      customer_name: `Click Collect Customer ${RUN}`,
      status: "pending",
      lines: [
        {
          product_id: `cc-item-1-${RUN}`,
          description: "Reserve Red",
          qty: 2,
          unit_price: 7.25,
          line_total: 14.5,
        },
        {
          product_id: `cc-item-2-${RUN}`,
          description: "Sparkling Water",
          qty: 4,
          unit_price: 1,
          line_total: 4,
        },
      ],
    });
  });

  test("collecting the fallback result completes the portal order", async ({ request }) => {
    const response = await terminalRequest(
      request,
      `/api/orders/${DISPLAY_PREFIX.toUpperCase()}/collect`,
      "post",
    );
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      order: { id: orderId, status: "completed" },
    });

    const [stored] = await db.select().from(portalOrders).where(eq(portalOrders.id, orderId));
    expect(stored.status).toBe("completed");
  });

  test("rejects an already-collected order", async ({ request }) => {
    const response = await terminalRequest(request, `/api/orders/${DISPLAY_PREFIX}/collect`, "post");
    expect(response.status()).toBe(409);
    expect((await response.json()).message).toMatch(/already.*collected/i);
  });

  test("returns not found for a missing order number", async ({ request }) => {
    const response = await terminalRequest(request, "/api/orders/zzzzzzzz");
    expect(response.status()).toBe(404);
    expect((await response.json()).message).toMatch(/not found/i);
  });

  test("rejects an ambiguous order-number prefix", async ({ request }) => {
    const lookup = await terminalRequest(request, `/api/orders/${AMBIGUOUS_PREFIX}`);
    expect(lookup.status()).toBe(409);
    expect((await lookup.json()).message).toMatch(/ambiguous/i);

    const collect = await terminalRequest(request, `/api/orders/${AMBIGUOUS_PREFIX}/collect`, "post");
    expect(collect.status()).toBe(409);
    expect((await collect.json()).message).toMatch(/ambiguous/i);
  });
});