import { sql } from "drizzle-orm";
import { db } from "./db";

export const MULTISTORE_SETTING = "multistore_inventory_enabled";
export const MULTISTORE_DEFAULT = {
  key: MULTISTORE_SETTING, value: "false", label: "Multi-store stock control", group: "inventory",
};

export class InventoryModeError extends Error {
  status = 409;
}

// A shared transaction lock prevents the switch changing halfway through a
// sale, receipt, import or reservation. No row/default needs to exist yet.
export async function getInventoryModeInTransaction(tx: any): Promise<boolean> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${MULTISTORE_SETTING})::bigint)`);
  const result = await tx.execute(sql`SELECT value FROM system_settings WHERE key = ${MULTISTORE_SETTING}`);
  return result.rows[0]?.value === "true";
}

export async function getInventoryMode(): Promise<boolean> {
  const result = await db.execute(sql`SELECT value FROM system_settings WHERE key = ${MULTISTORE_SETTING}`);
  return result.rows[0]?.value === "true";
}

export async function setInventoryMode(value: string) {
  return db.transaction(tx => setInventoryModeInTransaction(tx, value));
}

export async function setInventoryModeInTransaction(tx: any, value: string) {
  if (!["true", "false"].includes(value)) throw new InventoryModeError("Multi-store stock control must be enabled or disabled.");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${MULTISTORE_SETTING})::bigint)`);
    const current = await tx.execute(sql`SELECT value FROM system_settings WHERE key = ${MULTISTORE_SETTING}`);
    if (current.rows[0]?.value !== value) {
      const holds = await tx.execute(sql`SELECT count(*)::int AS count FROM inventory_reservations WHERE status = 'reserved'`);
      if (Number(holds.rows[0].count) > 0) {
        throw new InventoryModeError("Complete or release active stock reservations before changing multi-store stock control.");
      }
      if (value === "true") {
        const invalid = await tx.execute(sql`
          WITH totals AS (
            SELECT s.item_id, s.variant_id, SUM(s.quantity)::int AS quantity
            FROM item_location_stock s
            JOIN pos_locations l ON l.id = s.location_id AND l.active = true
            GROUP BY s.item_id, s.variant_id
          ), products AS (
            SELECT id AS item_id, NULL::varchar AS variant_id, stock_quantity FROM items
            WHERE active = true AND has_variants = false
            UNION ALL
            SELECT v.item_id, v.id, v.stock_quantity FROM item_variants v
            JOIN items i ON i.id = v.item_id AND i.active = true WHERE v.active = true
          )
          SELECT count(*)::int AS count FROM products p
          LEFT JOIN totals t ON t.item_id = p.item_id AND t.variant_id IS NOT DISTINCT FROM p.variant_id
          WHERE p.stock_quantity < 0 OR p.stock_quantity <> COALESCE(t.quantity, 0)
        `);
        const ambiguous = await tx.execute(sql`
          SELECT count(*)::int AS count FROM (
            SELECT item_id, variant_id, location_id FROM item_location_stock
            GROUP BY item_id, variant_id, location_id HAVING count(*) > 1 OR min(quantity) < 0
          ) invalid
        `);
        if (Number(invalid.rows[0].count) || Number(ambiguous.rows[0].count)) {
          throw new InventoryModeError(`Multi-store cannot be enabled yet: ${invalid.rows[0].count} item/variant totals differ from active-shop counts. Reconcile counts and duplicate/negative records first.`);
        }
      }
    }
    const result = await tx.execute(sql`
      INSERT INTO system_settings (key, value, label, "group")
      VALUES (${MULTISTORE_SETTING}, ${value}, ${MULTISTORE_DEFAULT.label}, 'inventory')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      RETURNING *
    `);
    return result.rows[0];
}