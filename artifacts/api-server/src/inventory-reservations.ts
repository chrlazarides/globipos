import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  inventoryReservations,
  itemLocationStock,
  itemVariants,
  items,
  posLocations,
  posOrderLines,
  posOrders,
  stockTransferItems,
  stockTransfers,
} from "@workspace/db";
import { db } from "./db";

export class InventoryError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 409, code = "INVENTORY_CONFLICT") {
    super(message);
    this.name = "InventoryError";
    this.status = status;
    this.code = code;
  }
}

export type InventoryLine = {
  itemId: string;
  variantId?: string | null;
  quantity: number;
};

export const POOLED_ONLINE_LOCATION_ID = "__available_shops__";

type StockKey = { itemId: string; variantId: string | null; quantity: number };

function normalizeLines(lines: InventoryLine[]): StockKey[] {
  const quantities = new Map<string, StockKey>();
  for (const line of lines) {
    const quantity = Number(line.quantity);
    if (!line.itemId || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new InventoryError("Stock quantities must be positive whole numbers.", 400, "INVALID_QUANTITY");
    }
    const variantId = line.variantId || null;
    const key = `${line.itemId}\u0000${variantId || ""}`;
    const current = quantities.get(key);
    if (current) current.quantity += quantity;
    else quantities.set(key, { itemId: line.itemId, variantId, quantity });
  }
  return [...quantities.values()].sort((a, b) =>
    a.itemId.localeCompare(b.itemId) || (a.variantId || "").localeCompare(b.variantId || ""),
  );
}

async function lockInventoryEntities(tx: any, lines: StockKey[]): Promise<void> {
  const itemIds = [...new Set(lines.map((line) => line.itemId))].sort();
  if (!itemIds.length) return;
  const lockedItems = await tx.execute(sql`
    SELECT id FROM items WHERE id IN (${sql.join(itemIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id FOR UPDATE
  `);
  if (lockedItems.rows.length !== itemIds.length) {
    throw new InventoryError("One or more items no longer exist.", 409, "ITEM_NOT_FOUND");
  }

  const variantIds = [...new Set(lines.map((line) => line.variantId).filter(Boolean) as string[])].sort();
  if (variantIds.length) {
    const lockedVariants = await tx.execute(sql`
      SELECT id FROM item_variants
      WHERE id IN (${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY id FOR UPDATE
    `);
    if (lockedVariants.rows.length !== variantIds.length) {
      throw new InventoryError("One or more selected variants no longer exist.", 409, "VARIANT_NOT_FOUND");
    }
    const variantRows = await tx.select({ id: itemVariants.id, itemId: itemVariants.itemId })
      .from(itemVariants).where(inArray(itemVariants.id, variantIds));
    const parents = new Map(variantRows.map((row: any) => [row.id, row.itemId]));
    for (const line of lines) {
      if (line.variantId && parents.get(line.variantId) !== line.itemId) {
        throw new InventoryError("Selected variant does not belong to its item.", 400, "VARIANT_MISMATCH");
      }
    }
  }
}

async function getLocationStock(tx: any, line: StockKey, locationId: string, lock = true) {
  const result = await tx.execute(sql`
    SELECT id, quantity FROM item_location_stock
    WHERE item_id = ${line.itemId}
      AND location_id = ${locationId}
      AND variant_id IS NOT DISTINCT FROM ${line.variantId}
    ORDER BY id
    ${lock ? sql`FOR UPDATE` : sql``}
  `);
  if (result.rows.length > 1) {
    throw new InventoryError(
      "Duplicate location stock records need reconciliation before this item can be sold or reserved.",
      409,
      "AMBIGUOUS_LOCATION_STOCK",
    );
  }
  return result.rows[0] as { id: string; quantity: number } | undefined;
}

