import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { pool } from "./db";

export class PosStockInError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 409, code = "STOCK_IN_CONFLICT") {
    super(message);
    this.name = "PosStockInError";
    this.status = status;
    this.code = code;
  }
}

export type PosStockInInput = {
  itemId: string;
  variantId?: string | null;
  locationId: string;
  terminalId: string;
  cashierId: string;
  idempotencyKey: string;
  quantity: number;
};

export type PosStockInResult = {
  itemId: string;
  variantId: string | null;
  locationId: string;
  quantity: number;
  onHand: number;
  available: number;
  operationId: string;
};

export function stockInRequestHash(input: PosStockInInput): string {
  return createHash("sha256").update(JSON.stringify({
    itemId: input.itemId,
    variantId: input.variantId || null,
    locationId: input.locationId,
    cashierId: input.cashierId,
    quantity: input.quantity,
  })).digest("hex");
}

export function calculateAvailableStock(onHandAtLocation: number, reservedQuantity: number): number {
  return Math.max(0, onHandAtLocation - reservedQuantity);
}

function stockInAuditPrefix(idempotencyKey: string): string {
  return `STOCK_IN:${Buffer.from(idempotencyKey).toString("base64url")}:`;
}

async function assertImportLocationExists(locationId: string, database: Pool = pool): Promise<void> {
  const result = await database.query(
    "SELECT id FROM pos_locations WHERE id = $1 AND active = true",
    [locationId],
  );
  if (!result.rowCount) throw new Error("Selected stock location does not exist or is inactive.");
}

export async function validateImportStockLocation(locationId: string, database: Pool = pool): Promise<void> {
  await assertImportLocationExists(locationId, database);
}

/**
 * Import semantics are absolute assignments, not receipts: retrying an upsert
 * writes the same location quantity rather than adding the imported quantity
 * again.
 */
