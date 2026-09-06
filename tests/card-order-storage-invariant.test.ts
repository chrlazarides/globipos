import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { storage } from "../server/storage";
import { posOrders } from "../shared/schema";

test("provider-specific held card orders complete atomically with their reference", async () => {
  const orderNumber = `CARD-STORAGE-${Date.now()}`;
  const order = await storage.createPosOrder({
    orderNumber,
    terminalId: "card-storage-test-terminal",
    locationId: "card-storage-test-location",
    paymentMethod: "card_jcc",
    status: "held",
    total: "12.34",
  }, []);

  try {
    await storage.completeCardPosOrder(order.id, "  JCC-AUTH-123  ", "12.34");
    const completed = await storage.getPosOrder(order.id);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.cardTerminalRef, "JCC-AUTH-123");
  } finally {
    await db.delete(posOrders).where(eq(posOrders.id, order.id));
    await pool.end();
  }
});