async function getActiveReservations(
  tx: any,
  line: StockKey,
  locationId: string,
  excludeReservationIds: string[] = [],
): Promise<number> {
  const excluded = excludeReservationIds.length
    ? sql`AND id NOT IN (${sql.join(excludeReservationIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const result = await tx.execute(sql`
    SELECT COALESCE(SUM(quantity), 0)::int AS quantity
    FROM inventory_reservations
    WHERE item_id = ${line.itemId}
      AND variant_id IS NOT DISTINCT FROM ${line.variantId}
      AND source_location_id = ${locationId}
      AND status = 'reserved'
      ${excluded}
  `);
  return Number(result.rows[0]?.quantity || 0);
}

async function getGlobalStock(tx: any, line: StockKey): Promise<number> {
  const result = line.variantId
    ? await tx.execute(sql`
        SELECT stock_quantity FROM item_variants
        WHERE id = ${line.variantId} AND item_id = ${line.itemId}
      `)
    : await tx.execute(sql`SELECT stock_quantity FROM items WHERE id = ${line.itemId}`);
  if (!result.rows.length) {
    throw new InventoryError("Item stock record was not found.", 409, "ITEM_NOT_FOUND");
  }
  return Number(result.rows[0].stock_quantity);
}

async function decrementGlobalStock(tx: any, line: StockKey): Promise<void> {
  const result = line.variantId
    ? await tx.execute(sql`
        UPDATE item_variants
        SET stock_quantity = stock_quantity - ${line.quantity}, updated_at = now()
        WHERE id = ${line.variantId} AND item_id = ${line.itemId}
          AND stock_quantity >= ${line.quantity}
        RETURNING id
      `)
    : await tx.execute(sql`
        UPDATE items
        SET stock_quantity = stock_quantity - ${line.quantity}, updated_at = now()
        WHERE id = ${line.itemId} AND stock_quantity >= ${line.quantity}
        RETURNING id
      `);
  if (!result.rows.length) {
    throw new InventoryError("Global on-hand quantity is insufficient for this sale.", 409, "INSUFFICIENT_STOCK");
  }
}

async function writeLocationQuantity(tx: any, stockRow: any, line: StockKey, locationId: string, nextQuantity: number) {
  if (nextQuantity < 0) {
    throw new InventoryError("Stock cannot become negative.", 409, "INSUFFICIENT_STOCK");
  }
  if (stockRow) {
    const result = await tx.execute(sql`
      UPDATE item_location_stock
      SET quantity = ${nextQuantity}, updated_at = now()
      WHERE id = ${stockRow.id} AND quantity >= 0
      RETURNING id
    `);
    if (!result.rows.length) throw new InventoryError("Location stock changed; retry the operation.");
  } else if (nextQuantity > 0) {
    await tx.execute(sql`
      INSERT INTO item_location_stock (item_id, variant_id, location_id, quantity, updated_at)
      VALUES (${line.itemId}, ${line.variantId}, ${locationId}, ${nextQuantity}, now())
    `);
  }
}

export async function consumeLocationStockInTransaction(
  tx: any,
  locationId: string,
  rawLines: InventoryLine[],
  options: { excludeReservationIds?: string[] } = {},
): Promise<void> {
  const lines = normalizeLines(rawLines);
  if (!lines.length) throw new InventoryError("At least one stock item is required.", 400, "EMPTY_LINES");
  await lockInventoryEntities(tx, lines);

  const [location] = await tx.select({ id: posLocations.id, active: posLocations.active })
    .from(posLocations).where(eq(posLocations.id, locationId)).limit(1);
  if (!location?.active) {
    throw new InventoryError("The fulfillment location is missing or inactive.", 409, "LOCATION_UNAVAILABLE");
  }

  for (const line of lines) {
    const [item] = await tx.select({
      id: items.id,
      name: items.name,
      active: items.active,
      hasVariants: items.hasVariants,
    }).from(items).where(eq(items.id, line.itemId)).limit(1);
    if (!item?.active) throw new InventoryError("An item is inactive or missing.", 409, "ITEM_UNAVAILABLE");
    if (item.hasVariants && !line.variantId) {
      throw new InventoryError(`${item.name} requires a variant selection.`, 409, "VARIANT_REQUIRED");
    }
    const stock = await getLocationStock(tx, line, locationId);
    const onHand = Number(stock?.quantity || 0);
    const reserved = await getActiveReservations(tx, line, locationId, options.excludeReservationIds);
    if (!stock || onHand - reserved < line.quantity) {
      throw new InventoryError(
        `Insufficient available stock for ${item.name} at this location. Available: ${Math.max(0, onHand - reserved)}, requested: ${line.quantity}.`,
        409,
        "INSUFFICIENT_AVAILABLE_STOCK",
      );
    }
    const globalOnHand = await getGlobalStock(tx, line);
    if (globalOnHand < line.quantity) {
      throw new InventoryError(`Global on-hand quantity for ${item.name} is insufficient.`, 409, "INSUFFICIENT_STOCK");
    }
    await writeLocationQuantity(tx, stock, line, locationId, onHand - line.quantity);
    await decrementGlobalStock(tx, line);
  }
}

export async function chooseSingleLocationForLinesInTransaction(tx: any, rawLines: InventoryLine[]): Promise<string> {
  const lines = normalizeLines(rawLines);
  if (!lines.length) throw new InventoryError("An invoice needs stock lines.", 400, "EMPTY_LINES");
  await lockInventoryEntities(tx, lines);
  const locations = await tx.select({ id: posLocations.id })
    .from(posLocations).where(eq(posLocations.active, true)).orderBy(posLocations.id);
  for (const location of locations) {
    let canFulfill = true;
    for (const line of lines) {
      const stock = await getLocationStock(tx, line, location.id);
      const held = await getActiveReservations(tx, line, location.id);
      if (!stock || Number(stock.quantity) - held < line.quantity) {
        canFulfill = false;
        break;
      }
    }
    if (canFulfill) return location.id;
  }
  throw new InventoryError("No single shop has all unreserved items for this invoice. Select a stock location or transfer the items first.", 409, "INSUFFICIENT_AVAILABLE_STOCK");
}

async function holdInTransaction(
  tx: any,
  options: {
    itemId: string;
    variantId?: string | null;
    sourceLocationId: string;
    destinationLocationId: string;
    quantity: number;
    customerName: string;
    cashierId?: string | null;
    idempotencyKey: string;
    sourceType: string;
    sourceId?: string | null;
    transferNumber?: string;
    notes?: string | null;
  },
) {
  const line = normalizeLines([{ itemId: options.itemId, variantId: options.variantId, quantity: options.quantity }])[0];
  const customerName = options.customerName.trim();
  if (!customerName) throw new InventoryError("Customer name is required.", 400, "CUSTOMER_NAME_REQUIRED");
  if (!options.idempotencyKey.trim()) throw new InventoryError("An idempotency key is required.", 400, "IDEMPOTENCY_KEY_REQUIRED");
  if (options.sourceLocationId === options.destinationLocationId && options.sourceType === "transfer") {
    throw new InventoryError("Source and destination must be different locations.", 400, "INVALID_TRANSFER_LOCATIONS");
  }

  await lockInventoryEntities(tx, [line]);
  const [existing] = await tx.select().from(inventoryReservations)
    .where(eq(inventoryReservations.idempotencyKey, options.idempotencyKey)).limit(1);
  if (existing) {
    const matches = existing.itemId === line.itemId
      && (existing.variantId || null) === line.variantId
      && existing.sourceLocationId === options.sourceLocationId
      && existing.destinationLocationId === options.destinationLocationId
      && existing.quantity === line.quantity
      && existing.customerName === customerName;
    if (!matches) throw new InventoryError("Idempotency key was already used for a different reservation.", 409, "IDEMPOTENCY_CONFLICT");
    return existing;
  }

  const [source] = await tx.select().from(posLocations)
    .where(and(eq(posLocations.id, options.sourceLocationId), eq(posLocations.active, true))).limit(1);
  const [destination] = await tx.select().from(posLocations)
    .where(and(eq(posLocations.id, options.destinationLocationId), eq(posLocations.active, true))).limit(1);
  if (!source || !destination) {
    throw new InventoryError("Source or destination location is missing or inactive.", 400, "LOCATION_UNAVAILABLE");
  }
  const [item] = await tx.select({ id: items.id, name: items.name, active: items.active, hasVariants: items.hasVariants })
    .from(items).where(eq(items.id, line.itemId)).limit(1);
  if (!item?.active) throw new InventoryError("Item is inactive or missing.", 409, "ITEM_UNAVAILABLE");
  let transferVariant: { active: boolean; sku: string | null; barcode: string | null; option1Value: string | null; option2Value: string | null; option3Value: string | null } | undefined;
  if (line.variantId) {
    const [variant] = await tx.select({
      id: itemVariants.id, active: itemVariants.active, sku: itemVariants.sku,
      barcode: itemVariants.barcode, option1Value: itemVariants.option1Value,
      option2Value: itemVariants.option2Value, option3Value: itemVariants.option3Value,
    })
      .from(itemVariants).where(and(eq(itemVariants.id, line.variantId), eq(itemVariants.itemId, line.itemId))).limit(1);
    if (!variant?.active) throw new InventoryError("Variant is inactive or does not belong to this item.", 400, "VARIANT_MISMATCH");
    transferVariant = variant;
  } else if (item.hasVariants) {
    throw new InventoryError("A variant must be selected for this item.", 400, "VARIANT_REQUIRED");
  }

  const stock = await getLocationStock(tx, line, options.sourceLocationId);
  const onHand = Number(stock?.quantity || 0);
  const reserved = await getActiveReservations(tx, line, options.sourceLocationId);
  if (!stock || onHand - reserved < line.quantity) {
    throw new InventoryError(
      `Insufficient available stock at the source location. Available: ${Math.max(0, onHand - reserved)}, requested: ${line.quantity}.`,
      409,
      "INSUFFICIENT_AVAILABLE_STOCK",
    );
  }
  const globalOnHand = await getGlobalStock(tx, line);
  const globalHolds = await tx.execute(sql`
    SELECT COALESCE(SUM(quantity), 0)::int AS quantity
    FROM inventory_reservations
    WHERE item_id = ${line.itemId}
      AND variant_id IS NOT DISTINCT FROM ${line.variantId}
      AND status = 'reserved'
  `);
  const globalReserved = Number(globalHolds.rows[0]?.quantity || 0);
  if (globalOnHand - globalReserved < line.quantity) {
    throw new InventoryError(
      "Global on-hand quantity is already reserved or insufficient.",
      409,
      "INSUFFICIENT_AVAILABLE_STOCK",
    );
  }

  let transferId: string | null = null;
  if (options.sourceType === "transfer") {
    const [transfer] = await tx.insert(stockTransfers).values({
      transferNumber: options.transferNumber!,
      fromLocation: source.name,
      toLocation: destination.name,
      status: "draft",
      notes: options.notes || `Reserved for ${customerName}`,
      createdByUsername: customerName,
    }).returning();
    transferId = transfer.id;
    await tx.insert(stockTransferItems).values({
      transferId,
      itemId: line.itemId,
      variantId: line.variantId,
      itemName: [item.name, transferVariant && [transferVariant.option1Value, transferVariant.option2Value, transferVariant.option3Value].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
      sku: transferVariant?.sku || null,
      barcode: transferVariant?.barcode || null,
      quantity: line.quantity,
    });
  }

  const [reservation] = await tx.insert(inventoryReservations).values({
    itemId: line.itemId,
    variantId: line.variantId,
    sourceLocationId: options.sourceLocationId,
    destinationLocationId: options.destinationLocationId,
    quantity: line.quantity,
    customerName,
    requestedByCashierId: options.cashierId || null,
    transferId,
    sourceType: options.sourceType,
    sourceId: options.sourceId || null,
    idempotencyKey: options.idempotencyKey,
    status: "reserved",
  }).returning();
  return reservation;
}

export async function createTransferReservation(options: {
  itemId: string;
  variantId?: string | null;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  customerName: string;
  cashierId: string;
  idempotencyKey: string;
  transferNumber: string;
}) {
  return db.transaction(async (tx) => holdInTransaction(tx, { ...options, sourceType: "transfer" }));
}

export async function createOrderReservationInTransaction(
  tx: any,
  options: {
    lines: InventoryLine[];
    locationId: string;
    sourceType: "portal_order" | "reorder" | "pos_order";
    sourceId: string;
    customerName: string;
    idempotencyKey: string;
  },
): Promise<void> {
  for (const line of normalizeLines(options.lines)) {
    if (options.locationId === POOLED_ONLINE_LOCATION_ID) {
      // Lock the item before choosing locations. Every hold and sale takes this
      // lock, so concurrent checkouts cannot both allocate the last unit.
      await lockInventoryEntities(tx, [line]);
      const availableSources = await tx.execute(sql`
        SELECT ils.location_id, ils.quantity
        FROM item_location_stock ils
        JOIN pos_locations location ON location.id = ils.location_id AND location.active = true
        WHERE ils.item_id = ${line.itemId}
          AND ils.variant_id IS NOT DISTINCT FROM ${line.variantId}
        ORDER BY ils.location_id
        FOR UPDATE OF ils
      `);
      let remaining = line.quantity;
      for (const source of availableSources.rows as { location_id: string; quantity: number }[]) {
        const held = await getActiveReservations(tx, line, source.location_id);
        const available = Math.max(0, Number(source.quantity) - held);
        if (!available) continue;
        const quantity = Math.min(remaining, available);
        await holdInTransaction(tx, {
          ...options,
          itemId: line.itemId,
          variantId: line.variantId,
          quantity,
          sourceLocationId: source.location_id,
          destinationLocationId: source.location_id,
          idempotencyKey: `${options.idempotencyKey}:${line.itemId}:${line.variantId || "item"}:${source.location_id}`,
        });
        remaining -= quantity;
        if (remaining === 0) break;
      }
      if (remaining > 0) {
        throw new InventoryError("Not enough unreserved stock across shops for this online order.", 409, "INSUFFICIENT_AVAILABLE_STOCK");
      }
      continue;
    }
    await holdInTransaction(tx, {
      ...line,
      sourceLocationId: options.locationId,
      destinationLocationId: options.locationId,
      customerName: options.customerName,
      idempotencyKey: `${options.idempotencyKey}:${line.itemId}:${line.variantId || "item"}`,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
    });
  }
}

export async function releaseReservationsForSourceInTransaction(
  tx: any,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  await tx.update(inventoryReservations)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(inventoryReservations.sourceType, sourceType),
      eq(inventoryReservations.sourceId, sourceId),
      eq(inventoryReservations.status, "reserved"),
    ));
}

export async function fulfillReservationsForSourceInTransaction(
  tx: any,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  const reservations = await tx.select().from(inventoryReservations).where(and(
    eq(inventoryReservations.sourceType, sourceType),
    eq(inventoryReservations.sourceId, sourceId),
    eq(inventoryReservations.status, "reserved"),
  )).orderBy(inventoryReservations.itemId, inventoryReservations.variantId);
  if (!reservations.length) return;
  const byLocation = new Map<string, typeof reservations>();
  for (const reservation of reservations) {
    const group = byLocation.get(reservation.sourceLocationId) || [];
    group.push(reservation);
    byLocation.set(reservation.sourceLocationId, group);
  }
  for (const [locationId, group] of [...byLocation].sort(([a], [b]) => a.localeCompare(b))) {
    await consumeLocationStockInTransaction(tx, locationId, group.map((reservation: any) => ({
      itemId: reservation.itemId,
      variantId: reservation.variantId,
      quantity: reservation.quantity,
    })), { excludeReservationIds: group.map((reservation: any) => reservation.id) });
  }
  await tx.update(inventoryReservations)
    .set({ status: "fulfilled", updatedAt: new Date() })
    .where(inArray(inventoryReservations.id, reservations.map((reservation: any) => reservation.id)));
}

export async function completePosOrderStockInTransaction(tx: any, orderId: string): Promise<void> {
  const [order] = await tx.select().from(posOrders).where(eq(posOrders.id, orderId)).for("update");
  if (!order) throw new InventoryError("POS order not found.", 404, "ORDER_NOT_FOUND");
  const lines = await tx.select().from(posOrderLines).where(eq(posOrderLines.orderId, orderId));
  const stockLines = lines.filter((line: any) => line.itemId).map((line: any) => ({
    itemId: line.itemId,
    variantId: line.variantId || null,
    quantity: Number(line.quantity),
  }));
  const holds = await tx.select({ id: inventoryReservations.id }).from(inventoryReservations).where(and(
    eq(inventoryReservations.sourceType, "pos_order"),
    eq(inventoryReservations.sourceId, orderId),
    eq(inventoryReservations.status, "reserved"),
  ));
  if (holds.length) {
    await fulfillReservationsForSourceInTransaction(tx, "pos_order", orderId);
  } else if (stockLines.length) {
    // Legacy held orders may have predate active reservations. Completing those
    // orders must acquire the same atomic stock gate rather than bypassing it.
    await consumeLocationStockInTransaction(tx, order.locationId, stockLines);
  }
}

export async function cancelTransferReservation(id: string, cashierId: string) {
  return db.transaction(async (tx) => {
    let [reservation] = await tx.select().from(inventoryReservations)
      .where(eq(inventoryReservations.id, id));
    if (!reservation) return undefined;
    if (reservation.transferId) {
      await tx.execute(sql`SELECT id FROM stock_transfers WHERE id = ${reservation.transferId} FOR UPDATE`);
    }
    await lockInventoryEntities(tx, [{
      itemId: reservation.itemId,
      variantId: reservation.variantId,
      quantity: reservation.quantity,
    }]);
    [reservation] = await tx.select().from(inventoryReservations)
      .where(eq(inventoryReservations.id, id)).for("update");
    if (!reservation) return undefined;
    if (reservation.requestedByCashierId !== cashierId) {
      throw new InventoryError("Reservation was created by a different cashier.", 403, "CASHIER_FORBIDDEN");
    }
    if (reservation.status !== "reserved") {
      if (reservation.status === "cancelled") return reservation;
      throw new InventoryError("Only active reservations can be cancelled.", 409, "RESERVATION_NOT_ACTIVE");
    }
    const [updated] = await tx.update(inventoryReservations)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(inventoryReservations.id, id), eq(inventoryReservations.status, "reserved")))
      .returning();
    if (reservation.transferId) {
      await tx.update(stockTransfers)
        .set({ status: "cancelled" })
        .where(and(eq(stockTransfers.id, reservation.transferId), eq(stockTransfers.status, "draft")));
    }
    return updated;
  });
}

export async function setLocationStockSafely(
  itemId: string,
  variantId: string | null,
  locationId: string,
  quantity: number,
  delta = false,
) {
  if (!Number.isSafeInteger(quantity)) {
    throw new InventoryError("Location stock quantity must be a whole number.", 400, "INVALID_QUANTITY");
  }
  const line = { itemId, variantId, quantity: Math.abs(quantity) || 1 };
  return db.transaction(async (tx) => {
    await lockInventoryEntities(tx, [line]);
    const stock = await getLocationStock(tx, line, locationId);
    const onHand = Number(stock?.quantity || 0);
    const nextQuantity = delta ? onHand + quantity : quantity;
    if (nextQuantity < 0) throw new InventoryError("Location stock cannot become negative.", 409, "INSUFFICIENT_STOCK");
    const reserved = await getActiveReservations(tx, line, locationId);
    if (nextQuantity < reserved) {
      throw new InventoryError(
        `Location quantity cannot be set below the ${reserved} units currently reserved for transfer or orders.`,
        409,
        "STOCK_RESERVED",
      );
    }
    await writeLocationQuantity(tx, stock, line, locationId, nextQuantity);
    const [updated] = await tx.select().from(itemLocationStock).where(and(
      eq(itemLocationStock.itemId, itemId),
      eq(itemLocationStock.locationId, locationId),
      variantId ? eq(itemLocationStock.variantId, variantId) : sql`${itemLocationStock.variantId} IS NULL`,
    )).limit(1);
    return updated;
  });
}

export async function completeInventoryTransfer(id: string) {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`SELECT * FROM stock_transfers WHERE id = ${id} FOR UPDATE`);
    const existing = result.rows[0] as any;
    if (!existing) return undefined;
    if (existing.status === "completed") {
      const [transfer] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id));
      return transfer;
    }
    if (existing.status !== "draft") throw new InventoryError("Only draft transfers can be completed.", 409, "TRANSFER_NOT_DRAFT");

    const linesResult = await tx.execute(sql`
      SELECT item_id AS "itemId", variant_id AS "variantId", item_name AS "itemName", quantity
      FROM stock_transfer_items WHERE transfer_id = ${id} ORDER BY item_id, variant_id
    `);
    const transferLines = linesResult.rows as any[];
    const lines = normalizeLines(transferLines.map((line) => ({
      itemId: line.itemId,
      variantId: line.variantId,
      quantity: Number(line.quantity),
    })));
    if (!lines.length) throw new InventoryError("Transfer has no inventory lines.", 409, "TRANSFER_EMPTY");
    await lockInventoryEntities(tx, lines);

    const sourceRows = await tx.select().from(posLocations)
      .where(ilike(posLocations.name, existing.from_location));
    const destinationRows = await tx.select().from(posLocations)
      .where(ilike(posLocations.name, existing.to_location));
    if (sourceRows.length !== 1 || destinationRows.length !== 1) {
      throw new InventoryError("Transfer location names are ambiguous or no longer resolve to active locations.", 409, "TRANSFER_LOCATION_UNRESOLVED");
    }
    const source = sourceRows[0];
    const destination = destinationRows[0];
    const reservations = await tx.select().from(inventoryReservations).where(and(
      eq(inventoryReservations.transferId, id),
      eq(inventoryReservations.status, "reserved"),
    ));
    const linkedByKey = new Map<string, any[]>();
    for (const reservation of reservations) {
      const key = `${reservation.itemId}\u0000${reservation.variantId || ""}`;
      linkedByKey.set(key, [...(linkedByKey.get(key) || []), reservation]);
    }

    for (const line of lines) {
      const stock = await getLocationStock(tx, line, source.id);
      const onHand = Number(stock?.quantity || 0);
      const key = `${line.itemId}\u0000${line.variantId || ""}`;
      const linked = linkedByKey.get(key) || [];
      const linkedQuantity = linked.reduce((sum, reservation) => sum + reservation.quantity, 0);
      if (linkedQuantity && linkedQuantity !== line.quantity) {
        throw new InventoryError("Transfer quantity does not match its active reservation.", 409, "TRANSFER_RESERVATION_MISMATCH");
      }
      const otherReserved = await getActiveReservations(tx, line, source.id, linked.map((reservation) => reservation.id));
      if (!stock || onHand - otherReserved < line.quantity) {
        throw new InventoryError("Transfer cannot consume stock that is reserved for another order.", 409, "INSUFFICIENT_AVAILABLE_STOCK");
      }
      await writeLocationQuantity(tx, stock, line, source.id, onHand - line.quantity);
      const destinationStock = await getLocationStock(tx, line, destination.id);
      await writeLocationQuantity(tx, destinationStock, line, destination.id, Number(destinationStock?.quantity || 0) + line.quantity);
      if (linked.length) {
        await tx.update(inventoryReservations)
          .set({ status: "transferred", updatedAt: new Date() })
          .where(inArray(inventoryReservations.id, linked.map((reservation) => reservation.id)));
      }
    }
    const [completed] = await tx.update(stockTransfers).set({ status: "completed", completedAt: new Date() })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, "draft"))).returning();
    if (!completed) throw new InventoryError("Transfer state changed while completing.", 409, "TRANSFER_STATE_CHANGED");
    return completed;
  });
}

export async function cancelInventoryTransfer(id: string) {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`SELECT * FROM stock_transfers WHERE id = ${id} FOR UPDATE`);
    const transfer = result.rows[0] as any;
    if (!transfer) return undefined;
    if (transfer.status === "completed") {
      throw new InventoryError("A completed transfer cannot be cancelled; process a return transfer.", 409, "TRANSFER_ALREADY_COMPLETED");
    }
    if (transfer.status === "cancelled") {
      const [row] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id));
      return row;
    }
    const linked = await tx.select().from(inventoryReservations).where(and(
      eq(inventoryReservations.transferId, id),
      eq(inventoryReservations.status, "reserved"),
    ));
    const lines = normalizeLines(linked.map((reservation: any) => ({
      itemId: reservation.itemId,
      variantId: reservation.variantId,
      quantity: reservation.quantity,
    })));
    if (lines.length) await lockInventoryEntities(tx, lines);
    if (linked.length) {
      await tx.update(inventoryReservations)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(inArray(inventoryReservations.id, linked.map((reservation: any) => reservation.id)));
    }
    const [cancelled] = await tx.update(stockTransfers)
      .set({ status: "cancelled" })
      .where(and(eq(stockTransfers.id, id), eq(stockTransfers.status, "draft")))
      .returning();
    return cancelled;
  });
}

export async function getTransferReservation(id: string) {
  const [reservation] = await db.select().from(inventoryReservations)
    .where(eq(inventoryReservations.id, id)).limit(1);
  return reservation;
}

export async function getReservationSearchResults(query: string) {
  const term = query.trim();
  const activeItems = await db.select().from(items)
    .where(and(
      eq(items.active, true),
      term
        ? or(ilike(items.name, `%${term}%`), ilike(items.sku, `%${term}%`), ilike(items.barcode, `%${term}%`))
        : sql`true`,
    ))
    .orderBy(items.name)
    .limit(80);
  const itemIds = activeItems.map((item: any) => item.id);
  if (!itemIds.length) return { items: [] };
  const [locations, variants, stocks, reservations] = await Promise.all([
    db.select().from(posLocations).where(eq(posLocations.active, true)).orderBy(posLocations.name),
    db.select().from(itemVariants).where(and(inArray(itemVariants.itemId, itemIds), eq(itemVariants.active, true))),
    db.select().from(itemLocationStock).where(inArray(itemLocationStock.itemId, itemIds)),
    db.select({
      itemId: inventoryReservations.itemId,
      variantId: inventoryReservations.variantId,
      locationId: inventoryReservations.sourceLocationId,
      quantity: sql<number>`sum(${inventoryReservations.quantity})`,
    }).from(inventoryReservations).where(and(
      inArray(inventoryReservations.itemId, itemIds),
      eq(inventoryReservations.status, "reserved"),
    )).groupBy(inventoryReservations.itemId, inventoryReservations.variantId, inventoryReservations.sourceLocationId),
  ]);
  const locationById = new Map(locations.map((location: any) => [location.id, location]));
  const reservationByKey = new Map<string, number>();
  for (const row of reservations as any[]) {
    reservationByKey.set(`${row.itemId}\u0000${row.variantId || ""}\u0000${row.locationId}`, Number(row.quantity || 0));
  }
  const stockByKey = new Map<string, number>();
  const duplicateStockKeys = new Set<string>();
  for (const row of stocks as any[]) {
    const key = `${row.itemId}\u0000${row.variantId || ""}\u0000${row.locationId}`;
    if (stockByKey.has(key)) duplicateStockKeys.add(key);
    stockByKey.set(key, (stockByKey.get(key) || 0) + Number(row.quantity || 0));
  }
  const variantsByItem = new Map<string, any[]>();
  for (const variant of variants as any[]) variantsByItem.set(variant.itemId, [...(variantsByItem.get(variant.itemId) || []), variant]);
  const stockFor = (itemId: string, variantId: string | null) => locations.map((location: any) => {
    const key = `${itemId}\u0000${variantId || ""}\u0000${location.id}`;
    const onHand = stockByKey.get(key) || 0;
    const reserved = reservationByKey.get(key) || 0;
    return {
      locationId: location.id,
      locationName: location.name,
      onHand,
      reserved,
      available: duplicateStockKeys.has(key) ? 0 : Math.max(0, onHand - reserved),
    };
  });
  return {
    items: activeItems.map((item: any) => {
      const itemVariants = variantsByItem.get(item.id) || [];
      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        variants: itemVariants.map((variant: any) => ({
          id: variant.id,
          label: [variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(" / "),
          sku: variant.sku,
        })),
        locations: stockFor(item.id, null),
        variantLocations: itemVariants.flatMap((variant: any) =>
          stockFor(item.id, variant.id).map((stock: any) => ({ variantId: variant.id, ...stock })),
        ),
      };
    }),
  };
}

export async function getReservationsForDestination(destinationLocationId: string) {
  const sourceLocation = alias(posLocations, "reservation_source");
  return db.select({
    id: inventoryReservations.id,
    itemId: inventoryReservations.itemId,
    variantId: inventoryReservations.variantId,
    sourceLocationId: inventoryReservations.sourceLocationId,
    destinationLocationId: inventoryReservations.destinationLocationId,
    quantity: inventoryReservations.quantity,
    customerName: inventoryReservations.customerName,
    transferId: inventoryReservations.transferId,
    status: inventoryReservations.status,
    createdAt: inventoryReservations.createdAt,
    itemName: items.name,
    sourceLocationName: sourceLocation.name,
  }).from(inventoryReservations)
    .innerJoin(items, eq(items.id, inventoryReservations.itemId))
    .innerJoin(sourceLocation, eq(sourceLocation.id, inventoryReservations.sourceLocationId))
    .where(and(
      eq(inventoryReservations.destinationLocationId, destinationLocationId),
      eq(inventoryReservations.status, "reserved"),
    ))
    .orderBy(inventoryReservations.createdAt);
}

export async function getAvailableAtLocation(locationId: string) {
  if (locationId === POOLED_ONLINE_LOCATION_ID) {
    const rows = await db.execute(sql`
      SELECT stock.item_id AS "itemId", stock.variant_id AS "variantId",
        stock.on_hand AS "onHand", COALESCE(holds.reserved, 0)::int AS reserved
      FROM (
        SELECT ils.item_id, ils.variant_id, SUM(ils.quantity)::int AS on_hand
        FROM item_location_stock ils
        JOIN pos_locations location ON location.id = ils.location_id AND location.active = true
        GROUP BY ils.item_id, ils.variant_id
      ) stock
      JOIN items i ON i.id = stock.item_id AND i.active = true
      LEFT JOIN (
        SELECT r.item_id, r.variant_id, SUM(r.quantity)::int AS reserved
        FROM inventory_reservations r
        JOIN pos_locations location ON location.id = r.source_location_id AND location.active = true
        WHERE r.status = 'reserved'
        GROUP BY r.item_id, r.variant_id
      ) holds ON holds.item_id = stock.item_id
        AND holds.variant_id IS NOT DISTINCT FROM stock.variant_id
    `);
    return (rows.rows as any[]).map((row) => ({
      itemId: row.itemId,
      variantId: row.variantId,
      onHand: Number(row.onHand),
      reserved: Number(row.reserved),
      available: Math.max(0, Number(row.onHand) - Number(row.reserved)),
    }));
  }
  const rows = await db.execute(sql`
    WITH stock AS (
      SELECT item_id, variant_id, location_id,
        SUM(quantity)::int AS on_hand, COUNT(*)::int AS stock_records
      FROM item_location_stock
      WHERE location_id = ${locationId}
      GROUP BY item_id, variant_id, location_id
    ), holds AS (
      SELECT item_id, variant_id, source_location_id,
        SUM(quantity)::int AS reserved
      FROM inventory_reservations
      WHERE status = 'reserved' AND source_location_id = ${locationId}
      GROUP BY item_id, variant_id, source_location_id
    )
    SELECT s.item_id AS "itemId", s.variant_id AS "variantId", s.on_hand AS "onHand",
      COALESCE(h.reserved, 0)::int AS reserved, s.stock_records AS "stockRecords"
    FROM stock s
    JOIN items i ON i.id = s.item_id AND i.active = true
    LEFT JOIN item_variants v ON v.id = s.variant_id
    LEFT JOIN holds h ON h.item_id = s.item_id
      AND h.variant_id IS NOT DISTINCT FROM s.variant_id
      AND h.source_location_id = s.location_id
    WHERE s.variant_id IS NULL OR v.active = true
  `);
  return (rows.rows as any[]).map((row) => ({
    itemId: row.itemId,
    variantId: row.variantId,
    onHand: Number(row.onHand),
    reserved: Number(row.reserved),
    available: Number(row.stockRecords) === 1
      ? Math.max(0, Number(row.onHand) - Number(row.reserved))
      : 0,
  }));
}

export async function getOnlineFulfillmentLocation() {
  const locations = await db.select().from(posLocations).where(and(
    eq(posLocations.active, true),
    eq(posLocations.isDefaultReceiving, true),
  )).limit(2);
  if (locations.length > 1) {
    throw new InventoryError(
      "Online ordering is unavailable: configure at most one active default receiving location.",
      503,
      "ONLINE_FULFILLMENT_LOCATION_UNCONFIGURED",
    );
  }
  if (locations.length === 1) return locations[0];
  const [active] = await db.select().from(posLocations).where(eq(posLocations.active, true)).limit(1);
  if (!active) throw new InventoryError("Online ordering requires an active stock location.", 503, "ONLINE_FULFILLMENT_LOCATION_UNCONFIGURED");
  // Until the merchant chooses a single fulfillment shop, allocate each ordered
  // item to a shop with unreserved stock instead of assigning all orders to one.
  return { ...active, id: POOLED_ONLINE_LOCATION_ID, name: "Available shops" };
}