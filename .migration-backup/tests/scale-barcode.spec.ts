import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { goodsReceivedVoucherItems, goodsReceivedVoucherScanEvents, portalOrderItems } from "../shared/schema";
import { storage } from "../server/storage";
import { shouldRetryScanFailure } from "../pda-app/src/lib/scanRetry";
import {
  applyScaleBarcodeSaleValues,
  isEmbeddedPriceLabelAuthorized,
  parseScaleBarcode,
  parseScaleBarcodeAfterVariantLookup,
  resolveScaleBarcodeExactFirst,
} from "../server/barcode-utils";

function withEan13CheckDigit(data12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(data12[i]) * (i % 2 === 0 ? 1 : 3);
  return `${data12}${(10 - (sum % 10)) % 10}`;
}

test("weight barcode supplies a fractional checkout quantity", () => {
  const scale = parseScaleBarcode(withEan13CheckDigit("280123401500"));
  expect(scale).toMatchObject({ type: "weight", plu: "01234", value: 1.5 });
  expect(applyScaleBarcodeSaleValues(scale, 99, 4.2)).toEqual({ quantity: 1.5, unitPrice: 4.2 });
});

test("embedded-price barcode overrides price and cannot override quantity", () => {
  const scale = parseScaleBarcode(withEan13CheckDigit("200123400999"));
  expect(scale).toMatchObject({ type: "price", plu: "01234", value: 9.99 });
  expect(applyScaleBarcodeSaleValues(scale, 99, 4.2)).toEqual({ quantity: 1, unitPrice: 9.99 });
  expect(isEmbeddedPriceLabelAuthorized(scale, "item-1", "item-1")).toBe(true);
  expect(isEmbeddedPriceLabelAuthorized(scale, "item-1", undefined)).toBe(false);
  expect(isEmbeddedPriceLabelAuthorized(scale, "item-1", "different-item")).toBe(false);
});

test("invalid check digit is rejected", () => {
  const valid = withEan13CheckDigit("280123401500");
  const invalid = `${valid.slice(0, 12)}${(Number(valid[12]) + 1) % 10}`;
  expect(parseScaleBarcode(invalid)).toBeNull();
});

test("an exact synthesized 29-prefix variant is not treated as a weight barcode", () => {
  const synthesizedVariant = withEan13CheckDigit("290001010100");
  expect(parseScaleBarcode(synthesizedVariant)?.type).toBe("weight");
  expect(parseScaleBarcodeAfterVariantLookup(synthesizedVariant, true)).toBeNull();
});

test("fractional weight quantity persists without rounding", async () => {
  const orderId = `scale-test-order-${Date.now()}`;
  try {
    const [created] = await db.insert(portalOrderItems).values({
      orderId,
      itemId: "scale-test-item",
      itemName: "Scale persistence test",
      quantity: 1.5,
      unitPrice: "4.20",
      total: "6.30",
    }).returning();
    const [stored] = await db.select().from(portalOrderItems).where(eq(portalOrderItems.id, created.id));
    expect(stored.quantity).toBe(1.5);
  } finally {
    await db.delete(portalOrderItems).where(eq(portalOrderItems.orderId, orderId));
  }
});

test("GRV fallback never performs a second increment after an exact match", async () => {
  const code = withEan13CheckDigit("280123401500");
  const calls: string[] = [];
  const result = await resolveScaleBarcodeExactFirst(code, async (candidate) => {
    calls.push(candidate);
    return { committed: true };
  });
  expect(result).toEqual({ committed: true });
  expect(calls).toEqual([code]);
});

test("GRV fallback tries the PLU only after an explicit exact no-match", async () => {
  const code = withEan13CheckDigit("280123401500");
  const calls: string[] = [];
  await resolveScaleBarcodeExactFirst(code, async (candidate) => {
    calls.push(candidate);
    return candidate === code ? undefined : { committed: true };
  });
  expect(calls).toEqual([code, "01234"]);
});

test("duplicate GRV scan event increments once while distinct events both count", async () => {
  const grvId = `scale-grv-${Date.now()}`;
  const [line] = await db.insert(goodsReceivedVoucherItems).values({
    grvId,
    itemId: null,
    descriptionRaw: "Idempotency test line",
    sku: "01234",
    barcode: "01234",
    expectedQuantity: 3,
    receivedQuantity: 0,
    unitCost: "1.00",
    vatRate: "19.00",
    matched: true,
  }).returning();
  try {
    await storage.scanGoodsReceivedVoucherLine(grvId, "01234", "same-event", 1);
    await storage.scanGoodsReceivedVoucherLine(grvId, "01234", "same-event", 1);
    await storage.scanGoodsReceivedVoucherLine(grvId, "01234", "different-event", 1);
    const [stored] = await db.select().from(goodsReceivedVoucherItems).where(eq(goodsReceivedVoucherItems.id, line.id));
    expect(stored.receivedQuantity).toBe(2);
  } finally {
    await db.delete(goodsReceivedVoucherScanEvents).where(eq(goodsReceivedVoucherScanEvents.grvId, grvId));
    await db.delete(goodsReceivedVoucherItems).where(eq(goodsReceivedVoucherItems.grvId, grvId));
  }
});

test("transient scan failures retain their event key for retry", () => {
  expect(shouldRetryScanFailure()).toBe(true);
  expect(shouldRetryScanFailure(429)).toBe(true);
  expect(shouldRetryScanFailure(500)).toBe(true);
  expect(shouldRetryScanFailure(503)).toBe(true);
  expect(shouldRetryScanFailure(400)).toBe(false);
  expect(shouldRetryScanFailure(404)).toBe(false);
});