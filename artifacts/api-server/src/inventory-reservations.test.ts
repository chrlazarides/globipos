import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { inventoryReservations, itemLocationStock, items, posLocations } from "@workspace/db";
import { db, pool } from "./db";
import {
  createOrderReservationInTransaction,
  consumeLocationStockInTransaction,
  fulfillReservationsForSourceInTransaction,
  POOLED_ONLINE_LOCATION_ID,
} from "./inventory-reservations";
import { getInventoryModeInTransaction, setInventoryModeInTransaction } from "./inventory-mode";

test("setup permits legacy sales; activation enforces holds and pooled fulfillment without unsafe switching", async () => {
  const suffix = randomUUID();
  const rolledBack = new Error("test transaction rolled back");
  try {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO system_settings (key, value, label, "group")
        VALUES ('multistore_inventory_enabled', 'false', 'Multi-store stock control', 'inventory')
        ON CONFLICT (key) DO UPDATE SET value = 'false'`);
      const [a, b] = await tx.insert(posLocations).values([
        { name: `Source A ${suffix}`, code: `a-${suffix}` },
        { name: `Source B ${suffix}`, code: `b-${suffix}` },
      ]).returning();
      const [item] = await tx.insert(items).values({
        name: `Pooled test item ${suffix}`,
        sku: `pooled-${suffix}`,
        price1: "10.00",
        stockQuantity: 3,
      }).returning();
      await consumeLocationStockInTransaction(tx, POOLED_ONLINE_LOCATION_ID, [{ itemId: item.id, quantity: 1 }]);
      const [legacy] = await tx.select().from(items).where(eq(items.id, item.id));
      assert.equal(legacy.stockQuantity, 2, "legacy checkout does not require any shop stock rows");
      await createOrderReservationInTransaction(tx, {
        lines: [{ itemId: item.id, quantity: 1 }], locationId: POOLED_ONLINE_LOCATION_ID,
        sourceType: "portal_order", sourceId: suffix, customerName: "Test shopper", idempotencyKey: `setup-${suffix}`,
      });
      assert.equal((await tx.select().from(inventoryReservations).where(eq(inventoryReservations.sourceId, suffix))).length, 0);
      await tx.insert(itemLocationStock).values([
        { itemId: item.id, locationId: a.id, quantity: 1 },
        { itemId: item.id, locationId: b.id, quantity: 1 },
      ]);
      await tx.execute(sql`UPDATE system_settings SET value = 'true' WHERE key = 'multistore_inventory_enabled'`);
      await assert.rejects(
        consumeLocationStockInTransaction(tx, a.id, [{ itemId: item.id, quantity: 2 }]),
        /Insufficient available stock/,
      );
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
      await assert.rejects(consumeLocationStockInTransaction(tx, a.id, [{ itemId: item.id, quantity: 1 }]), /Insufficient available stock/);
      await assert.rejects(setInventoryModeInTransaction(tx, "false"), /active stock reservations/);
      assert.equal(await getInventoryModeInTransaction(tx), true);

      await fulfillReservationsForSourceInTransaction(tx, "portal_order", suffix);
      const after = await tx.select().from(itemLocationStock).where(eq(itemLocationStock.itemId, item.id));
      assert.deepEqual(after.map((row) => row.quantity), [0, 0]);
      const [global] = await tx.select({ stockQuantity: items.stockQuantity }).from(items).where(eq(items.id, item.id));
      assert.equal(global.stockQuantity, 0);
      const fulfilled = await tx.select().from(inventoryReservations).where(eq(inventoryReservations.sourceId, suffix));
      assert.ok(fulfilled.every((hold) => hold.status === "fulfilled"));
      await setInventoryModeInTransaction(tx, "false");
      await tx.update(items).set({ stockQuantity: 5 }).where(eq(items.id, item.id));
      await assert.rejects(setInventoryModeInTransaction(tx, "true"), /totals differ/);
      assert.equal(await getInventoryModeInTransaction(tx), false, "failed activation leaves setup mode unchanged");
      throw rolledBack;
    }), (error: unknown) => error === rolledBack);
  } finally {
    await pool.end();
  }
});