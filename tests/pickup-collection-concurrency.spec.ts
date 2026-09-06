import { expect, test, type APIRequestContext } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../server/db";
import {
  customers,
  portalOrders,
  posLocations,
  posTerminals,
} from "../shared/schema";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const RUN_ID = Date.now();

const ctx = {
  token: "",
  terminalCodes: [`PICKUP-A-${RUN_ID}`, `PICKUP-B-${RUN_ID}`],
  customerId: "",
  locationId: "",
  terminalIds: [] as string[],
  eligibleOrderId: "",
  ineligibleOrderId: "",
  completedOrderId: "",
};

function adminToken(): string {
  return jwt.sign(
    {
      id: `pickup-test-${RUN_ID}`,
      username: "pickup_test",
      email: "pickup@test.local",
      role: "admin",
      permissions: [],
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

async function adminRequest(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: object,
) {
  const options = {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "Content-Type": "application/json",
    },
    data,
  };

  if (method === "GET") return request.get(`${BASE_URL}${path}`, options);
  if (method === "PATCH") return request.patch(`${BASE_URL}${path}`, options);
  return request.post(`${BASE_URL}${path}`, options);
}

async function collect(
  request: APIRequestContext,
  orderId: string,
  terminalCode: string,
) {
  return request.post(`${BASE_URL}/api/orders/${orderId}/collect`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "X-Terminal-Code": terminalCode,
      "Content-Type": "application/json",
    },
  });
}

test.describe.serial("Click & Collect atomic pickup claim", () => {
  test.afterAll(async () => {
    const orderIds = [
      ctx.eligibleOrderId,
      ctx.ineligibleOrderId,
      ctx.completedOrderId,
    ].filter(Boolean);
    if (orderIds.length) {
      await db.delete(portalOrders).where(inArray(portalOrders.id, orderIds));
    }
    if (ctx.terminalIds.length) {
      await db.delete(posTerminals).where(inArray(posTerminals.id, ctx.terminalIds));
    }
    if (ctx.locationId) {
      await db.delete(posLocations).where(eq(posLocations.id, ctx.locationId));
    }
    if (ctx.customerId) {
      await db.delete(customers).where(eq(customers.id, ctx.customerId));
    }
  });

  test("setup eligible, ineligible, and completed pickup orders", async ({ request }) => {
    ctx.token = adminToken();

    const [customer] = await db.insert(customers).values({
      name: `Pickup Test Customer ${RUN_ID}`,
      code: `PICKUP-CUST-${RUN_ID}`,
      active: true,
    }).returning({ id: customers.id });
    ctx.customerId = customer.id;

    const [location] = await db.insert(posLocations).values({
      name: `Pickup Test Location ${RUN_ID}`,
      code: `PICKUP-LOC-${RUN_ID}`,
      active: true,
    }).returning();
    ctx.locationId = location.id;

    const terminals = await db.insert(posTerminals).values(
      ctx.terminalCodes.map((code, index) => ({
        locationId: location.id,
        name: `Pickup Test Till ${index + 1} ${RUN_ID}`,
        code,
        active: true,
      })),
    ).returning({ id: posTerminals.id });
    ctx.terminalIds = terminals.map((terminal) => terminal.id);

    const orders = await db.insert(portalOrders).values([
      {
        customerId: customer.id,
        status: "pending",
        notes: `Eligible pickup concurrency test ${RUN_ID}`,
      },
      {
        customerId: customer.id,
        status: "rejected",
        notes: `Ineligible pickup concurrency test ${RUN_ID}`,
      },
      {
        customerId: customer.id,
        status: "completed",
        notes: `Completed pickup concurrency test ${RUN_ID}`,
      },
    ]).returning({ id: portalOrders.id, status: portalOrders.status });
    ctx.eligibleOrderId = orders.find((order) => order.status === "pending")!.id;
    ctx.ineligibleOrderId = orders.find((order) => order.status === "rejected")!.id;
    ctx.completedOrderId = orders.find((order) => order.status === "completed")!.id;
  });

  test("two tills requests for one pending pickup produce one success and one conflict", async ({ request }) => {
    const [first, second] = await Promise.all([
      collect(request, ctx.eligibleOrderId, ctx.terminalCodes[0]),
      collect(request, ctx.eligibleOrderId, ctx.terminalCodes[1]),
    ]);
    const responses = [first, second];
    const statuses = responses.map((response) => response.status()).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const conflict = responses.find((response) => response.status() === 409)!;
    await expect(conflict.json()).resolves.toMatchObject({
      message: "This order has already been collected.",
    });

    const ordersResponse = await adminRequest(
      request,
      "GET",
      "/api/admin/portal-orders",
    );
    expect(ordersResponse.status()).toBe(200);
    const orders = await ordersResponse.json();
    expect(orders.find((order: any) => order.id === ctx.eligibleOrderId)?.status).toBe("completed");
  });

  test("an ineligible pickup remains a conflict", async ({ request }) => {
    const response = await collect(request, ctx.ineligibleOrderId, ctx.terminalCodes[0]);
    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: "This order is not eligible for collection.",
    });
  });

  test("an already-completed pickup remains an already-collected conflict", async ({ request }) => {
    const response = await collect(request, ctx.completedOrderId, ctx.terminalCodes[1]);
    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: "This order has already been collected.",
    });
  });
});