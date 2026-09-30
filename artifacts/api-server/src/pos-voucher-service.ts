import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import {
  db,
  items,
  posCashiers,
  posGiftVoucherAuthFailures,
  posGiftVoucherLedger,
  posGiftVoucherOperations,
  posGiftVouchers,
  posLocations,
  posLayoutButtons,
  posOrderLines,
  posOrders,
  posReturnOrderLines,
  posReturnOrders,
  posTerminals,
  systemSettings,
  type PosTerminal,
} from "@workspace/db";
import { consumeLocationStockInTransaction } from "./inventory-reservations";

export const POS_GIFT_VOUCHER_MAX_SALE_CENTS = 100_000;
const MAX_ORDER_TOTAL_CENTS = 10_000_000;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_PER_REMOTE = 5;
const AUTH_MAX_PER_TERMINAL = 50;
const SERIAL_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CURRENCY = "EUR";

export class PosVoucherError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PosVoucherError";
  }
}

export function matchesVoucherDeviceKey(storedHash: string | null | undefined, deviceKey: string | undefined): boolean {
  const hashIsValid = !!storedHash && /^[a-f0-9]{64}$/i.test(storedHash);
  const expectedHash = hashIsValid ? Buffer.from(storedHash!, "hex") : Buffer.alloc(32);
  const suppliedHash = createHash("sha256").update(deviceKey ?? "").digest();
  const hashMatches = timingSafeEqual(expectedHash, suppliedHash);
  return hashIsValid && !!deviceKey && /^[A-Za-z0-9_-]{43}$/.test(deviceKey) && hashMatches;
}

export async function rotateVoucherDeviceKey(terminalId: string): Promise<string> {
  const deviceKey = randomBytes(32).toString("base64url");
  const voucherDeviceKeyHash = createHash("sha256").update(deviceKey).digest("hex");
  const [terminal] = await db.update(posTerminals)
    .set({ voucherDeviceKeyHash })
    .where(eq(posTerminals.id, terminalId))
    .returning({ id: posTerminals.id });
  if (!terminal) throw new PosVoucherError(404, "POS terminal was not found");
  return deviceKey;
}

export type VoucherCashierInput = {
  terminal: PosTerminal;
  cashierId: string;
  pin: string;
  remoteAddress: string;
};

export type VoucherIssuedForPrint = {
  serial: string;
  amountCents: number;
  balanceCents: number;
  currency: "EUR";
};

export type VoucherSaleResult = {
  operation: "sale";
  orderNumber: string;
  voucher: VoucherIssuedForPrint;
};

export type VoucherReturnResult = {
  operation: "return";
  orderNumber: string;
  returnOrderId: string;
  refundAmountCents: number;
  voucher: VoucherIssuedForPrint;
};

export type VoucherRedeemResult = {
  operation: "redeem";
  orderNumber: string;
  totalCents: number;
  voucherAppliedCents: number;
  cashPaidCents: number;
  changeDueCents: number;
  replacementVoucher: VoucherIssuedForPrint | null;
};

export type ReturnPreview = {
  orderNumber: string;
  currency: "EUR";
  totalRefundableCents: number;
  lines: Array<{
    lineId: string;
    itemId: string | null;
    description: string;
    soldQuantityMilli: number;
    returnedQuantityMilli: number;
    remainingQuantityMilli: number;
    unitPriceCents: number;
    vatRate: string;
    refundableAmountCents: number;
  }>;
};

function centsToMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new PosVoucherError(400, "Money amount must be a whole number of cents");
  return (cents / 100).toFixed(2);
}

function moneyToCents(value: string | number): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new PosVoucherError(409, "Stored POS order has an invalid amount");
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 0.000001 || !Number.isSafeInteger(cents)) {
    throw new PosVoucherError(409, "Stored POS order contains fractional cents");
  }
  return cents;
}

function parseMilliQuantity(value: string | number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) {
    throw new PosVoucherError(400, "Return quantity must be a positive amount");
  }
  const milli = Math.round(amount * 1_000);
  if (!Number.isSafeInteger(milli) || Math.abs(amount * 1_000 - milli) > 0.000001) {
    throw new PosVoucherError(400, "Return quantity must use no more than three decimal places");
  }
  return milli;
}

function formatMilliQuantity(milli: number): string {
  return (milli / 1_000).toFixed(3);
}

function sessionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new PosVoucherError(503, "Voucher printing is unavailable until a stable SESSION_SECRET is configured");
  return createHash("sha256").update("globipos-pos-voucher-response-v1\0").update(secret).digest();
}

function encryptResponse(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    responseCiphertext: ciphertext.toString("base64"),
    responseIv: iv.toString("hex"),
    responseTag: cipher.getAuthTag().toString("hex"),
  };
}

