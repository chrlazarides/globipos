import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { inventoryReservations, itemLocationStock, itemVariants, items, posCashiers, posLocations, posTerminals, stockTransfers } from "@workspace/db";
import { db, pool } from "./db";
import { cancelInventoryTransferInTransaction, completeInventoryTransferInTransaction, createInventoryTransferInTransaction } from "./inventory-reservations";

test("transfers are atomic, reservation-safe, variant-aware, globally neutral and retry-safe", async () => {
  const suffix = randomUUID();
  const rollback = new Error("rollback transfer fixtures");
  try {
    await assert.rejects(db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO system_settings (key, value, label, "group")
        VALUES ('multistore_inventory_enabled', 'false', 'Multi-store stock control', 'inventory')
        ON CONFLICT (key) DO UPDATE SET value = 'false'`);
      const [a, b] = await tx.insert(posLocations).values([
        { name: `Transfer A ${suffix}`, code: `tr-a-${suffix}` },
        { name: `Transfer B ${suffix}`, code: `tr-b-${suffix}` },
      ]).returning();
      const [terminal] = await tx.insert(posTerminals).values({ locationId: a.id, name: "Transfer test", code: `tr-${suffix}` }).returning();
      const [cashier] = await tx.insert(posCashiers).values({ locationId: a.id, name: "Transfer test", pin: "0".repeat(64) }).returning();
      const [item, parent] = await tx.insert(items).values([
        { name: `Transfer item ${suffix}`, sku: `tr-item-${suffix}`, price1: "10", stockQuantity: 10 },
        { name: `Variant item ${suffix}`, sku: `tr-parent-${suffix}`, price1: "10", hasVariants: true },
      ]).returning();
      const [variant] = await tx.insert(itemVariants).values({ itemId: parent.id, sku: `tr-variant-${suffix}`, option1Value: "Blue", stockQuantity: 4 }).returning();
      await tx.insert(itemLocationStock).values([
        { itemId: item.id, locationId: a.id, quantity: 8 },
        { itemId: item.id, locationId: b.id, quantity: 2 },
        { itemId: parent.id, variantId: variant.id, locationId: a.id, quantity: 4 },
      ]);
      await tx.insert(inventoryReservations).values({
        itemId: item.id, sourceLocationId: a.id, destinationLocationId: a.id, quantity: 3,
        customerName: "Reserved test customer", sourceType: "portal_order", sourceId: suffix,
        idempotencyKey: `hold-${suffix}`, status: "reserved",
      });
      const header = (key: string, extra = {}) => ({
        transferNumber: `TR-TEST-${key}-${suffix}`, fromLocation: a.name, toLocation: b.name,
        createdByUsername: "Test", ...extra,
      });
      const stock = async (itemId: string, variantId: string | null = null) =>
        (await tx.select().from(itemLocationStock).where(and(
          eq(itemLocationStock.itemId, itemId),
          variantId ? eq(itemLocationStock.variantId, variantId) : sql`${itemLocationStock.variantId} IS NULL`,
        ))).sort((x, y) => x.locationId.localeCompare(y.locationId));
      const quantityAt = async (itemId: string, locationId: string, variantId: string | null = null) =>
        (await stock(itemId, variantId)).find(row => row.locationId === locationId)?.quantity || 0;

      const draft = await createInventoryTransferInTransaction(tx, header("draft", { status: "completed" }), [{ itemId: item.id, quantity: 1 }]);
      assert.equal(draft.status, "draft", "clients cannot mark unmoved stock completed");
      assert.equal(await quantityAt(item.id, a.id), 8);
      const cancelled = await cancelInventoryTransferInTransaction(tx, draft.id);
      assert.equal(cancelled.status, "cancelled");
      await assert.rejects(completeInventoryTransferInTransaction(tx, draft.id), /Only draft/);
      await assert.rejects(createInventoryTransferInTransaction(tx, header("same", { toLocation: a.name }), [{ itemId: item.id, quantity: 1 }]), /two different/);
      await assert.rejects(createInventoryTransferInTransaction(tx, header("negative"), [{ itemId: item.id, quantity: -1 }]), /positive whole/);
      await assert.rejects(createInventoryTransferInTransaction(tx, header("variant-required"), [{ itemId: parent.id, quantity: 1 }]), /variant/);

      const options = { completeImmediately: true, terminalId: terminal.id, cashierId: cashier.id, idempotencyKey: `transfer-${suffix}` };
      const moved = await createInventoryTransferInTransaction(tx, header("pos"), [{ itemId: item.id, quantity: 3 }], options);
      assert.equal(moved.status, "completed");
      assert.equal(await quantityAt(item.id, a.id), 5);
      assert.equal(await quantityAt(item.id, b.id), 5);
      const replay = await createInventoryTransferInTransaction(tx, header("retry-number"), [{ itemId: item.id, quantity: 3 }], options);
      assert.equal(replay.id, moved.id);
      await completeInventoryTransferInTransaction(tx, moved.id);
      assert.equal(await quantityAt(item.id, a.id), 5, "retries do not move units twice");
      await assert.rejects(createInventoryTransferInTransaction(tx, header("changed"), [{ itemId: item.id, quantity: 2 }], options), /different transfer/);
      await assert.rejects(cancelInventoryTransferInTransaction(tx, moved.id), /completed transfer/);

      const staffOptions = { completeImmediately: true, staffId: `staff-${suffix}`, idempotencyKey: `staff-transfer-${suffix}` };
      const staffMoved = await createInventoryTransferInTransaction(tx, header("staff"), [{ itemId: item.id, quantity: 1 }], staffOptions);
      const staffReplay = await createInventoryTransferInTransaction(tx, header("staff-retry"), [{ itemId: item.id, quantity: 1 }], staffOptions);
      assert.equal(staffReplay.id, staffMoved.id, "Back Office and PDA retries reuse the committed transfer");
      assert.equal(await quantityAt(item.id, a.id), 4, "a lost staff response does not cause a second movement");
      await assert.rejects(createInventoryTransferInTransaction(tx, header("staff-changed"), [{ itemId: item.id, quantity: 2 }], staffOptions), /different transfer/);

      await tx.execute(sql`SAVEPOINT failing_transfer`);
      await assert.rejects(createInventoryTransferInTransaction(tx, header("blocked"), [{ itemId: item.id, quantity: 3 }], { completeImmediately: true }), /reserved/);
      await tx.execute(sql`ROLLBACK TO SAVEPOINT failing_transfer`);
      const orphan = await tx.select().from(stockTransfers).where(eq(stockTransfers.transferNumber, header("blocked").transferNumber));
      assert.equal(orphan.length, 0, "a failed immediate transfer leaves no header or lines");
      assert.equal(await quantityAt(item.id, a.id), 4);

      await tx.execute(sql`UPDATE system_settings SET value = 'true' WHERE key = 'multistore_inventory_enabled'`);
      await createInventoryTransferInTransaction(tx, header("enabled"), [{ itemId: item.id, quantity: 1 }], { completeImmediately: true });
      assert.equal(await quantityAt(item.id, a.id), 3, "only the reserved units remain at source");
      const variantMove = await createInventoryTransferInTransaction(tx, header("variant"), [
        { itemId: parent.id, variantId: variant.id, quantity: 1 },
        { itemId: parent.id, variantId: variant.id, quantity: 1 },
      ], { completeImmediately: true });
      assert.equal(variantMove.status, "completed");
      assert.equal(await quantityAt(parent.id, a.id, variant.id), 2);
      assert.equal(await quantityAt(parent.id, b.id, variant.id), 2);
      const [global] = await tx.select().from(items).where(eq(items.id, item.id));
      const [globalVariant] = await tx.select().from(itemVariants).where(eq(itemVariants.id, variant.id));
      assert.equal(global.stockQuantity, 10, "moving stock never changes its global total");
      assert.equal(globalVariant.stockQuantity, 4);
      throw rollback;
    }), error => error === rollback);
  } finally {
    await pool.end();
  }
});