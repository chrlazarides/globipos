import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { inventoryReservations, itemLocationStock, items, posLocations } from "@workspace/db";
import { db, pool } from "./db";
import {
  createOrderReservationInTransaction,
  fulfillReservationsForSourceInTransaction,
  POOLED_ONLINE_LOCATION_ID,
} from "./inventory-reservations";

test("online orders allocate and fulfill stock from separate shops without taking reserved units twice", async () => {
  const suffix = randomUUID();
  const rolledBack = new Error("test transaction rolled back");
  try {
    await assert.rejects(db.transaction(async (tx) => {
      const [a, b] = await tx.insert(posLocations).values([
        { name: `Source A ${suffix}`, code: `a-${suffix}` },
        { name: `Source B ${suffix}`, code: `b-${suffix}` },
      ]).returning();
      const [item] = await tx.insert(items).values({
        name: `Pooled test item ${suffix}`,
        sku: `pooled-${suffix}`,
        price1: "10.00",
        stockQuantity: 2,
      }).returning();
      await tx.insert(itemLocationStock).values([
        { itemId: item.id, locationId: a.id, quantity: 1 },
        { itemId: item.id, locationId: b.id, quantity: 1 },
      ]);
      await createOrderReservationInTransaction(tx, {
        lines: [{ itemId: item.id, quantity: 2 }],
        locationId: POOLED_ONLINE_LOCATION_ID,
        sourceType: "portal_order",
        sourceId: suffix,
        customerName: "Test shopper",
        idempotencyKey: `checkout-${suffix}`,
      });
      const holds = await tx.select().from(inventoryReservations)
        .where(eq(inventoryReservations.sourceId, suffix));
      assert.equal(holds.length, 2);
      assert.deepEqual(new Set(holds.map((hold) => hold.sourceLocationId)), new Set([a.id, b.id]));

      await fulfillReservationsForSourceInTransaction(tx, "portal_order", suffix);
      const after = await tx.select().from(itemLocationStock).where(eq(itemLocationStock.itemId, item.id));
      assert.deepEqual(after.map((row) => row.quantity), [0, 0]);
      const [global] = await tx.select({ stockQuantity: items.stockQuantity }).from(items).where(eq(items.id, item.id));
      assert.equal(global.stockQuantity, 0);
      const fulfilled = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.sourceId, suffix));
      assert.ok(fulfilled.every((hold) => hold.status === "fulfilled"));
      throw rolledBack;
    }), (error: unknown) => error === rolledBack);
  } finally {
    await pool.end();
  }
});