function decryptResponse(operation: typeof posGiftVoucherOperations.$inferSelect): unknown {
  if (!operation.responseCiphertext || !operation.responseIv || !operation.responseTag) {
    throw new PosVoucherError(503, "The committed voucher print record is incomplete; contact support before retrying");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), Buffer.from(operation.responseIv, "hex"));
    decipher.setAuthTag(Buffer.from(operation.responseTag, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(operation.responseCiphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch {
    throw new PosVoucherError(503, "The voucher reprint record could not be decrypted; contact support before retrying");
  }
}

function serialCheckDigit(payload: string): string {
  // A compact checksum catches common cashier keying errors before database lookup.
  let remainder = 0;
  for (const char of payload) remainder = (remainder * 32 + SERIAL_ALPHABET.indexOf(char)) % 32;
  return SERIAL_ALPHABET[remainder];
}

function randomVoucherSerial(): string {
  const bytes = randomBytes(16);
  let bitBuffer = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += SERIAL_ALPHABET[(bitBuffer >> bitCount) & 31];
    }
  }
  if (bitCount > 0) encoded += SERIAL_ALPHABET[(bitBuffer << (5 - bitCount)) & 31];
  // 128 bits encode to 26 base32 characters; the final two bits must be zero.
  const payload = encoded.slice(0, 26);
  const raw = `GV${payload}${serialCheckDigit(payload)}`;
  return `GV-${raw.slice(2, 7)}-${raw.slice(7, 12)}-${raw.slice(12, 17)}-${raw.slice(17, 22)}-${raw.slice(22, 27)}-${raw.slice(27)}`;
}

function normalizeVoucherSerial(value: string): string {
  const raw = value.toUpperCase().replace(/[\s-]/g, "");
  if (!/^GV[0-9A-HJKMNP-TV-Z]{27}$/.test(raw) ||
      raw[28] !== serialCheckDigit(raw.slice(2, 28))) {
    throw new PosVoucherError(400, "Voucher serial is invalid");
  }
  return raw;
}

function serialHash(serial: string): string {
  return createHash("sha256").update(normalizeVoucherSerial(serial)).digest("hex");
}

function serialSuffix(serial: string): string {
  return normalizeVoucherSerial(serial).slice(-8);
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function responseVoucher(serial: string, amountCents: number): VoucherIssuedForPrint {
  return { serial, amountCents, balanceCents: amountCents, currency: CURRENCY };
}

function validateIdempotencyKey(key: string): void {
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new PosVoucherError(400, "Idempotency key must be 8–128 letters, digits, dots, underscores, colons or hyphens");
  }
}

async function authorizeCashier(input: VoucherCashierInput) {
  if (!/^\d{4,8}$/.test(input.pin)) throw new PosVoucherError(401, "Cashier PIN is invalid");
  if (!input.terminal.active) throw new PosVoucherError(403, "Terminal is inactive");
  const key = sessionKey();
  const remoteKeyHash = createHmac("sha256", key)
    .update(input.terminal.id)
    .update("\0")
    .update(input.remoteAddress || "unknown")
    .digest("hex");
  const now = new Date();
  const windowStart = new Date(now.getTime() - AUTH_WINDOW_MS);

  const result = await db.transaction(async (tx) => {
    // Serialize PIN attempts by terminal to make the persistent limits effective
    // across API workers, not just within one Node process.
    const [terminal] = await tx.select({
      id: posTerminals.id,
      locationId: posTerminals.locationId,
      active: posTerminals.active,
    }).from(posTerminals).where(eq(posTerminals.id, input.terminal.id)).for("update");
    if (!terminal?.active || terminal.locationId !== input.terminal.locationId) {
      return { error: new PosVoucherError(403, "Terminal is inactive or its location has changed") };
    }
    const [location] = await tx.select({
      id: posLocations.id,
      active: posLocations.active,
    }).from(posLocations).where(eq(posLocations.id, terminal.locationId)).for("update");
    if (!location?.active) return { error: new PosVoucherError(403, "Terminal location is inactive") };
    await tx.delete(posGiftVoucherAuthFailures)
      .where(lt(posGiftVoucherAuthFailures.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1_000)));
    const [counts] = await tx.select({
      remote: sql<number>`count(*) filter (where ${posGiftVoucherAuthFailures.remoteKeyHash} = ${remoteKeyHash})::int`,
      terminal: sql<number>`count(*)::int`,
    }).from(posGiftVoucherAuthFailures).where(and(
      eq(posGiftVoucherAuthFailures.terminalId, terminal.id),
      gte(posGiftVoucherAuthFailures.createdAt, windowStart),
    ));
    if (counts.terminal >= AUTH_MAX_PER_TERMINAL || counts.remote >= AUTH_MAX_PER_REMOTE) {
      return { error: new PosVoucherError(429, "Too many failed voucher PIN attempts; try again later") };
    }

    const [cashier] = await tx.select().from(posCashiers).where(and(
      eq(posCashiers.id, input.cashierId),
      eq(posCashiers.active, true),
    ));
    const storedHash = cashier?.pin ?? "";
    const suppliedHash = createHash("sha256").update(input.pin).digest();
    const expectedHash = /^[a-f0-9]{64}$/i.test(storedHash) ? Buffer.from(storedHash, "hex") : Buffer.alloc(0);
    const pinMatches = expectedHash.length === suppliedHash.length && timingSafeEqual(expectedHash, suppliedHash);
    const locationMatches = !!cashier && (!cashier.locationId || cashier.locationId === terminal.locationId);
    if (!cashier || !pinMatches || !locationMatches) {
      await tx.insert(posGiftVoucherAuthFailures).values({ terminalId: terminal.id, remoteKeyHash });
      return { error: new PosVoucherError(401, "Cashier PIN or terminal authorization is invalid") };
    }
    return { cashier };
  });
  if ("error" in result) throw result.error;
  return result.cashier;
}