export async function setImportedLocationStock(
  itemId: string,
  locationId: string,
  quantity: number,
  database: Pool = pool,
): Promise<void> {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error("Imported stock quantity must be a non-negative whole number.");
  }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext($1)::bigint)", ["multistore_inventory_enabled"]);
    const mode = await client.query("SELECT value FROM system_settings WHERE key = $1", ["multistore_inventory_enabled"]);
    const item = await client.query("SELECT id, has_variants FROM items WHERE id = $1 FOR UPDATE", [itemId]);
    if (!item.rowCount) throw new Error("Imported item was not found while assigning location stock.");
    if (item.rows[0].has_variants) {
      throw new Error("A location-aware catalog import cannot set stock on a parent item with variants; use variant Stock In instead.");
    }
    await assertImportLocationExists(locationId, database);
    const rows = await client.query(
      `SELECT id FROM item_location_stock
       WHERE item_id = $1 AND variant_id IS NULL AND location_id = $2
       ORDER BY id FOR UPDATE`,
      [itemId, locationId],
    );
    if (rows.rowCount > 1) {
      throw new Error("Duplicate location stock records must be reconciled before importing this item.");
    }
    const holds = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS quantity
       FROM inventory_reservations
       WHERE item_id = $1 AND variant_id IS NULL AND source_location_id = $2 AND status = 'reserved'`,
      [itemId, locationId],
    );
    if (quantity < Number(holds.rows[0].quantity)) {
      throw new Error(`Cannot import ${quantity} units: ${holds.rows[0].quantity} are reserved at this shop.`);
    }
    if (rows.rowCount) {
      await client.query(
        "UPDATE item_location_stock SET quantity = $1, updated_at = now() WHERE id = $2",
        [quantity, rows.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO item_location_stock (item_id, variant_id, location_id, quantity, updated_at)
         VALUES ($1, NULL, $2, $3, now())`,
        [itemId, locationId, quantity],
      );
    }
    // During setup these are shop-count snapshots, not replacements for the
    // existing global total. Only active stock control owns that total.
    if (mode.rows[0]?.value === "true") await client.query(
      `UPDATE items SET stock_quantity = (
        SELECT COALESCE(SUM(quantity), 0)::int FROM item_location_stock
        WHERE item_id = $1 AND variant_id IS NULL
      ), updated_at = now() WHERE id = $1`,
      [itemId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function receivePosStock(
  input: PosStockInInput,
  database: Pool = pool,
): Promise<PosStockInResult> {
  const variantId = input.variantId || null;
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new PosStockInError("Stock-in quantity must be a positive whole number.", 400, "INVALID_QUANTITY");
  }
  const requestHash = stockInRequestHash(input);
  const auditPrefix = stockInAuditPrefix(input.idempotencyKey);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext($1)::bigint)", ["multistore_inventory_enabled"]);
    // Serialise stock-in operations for this terminal so both idempotency
    // lookups and generated (negative) audit local IDs are race-safe.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.terminalId]);
    const priorAudit = await client.query(
      `SELECT detail FROM pos_audit_logs
       WHERE terminal_id = $1 AND action = 'STOCK_IN'
         AND left(detail, length($2)) = $2
       ORDER BY created_at DESC LIMIT 1`,
      [input.terminalId, auditPrefix],
    );
    if (priorAudit.rowCount) {
      const saved = JSON.parse(String(priorAudit.rows[0].detail).slice(auditPrefix.length));
      if (saved.requestHash !== requestHash) {
        throw new PosStockInError("This idempotency key was already used for a different stock-in request.", 409, "IDEMPOTENCY_KEY_REUSED");
      }
      await client.query("COMMIT");
      return saved.response as PosStockInResult;
    }

    const item = await client.query("SELECT id, active, has_variants FROM items WHERE id = $1 FOR UPDATE", [input.itemId]);
    if (!item.rowCount) throw new PosStockInError("Item not found.", 404, "ITEM_NOT_FOUND");
    if (!item.rows[0].active) throw new PosStockInError("Item is inactive.", 409, "ITEM_INACTIVE");
    if (item.rows[0].has_variants && !variantId) {
      throw new PosStockInError("Select a size or colour variant before receiving stock.", 400, "VARIANT_REQUIRED");
    }
    if (variantId) {
      const variant = await client.query(
        "SELECT id FROM item_variants WHERE id = $1 AND item_id = $2 AND active = true FOR UPDATE",
        [variantId, input.itemId],
      );
      if (!variant.rowCount) throw new PosStockInError("Variant not found for this item.", 404, "VARIANT_NOT_FOUND");
    }
    const location = await client.query(
      "SELECT id FROM pos_locations WHERE id = $1 AND active = true",
      [input.locationId],
    );
    if (!location.rowCount) throw new PosStockInError("Terminal location is unavailable.", 409, "LOCATION_NOT_FOUND");

    const stockRows = await client.query(
      `SELECT id, quantity FROM item_location_stock
       WHERE item_id = $1 AND variant_id IS NOT DISTINCT FROM $2 AND location_id = $3
       ORDER BY id FOR UPDATE`,
      [input.itemId, variantId, input.locationId],
    );
    if (stockRows.rowCount > 1) {
      throw new PosStockInError("Duplicate location stock records must be reconciled before receiving stock.", 409, "AMBIGUOUS_LOCATION_STOCK");
    }

    const globalTable = variantId ? "item_variants" : "items";
    const globalRows = await client.query(
      `UPDATE ${globalTable} SET stock_quantity = stock_quantity + $1, updated_at = now()
       WHERE id = $2 ${variantId ? "AND item_id = $3" : ""}
       RETURNING stock_quantity`,
      variantId ? [input.quantity, variantId, input.itemId] : [input.quantity, input.itemId],
    );
    if (!globalRows.rowCount) {
      throw new PosStockInError(variantId ? "Variant not found for this item." : "Item not found.", 404, variantId ? "VARIANT_NOT_FOUND" : "ITEM_NOT_FOUND");
    }
    const locationOnHand = Number(stockRows.rows[0]?.quantity || 0) + input.quantity;
    if (stockRows.rowCount) {
      await client.query(
        "UPDATE item_location_stock SET quantity = $1, updated_at = now() WHERE id = $2",
        [locationOnHand, stockRows.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO item_location_stock (item_id, variant_id, location_id, quantity, updated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [input.itemId, variantId, input.locationId, locationOnHand],
      );
    }

    const reservations = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS quantity
       FROM inventory_reservations
       WHERE item_id = $1 AND variant_id IS NOT DISTINCT FROM $2
         AND source_location_id = $3 AND status = 'reserved'`,
      [input.itemId, variantId, input.locationId],
    );
    const result: PosStockInResult = {
      itemId: input.itemId,
      variantId,
      locationId: input.locationId,
      quantity: input.quantity,
      onHand: locationOnHand,
      available: calculateAvailableStock(locationOnHand, Number(reservations.rows[0]?.quantity || 0)),
      operationId: randomUUID(),
    };
    const localIdResult = await client.query(
      `SELECT LEAST(COALESCE(MIN(local_id), 0), 0) - 1 AS local_id
       FROM pos_audit_logs WHERE terminal_id = $1`,
      [input.terminalId],
    );
    const localId = Number(localIdResult.rows[0].local_id);
    const auditDetail = `${auditPrefix}${JSON.stringify({ requestHash, response: result })}`;
    await client.query(
      `INSERT INTO pos_audit_logs
         (terminal_id, local_id, cashier_id, action, entity, entity_id, detail, created_at)
       VALUES ($1, $2, $3, 'STOCK_IN', $4, $5, $6, now())`,
      [input.terminalId, localId, input.cashierId, variantId ? "item_variant" : "item", variantId || input.itemId, auditDetail],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}