async function assertCashierAndFunction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: VoucherCashierInput,
  cashierId: string,
  actionCode: "GIFT_VOUCHER" | "PAY_VOUCHER",
) {
  const [terminal] = await tx.select().from(posTerminals)
    .where(eq(posTerminals.id, input.terminal.id))
    .for("share");
  if (!terminal?.active || terminal.locationId !== input.terminal.locationId) {
    throw new PosVoucherError(403, "Terminal is inactive or its location has changed");
  }
  if (!terminal.layoutSetId) {
    throw new PosVoucherError(403, `Assign and approve the ${actionCode} function on this terminal layout first`);
  }
  const [cashier] = await tx.select().from(posCashiers).where(and(
    eq(posCashiers.id, cashierId),
    eq(posCashiers.active, true),
  )).for("share");
  const pinHash = cashier?.pin ?? "";
  const suppliedHash = createHash("sha256").update(input.pin).digest();
  const expectedHash = /^[a-f0-9]{64}$/i.test(pinHash) ? Buffer.from(pinHash, "hex") : Buffer.alloc(0);
  if (!cashier || (cashier.locationId && cashier.locationId !== terminal.locationId) ||
      expectedHash.length !== suppliedHash.length || !timingSafeEqual(expectedHash, suppliedHash)) {
    throw new PosVoucherError(401, "Cashier PIN or terminal authorization changed; verify and retry");
  }

  const buttons = await tx.select({ actionCode: posLayoutButtons.actionCode })
    .from(posLayoutButtons)
    .where(and(
      eq(posLayoutButtons.layoutSetId, terminal.layoutSetId),
      eq(posLayoutButtons.buttonType, "action"),
      eq(posLayoutButtons.actionCode, actionCode),
    ))
    .for("share");
  if (buttons.length === 0) {
    throw new PosVoucherError(403, `Assign and approve the ${actionCode} function on this terminal layout first`);
  }
  const functionKey = `pos_function_definition_${actionCode.toLowerCase()}`;
  const [setting] = await tx.select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, functionKey))
    .for("share");
  let approved = false;
  try {
    approved = JSON.parse(setting?.value ?? "null")?.approved === true;
  } catch {
    approved = false;
  }
  if (!approved) {
    throw new PosVoucherError(403, `${actionCode} must be approved in POS Functions before it can issue or redeem vouchers`);
  }
  return terminal;
}

type OperationType = "sale" | "return" | "redeem";

async function claimOperation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  terminalId: string,
  idempotencyKey: string,
  operationType: OperationType,
  requestHash: string,
) {
  const inserted = await tx.insert(posGiftVoucherOperations).values({
    terminalId,
    idempotencyKey,
    operationType,
    requestHash,
    status: "processing",
  }).onConflictDoNothing({
    target: [posGiftVoucherOperations.terminalId, posGiftVoucherOperations.idempotencyKey],
  }).returning();
  if (inserted[0]) return { operation: inserted[0], replay: null };

  const [existing] = await tx.select().from(posGiftVoucherOperations).where(and(
    eq(posGiftVoucherOperations.terminalId, terminalId),
    eq(posGiftVoucherOperations.idempotencyKey, idempotencyKey),
  )).for("update");
  if (!existing) throw new PosVoucherError(503, "Voucher request is being retried; please try again");
  if (existing.requestHash !== requestHash || existing.operationType !== operationType) {
    throw new PosVoucherError(409, "Idempotency key was already used with a different request");
  }
  if (existing.status !== "completed") throw new PosVoucherError(409, "Voucher request is still being processed");
  return { operation: existing, replay: decryptResponse(existing) };
}

async function completeOperation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  operationId: string,
  response: unknown,
) {
  const encrypted = encryptResponse(response);
  await tx.update(posGiftVoucherOperations).set({
    ...encrypted,
    status: "completed",
  }).where(eq(posGiftVoucherOperations.id, operationId));
}

async function createVoucher(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    amountCents: number;
    reason: "sale" | "return" | "residual";
    terminal: PosTerminal;
    cashierId: string;
    operationId: string;
    relatedOrderId?: string;
    relatedReturnOrderId?: string;
  },
): Promise<{ row: typeof posGiftVouchers.$inferSelect; serial: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const serial = randomVoucherSerial();
    const inserted = await tx.insert(posGiftVouchers).values({
      serialHash: serialHash(serial),
      serialSuffix: serialSuffix(serial),
      originalAmountCents: args.amountCents,
      balanceCents: args.amountCents,
      issuedReason: args.reason,
      terminalId: args.terminal.id,
      locationId: args.terminal.locationId,
      cashierId: args.cashierId,
      sourceOrderId: args.relatedOrderId ?? null,
      sourceReturnOrderId: args.relatedReturnOrderId ?? null,
    }).onConflictDoNothing({ target: posGiftVouchers.serialHash }).returning();
    if (inserted[0]) return { row: inserted[0], serial };
  }
  throw new PosVoucherError(503, "Could not create a unique voucher serial; retry the request");
}

async function insertLedger(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    voucherId: string;
    operationId: string;
    eventType: "sale_issue" | "return_issue" | "redemption" | "serial_retirement" | "residual_issue";
    amountCents: number;
    balanceAfterCents: number;
    terminal: PosTerminal;
    cashierId: string;
    relatedOrderId?: string;
    relatedReturnOrderId?: string;
  },
) {
  await tx.insert(posGiftVoucherLedger).values({
    voucherId: args.voucherId,
    operationId: args.operationId,
    eventType: args.eventType,
    amountCents: args.amountCents,
    balanceAfterCents: args.balanceAfterCents,
    relatedOrderId: args.relatedOrderId ?? null,
    relatedReturnOrderId: args.relatedReturnOrderId ?? null,
    terminalId: args.terminal.id,
    cashierId: args.cashierId,
  });
}

function createOrderNumber(prefix: "GV" | "GVR" | "GVS"): string {
  return `${prefix}-${Date.now()}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function asCashierInput(input: VoucherCashierInput) {
  return {
    terminal: input.terminal,
    cashierId: input.cashierId,
    pin: input.pin,
    remoteAddress: input.remoteAddress,
  };
}

export async function issueCashGiftVoucher(
  input: VoucherCashierInput & { amountCents: number; idempotencyKey: string },
): Promise<VoucherSaleResult> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > POS_GIFT_VOUCHER_MAX_SALE_CENTS) {
    throw new PosVoucherError(400, `Voucher amount must be from 1 to ${POS_GIFT_VOUCHER_MAX_SALE_CENTS} cents`);
  }
  validateIdempotencyKey(input.idempotencyKey);
  const cashier = await authorizeCashier(asCashierInput(input));
  const requestHash = hashRequest({ operation: "sale", amountCents: input.amountCents, cashierId: cashier.id });

  return db.transaction(async (tx) => {
    await assertCashierAndFunction(tx, input, cashier.id, "GIFT_VOUCHER");
    const { operation, replay } = await claimOperation(tx, input.terminal.id, input.idempotencyKey, "sale", requestHash);
    if (replay) return replay as VoucherSaleResult;
    const amount = centsToMoney(input.amountCents);
    const orderNumber = createOrderNumber("GV");
    const [order] = await tx.insert(posOrders).values({
      orderNumber,
      terminalId: input.terminal.id,
      locationId: input.terminal.locationId,
      cashierId: cashier.id,
      cashierName: cashier.name,
      subtotal: amount,
      vatAmount: "0.00",
      discountAmount: "0.00",
      total: amount,
      paymentMethod: "gift_voucher_cash",
      amountTendered: amount,
      changeDue: "0.00",
      status: "completed",
      receiptPrinted: false,
      syncedAt: new Date(),
      notes: "Cash-paid gift voucher issue; voucher value recorded as a liability",
    }).returning();
    await tx.insert(posOrderLines).values({
      orderId: order.id,
      itemId: null,
      variantId: null,
      description: "Cash-paid gift voucher",
      sku: null,
      barcode: null,
      quantity: "1",
      unitPrice: amount,
      vatRate: "0.00",
      discountPercent: "0.00",
      total: amount,
    });
    const created = await createVoucher(tx, {
      amountCents: input.amountCents,
      reason: "sale",
      terminal: input.terminal,
      cashierId: cashier.id,
      operationId: operation.id,
      relatedOrderId: order.id,
    });
    await insertLedger(tx, {
      voucherId: created.row.id,
      operationId: operation.id,
      eventType: "sale_issue",
      amountCents: input.amountCents,
      balanceAfterCents: input.amountCents,
      terminal: input.terminal,
      cashierId: cashier.id,
      relatedOrderId: order.id,
    });
    const response: VoucherSaleResult = {
      operation: "sale",
      orderNumber,
      voucher: responseVoucher(created.serial, input.amountCents),
    };
    await completeOperation(tx, operation.id, response);
    return response;
  });
}

type ReturnLineSelection = { lineId: string; quantity: number };

type LockedReturnLine = {
  id: string;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  vatRate: string;
  discountPercent: string;
};

async function loadReturnLines(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  order: { id: string; orderNumber: string },
) {
  const orderLines = await tx.select().from(posOrderLines).where(eq(posOrderLines.orderId, order.id));
  if (orderLines.length === 0) throw new PosVoucherError(409, "This POS order has no returnable sale lines");
  const priorReturns = await tx.select({
    originalLineId: posReturnOrderLines.originalLineId,
    quantity: posReturnOrderLines.qty,
    lineTotal: posReturnOrderLines.lineTotal,
  }).from(posReturnOrderLines).innerJoin(
    posReturnOrders,
    eq(posReturnOrderLines.returnOrderId, posReturnOrders.id),
  ).where(and(
    eq(posReturnOrders.status, "completed"),
    or(
      eq(posReturnOrders.originalOrderId, order.id),
      eq(posReturnOrders.originalOrderNumber, order.orderNumber),
    ),
  ));
  const returnedByLine = new Map<string, number>();
  const returnedAmountByLine = new Map<string, number>();
  for (const row of priorReturns) {
    if (!row.originalLineId) continue;
    const milli = parseMilliQuantity(row.quantity);
    returnedByLine.set(row.originalLineId, (returnedByLine.get(row.originalLineId) ?? 0) + milli);
    returnedAmountByLine.set(
      row.originalLineId,
      (returnedAmountByLine.get(row.originalLineId) ?? 0) + moneyToCents(row.lineTotal),
    );
  }
  const lines = orderLines.map((line) => {
    const soldMilli = parseMilliQuantity(line.quantity);
    const returnedMilli = returnedByLine.get(line.id) ?? 0;
    const remainingMilli = Math.max(0, soldMilli - returnedMilli);
    const unitPriceCents = moneyToCents(line.unitPrice);
    const originalLineTotalCents = moneyToCents(line.total);
    const remainingLineTotalCents = Math.max(
      0,
      originalLineTotalCents - (returnedAmountByLine.get(line.id) ?? 0),
    );
    return {
      source: line as LockedReturnLine,
      id: line.id,
      itemId: line.itemId,
      description: line.description,
      soldMilli,
      returnedMilli,
      remainingMilli,
      unitPriceCents,
      vatRate: line.vatRate,
      originalLineTotalCents,
      totalRemainingCents: remainingLineTotalCents,
    };
  });
  return { lines, returnedByLine };
}

async function getCompletedOrderForReturn(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  terminal: PosTerminal,
  orderNumber: string,
  lock: boolean,
) {
  const query = tx.select().from(posOrders).where(and(
    eq(posOrders.orderNumber, orderNumber),
    eq(posOrders.locationId, terminal.locationId),
    eq(posOrders.status, "completed"),
  ));
  const [order] = lock ? await query.for("update") : await query.limit(1);
  if (!order) throw new PosVoucherError(404, "No completed POS sale was found for this order number at this location");
  return order;
}

function buildReturnPreview(orderNumber: string, lines: Awaited<ReturnType<typeof loadReturnLines>>["lines"]): ReturnPreview {
  return {
    orderNumber,
    currency: CURRENCY,
    totalRefundableCents: lines.reduce((sum, line) => sum + line.totalRemainingCents, 0),
    lines: lines.map((line) => ({
      lineId: line.id,
      itemId: line.itemId,
      description: line.description,
      soldQuantityMilli: line.soldMilli,
      returnedQuantityMilli: line.returnedMilli,
      remainingQuantityMilli: line.remainingMilli,
      unitPriceCents: line.unitPriceCents,
      vatRate: line.vatRate,
      refundableAmountCents: line.totalRemainingCents,
    })),
  };
}

export async function previewVoucherReturn(
  input: VoucherCashierInput & { orderNumber: string },
): Promise<ReturnPreview> {
  const cashier = await authorizeCashier(asCashierInput(input));
  const normalizedOrderNumber = input.orderNumber.trim();
  if (!normalizedOrderNumber || normalizedOrderNumber.length > 128) {
    throw new PosVoucherError(400, "A valid original POS order number is required");
  }
  return db.transaction(async (tx) => {
    await assertCashierAndFunction(tx, input, cashier.id, "GIFT_VOUCHER");
    const order = await getCompletedOrderForReturn(tx, input.terminal, normalizedOrderNumber, false);
    const { lines } = await loadReturnLines(tx, order);
    return buildReturnPreview(order.orderNumber, lines);
  });
}

export async function issueVoucherReturn(
  input: VoucherCashierInput & {
    orderNumber: string;
    lines: ReturnLineSelection[];
    idempotencyKey: string;
  },
): Promise<VoucherReturnResult> {
  validateIdempotencyKey(input.idempotencyKey);
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 200) {
    throw new PosVoucherError(400, "Select at least one sale line to return");
  }
  const normalizedOrderNumber = input.orderNumber.trim();
  if (!normalizedOrderNumber || normalizedOrderNumber.length > 128) {
    throw new PosVoucherError(400, "A valid original POS order number is required");
  }
  const selections = input.lines.map((line) => ({
    lineId: line.lineId,
    quantityMilli: parseMilliQuantity(line.quantity),
  })).sort((a, b) => a.lineId.localeCompare(b.lineId));
  if (new Set(selections.map((line) => line.lineId)).size !== selections.length) {
    throw new PosVoucherError(400, "A return cannot select the same sale line more than once");
  }
  const cashier = await authorizeCashier(asCashierInput(input));
  const requestHash = hashRequest({
    operation: "return",
    orderNumber: normalizedOrderNumber,
    lines: selections,
    cashierId: cashier.id,
  });

  return db.transaction(async (tx) => {
    await assertCashierAndFunction(tx, input, cashier.id, "GIFT_VOUCHER");
    const { operation, replay } = await claimOperation(tx, input.terminal.id, input.idempotencyKey, "return", requestHash);
    if (replay) return replay as VoucherReturnResult;
    const original = await getCompletedOrderForReturn(tx, input.terminal, normalizedOrderNumber, true);
    const { lines: returnableLines } = await loadReturnLines(tx, original);
    const lineById = new Map(returnableLines.map((line) => [line.id, line]));
    let refundCents = 0;
    const selected = selections.map((selection) => {
      const line = lineById.get(selection.lineId);
      if (!line || selection.quantityMilli > line.remainingMilli) {
        throw new PosVoucherError(409, "A selected quantity exceeds the remaining quantity on the original sale");
      }
      const refundedBeforeCents = Math.round(line.originalLineTotalCents * line.returnedMilli / line.soldMilli);
      const refundedAfterCents = Math.round(
        line.originalLineTotalCents * (line.returnedMilli + selection.quantityMilli) / line.soldMilli,
      );
      const lineRefundCents = Math.min(
        line.totalRemainingCents,
        refundedAfterCents - refundedBeforeCents,
      );
      if (lineRefundCents <= 0) throw new PosVoucherError(409, "A selected sale line has no refundable value");
      refundCents += lineRefundCents;
      return { line, quantityMilli: selection.quantityMilli, lineRefundCents };
    });
    if (refundCents <= 0 || refundCents > MAX_ORDER_TOTAL_CENTS) {
      throw new PosVoucherError(409, "The selected return has no valid refundable value");
    }

    const returnOrderNumber = createOrderNumber("GVR");
    const [returnOrder] = await tx.insert(posReturnOrders).values({
      originalOrderId: original.id,
      originalOrderNumber: original.orderNumber,
      terminalId: input.terminal.id,
      locationId: input.terminal.locationId,
      cashierId: cashier.id,
      cashierName: cashier.name,
      refundMethod: "store_credit",
      refundTotal: centsToMoney(refundCents),
      notes: `Gift voucher credit note ${returnOrderNumber}`,
      status: "completed",
      syncedAt: new Date(),
    }).returning();
    await tx.insert(posReturnOrderLines).values(selected.map(({ line, quantityMilli, lineRefundCents }) => ({
      returnOrderId: returnOrder.id,
      originalOrderId: original.id,
      originalLineId: line.id,
      productId: line.itemId,
      description: line.description,
      qty: formatMilliQuantity(quantityMilli),
      unitPrice: centsToMoney(line.unitPriceCents),
      lineTotal: centsToMoney(lineRefundCents),
      restocked: false,
    })));
    const returnVoucher = await createVoucher(tx, {
      amountCents: refundCents,
      reason: "return",
      terminal: input.terminal,
      cashierId: cashier.id,
      operationId: operation.id,
      relatedReturnOrderId: returnOrder.id,
    });
    await insertLedger(tx, {
      voucherId: returnVoucher.row.id,
      operationId: operation.id,
      eventType: "return_issue",
      amountCents: refundCents,
      balanceAfterCents: refundCents,
      terminal: input.terminal,
      cashierId: cashier.id,
      relatedReturnOrderId: returnOrder.id,
    });
    const response: VoucherReturnResult = {
      operation: "return",
      orderNumber: returnOrderNumber,
      returnOrderId: returnOrder.id,
      refundAmountCents: refundCents,
      voucher: responseVoucher(returnVoucher.serial, refundCents),
    };
    await completeOperation(tx, operation.id, response);
    return response;
  });
}

type PricedSaleLine = {
  itemId: string;
  quantity: number;
  description: string;
  sku: string;
  netCents: number;
  vatCents: number;
  grossCents: number;
  unitPriceCents: number;
  vatRate: number;
};

async function priceSaleLines(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  requestedLines: Array<{ itemId: string; quantity: number }>,
  priceLevel: number,
): Promise<PricedSaleLine[]> {
  if (!Array.isArray(requestedLines) || requestedLines.length === 0 || requestedLines.length > 200) {
    throw new PosVoucherError(400, "A voucher redemption requires 1–200 active sale lines");
  }
  if (!Number.isSafeInteger(priceLevel) || priceLevel < 1 || priceLevel > 5) {
    throw new PosVoucherError(503, "Terminal pricing is unavailable; configure a server price level from 1 to 5");
  }
  // The catalog sync currently sends no timedPrice field: the Terminal's
  // effectivePrice therefore uses price1 at level 1. Keep this server pricing
  // in lockstep if timed-price offers are later added to the catalog payload.
  const seen = new Set<string>();
  const saleLines: PricedSaleLine[] = [];
  for (const requested of requestedLines) {
    if (seen.has(requested.itemId)) throw new PosVoucherError(400, "Combine duplicate product lines before redeeming a voucher");
    seen.add(requested.itemId);
    if (!Number.isSafeInteger(requested.quantity) || requested.quantity < 1 || requested.quantity > 1_000) {
      throw new PosVoucherError(400, "Sale quantity must be a whole number from 1 to 1000");
    }
    const [item] = await tx.select().from(items).where(and(eq(items.id, requested.itemId), eq(items.active, true)));
    if (!item) throw new PosVoucherError(409, "A selected product is inactive or no longer exists");
    if (item.hasVariants) throw new PosVoucherError(409, `${item.name} needs a variant-specific checkout before voucher redemption`);
    const priceByLevel = [item.price1, item.price2, item.price3, item.price4, item.price5];
    const unitPriceCents = moneyToCents(priceByLevel[priceLevel - 1]);
    const vatRate = Math.round(Number(item.vatRate ?? 0) * 100) / 100;
    if (unitPriceCents <= 0 || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      throw new PosVoucherError(409, "A selected product has invalid pricing or VAT");
    }
    const grossCents = unitPriceCents * requested.quantity;
    const vatCents = vatRate > 0
      ? Math.round((grossCents - grossCents / (1 + vatRate / 100)) + Number.EPSILON)
      : 0;
    const netCents = grossCents - vatCents;
    saleLines.push({
      itemId: item.id,
      quantity: requested.quantity,
      description: item.name,
      sku: item.sku,
      netCents,
      vatCents,
      grossCents,
      unitPriceCents,
      vatRate,
    });
  }
  return saleLines;
}

export async function redeemGiftVoucher(
  input: VoucherCashierInput & {
    serial: string;
    lines: Array<{ itemId: string; quantity: number }>;
    expectedTotalCents: number;
    cashPaidCents: number;
    idempotencyKey: string;
  },
): Promise<VoucherRedeemResult> {
  validateIdempotencyKey(input.idempotencyKey);
  if (!Number.isSafeInteger(input.expectedTotalCents) || input.expectedTotalCents <= 0 ||
      input.expectedTotalCents > MAX_ORDER_TOTAL_CENTS) {
    throw new PosVoucherError(400, "Expected basket total is invalid");
  }
  if (!Number.isSafeInteger(input.cashPaidCents) || input.cashPaidCents < 0 ||
      input.cashPaidCents > MAX_ORDER_TOTAL_CENTS) {
    throw new PosVoucherError(400, "Cash tender must be a non-negative whole number of cents");
  }
  const normalizedSerial = normalizeVoucherSerial(input.serial);
  const voucherSerialHash = createHash("sha256").update(normalizedSerial).digest("hex");
  const cashier = await authorizeCashier(asCashierInput(input));
  const canonicalLines = [...input.lines]
    .map((line) => ({ itemId: line.itemId, quantity: line.quantity }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
  const requestHash = hashRequest({
    operation: "redeem",
    serialHash: voucherSerialHash,
    lines: canonicalLines,
    expectedTotalCents: input.expectedTotalCents,
    cashPaidCents: input.cashPaidCents,
    cashierId: cashier.id,
  });

  return db.transaction(async (tx) => {
    const terminal = await assertCashierAndFunction(tx, input, cashier.id, "PAY_VOUCHER");
    const { operation, replay } = await claimOperation(tx, input.terminal.id, input.idempotencyKey, "redeem", requestHash);
    if (replay) return replay as VoucherRedeemResult;
    const saleLines = await priceSaleLines(tx, input.lines, terminal.priceLevel);
    const totalCents = saleLines.reduce((sum, line) => sum + line.grossCents, 0);
    const vatCents = saleLines.reduce((sum, line) => sum + line.vatCents, 0);
    if (totalCents !== input.expectedTotalCents) {
      throw new PosVoucherError(409, `Basket price changed; the server total is ${totalCents} cents`);
    }
    await consumeLocationStockInTransaction(tx, input.terminal.locationId, saleLines.map((line) => ({
      itemId: line.itemId,
      quantity: line.quantity,
    })));
    const [voucher] = await tx.select().from(posGiftVouchers)
      .where(eq(posGiftVouchers.serialHash, voucherSerialHash))
      .for("update");
    if (!voucher || voucher.status !== "active" || voucher.balanceCents <= 0) {
      throw new PosVoucherError(409, "Voucher serial is unknown, already used, or inactive");
    }
    if (voucher.locationId !== input.terminal.locationId || voucher.currency !== CURRENCY) {
      throw new PosVoucherError(409, "Voucher is not valid at this location");
    }
    const voucherAppliedCents = Math.min(voucher.balanceCents, totalCents);
    const cashShortfallCents = totalCents - voucherAppliedCents;
    if (input.cashPaidCents < cashShortfallCents) {
      throw new PosVoucherError(400, `Collect at least ${cashShortfallCents} cents in cash to complete this sale`);
    }
    const orderNumber = createOrderNumber("GVS");
    const changeDueCents = input.cashPaidCents - cashShortfallCents;
    const [order] = await tx.insert(posOrders).values({
      orderNumber,
      terminalId: input.terminal.id,
      locationId: input.terminal.locationId,
      cashierId: cashier.id,
      cashierName: cashier.name,
      subtotal: centsToMoney(totalCents),
      vatAmount: centsToMoney(vatCents),
      discountAmount: "0.00",
      total: centsToMoney(totalCents),
      paymentMethod: cashShortfallCents > 0 ? "gift_voucher_cash" : "gift_voucher",
      amountTendered: centsToMoney(input.cashPaidCents),
      changeDue: centsToMoney(changeDueCents),
      status: "completed",
      receiptPrinted: false,
      inventoryCommitted: true,
      syncedAt: new Date(),
      notes: `Voucher ${voucher.serialSuffix} redemption; original serial consumed`,
    }).returning();
    await tx.insert(posOrderLines).values(saleLines.map((line) => ({
      orderId: order.id,
      itemId: line.itemId,
      variantId: null,
      description: line.description,
      sku: line.sku,
      barcode: null,
      quantity: String(line.quantity),
      unitPrice: centsToMoney(line.unitPriceCents),
      vatRate: line.vatRate.toFixed(2),
      discountPercent: "0.00",
      total: centsToMoney(line.grossCents),
    })));

    const remainingCents = voucher.balanceCents - voucherAppliedCents;
    await tx.update(posGiftVouchers).set({
      status: "spent",
      balanceCents: 0,
      spentAt: new Date(),
    }).where(eq(posGiftVouchers.id, voucher.id));
    await insertLedger(tx, {
      voucherId: voucher.id,
      operationId: operation.id,
      eventType: "redemption",
      amountCents: -voucherAppliedCents,
      balanceAfterCents: remainingCents,
      terminal: input.terminal,
      cashierId: cashier.id,
      relatedOrderId: order.id,
    });
    let replacementVoucher: VoucherIssuedForPrint | null = null;
    if (remainingCents > 0) {
      await insertLedger(tx, {
        voucherId: voucher.id,
        operationId: operation.id,
        eventType: "serial_retirement",
        amountCents: -remainingCents,
        balanceAfterCents: 0,
        terminal: input.terminal,
        cashierId: cashier.id,
        relatedOrderId: order.id,
      });
      const replacement = await createVoucher(tx, {
        amountCents: remainingCents,
        reason: "residual",
        terminal: input.terminal,
        cashierId: cashier.id,
        operationId: operation.id,
        relatedOrderId: order.id,
      });
      await insertLedger(tx, {
        voucherId: replacement.row.id,
        operationId: operation.id,
        eventType: "residual_issue",
        amountCents: remainingCents,
        balanceAfterCents: remainingCents,
        terminal: input.terminal,
        cashierId: cashier.id,
        relatedOrderId: order.id,
      });
      replacementVoucher = responseVoucher(replacement.serial, remainingCents);
    }
    const response: VoucherRedeemResult = {
      operation: "redeem",
      orderNumber,
      totalCents,
      voucherAppliedCents,
      cashPaidCents: input.cashPaidCents,
      changeDueCents,
      replacementVoucher,
    };
    await completeOperation(tx, operation.id, response);
    return response;
  });
}

export function assertVoucherSerialFormat(serial: string): string {
  return normalizeVoucherSerial(serial);
}