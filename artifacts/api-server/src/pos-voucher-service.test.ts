import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  itemLocationStock,
  items,
  posCashiers,
  posGiftVoucherLedger,
  posGiftVoucherAuthFailures,
  posGiftVoucherOperations,
  posGiftVouchers,
  posLayoutButtons,
  posLayoutSets,
  posLocations,
  posOrderLines,
  posOrders,
  posReturnOrderLines,
  posReturnOrders,
  posTerminals,
  systemSettings,
} from "@workspace/db";
import { pool } from "./db";
import {
  issueCashGiftVoucher,
  issueVoucherReturn,
  previewVoucherReturn,
  redeemGiftVoucher,
  matchesVoucherDeviceKey,
  rotateVoucherDeviceKey,
  type VoucherCashierInput,
} from "./pos-voucher-service";

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = "voucher-service-test-key-that-is-long-enough";

test("gift voucher transactions are atomic, single-use, idempotent and limited to validated returns", async (t) => {
  const suffix = randomUUID();
  const remoteAddress = `voucher-test-${suffix}`;
  const settingKeys = [
    "pos_function_definition_gift_voucher",
    "pos_function_definition_pay_voucher",
  ];
  const previousFunctionSettings = await db.select().from(systemSettings).where(inArray(systemSettings.key, settingKeys));
  await db.insert(systemSettings).values([
    {
      key: settingKeys[0],
      value: JSON.stringify({ approved: true }),
      label: "Voucher test approval",
      group: "pos",
    },
    {
      key: settingKeys[1],
      value: JSON.stringify({ approved: true }),
      label: "Voucher test approval",
      group: "pos",
    },
  ]).onConflictDoUpdate({
    target: systemSettings.key,
    set: { value: JSON.stringify({ approved: true }) },
  });
  const [location] = await db.insert(posLocations).values({
    name: `Voucher Test ${suffix}`,
    code: `voucher-${suffix}`,
  }).returning();
  const [layout] = await db.insert(posLayoutSets).values({
    name: `Voucher Test ${suffix}`,
    locationId: location.id,
  }).returning();
  const [terminal] = await db.insert(posTerminals).values({
    locationId: location.id,
    name: `Voucher Test ${suffix}`,
    code: `voucher-${suffix}`,
    layoutSetId: layout.id,
    priceLevel: 2,
    active: true,
  }).returning();
  await db.insert(posLayoutButtons).values([
    { layoutSetId: layout.id, position: 0, label: "Gift Voucher", buttonType: "action", actionCode: "GIFT_VOUCHER" },
    { layoutSetId: layout.id, position: 1, label: "Redeem Voucher", buttonType: "action", actionCode: "PAY_VOUCHER" },
  ]);
  const [cashier] = await db.insert(posCashiers).values({
    locationId: location.id,
    name: `Voucher Test ${suffix}`,
    pin: createHash("sha256").update("1234").digest("hex"),
    active: true,
  }).returning();
  const [item] = await db.insert(items).values({
    name: `Voucher test item ${suffix}`,
    sku: `voucher-${suffix}`,
    price1: "30.00",
    price2: "36.00",
    price3: "45.00",
    vatRate: "20.00",
    stockQuantity: 20,
  }).returning();
  await db.insert(itemLocationStock).values({
    itemId: item.id,
    locationId: location.id,
    quantity: 20,
  });

  const auth: VoucherCashierInput = {
    terminal,
    cashierId: cashier.id,
    pin: "1234",
    remoteAddress,
  };
  const id = (name: string) => `${name}-${suffix}`;
  assert.equal(matchesVoucherDeviceKey(null, undefined), false, "unpaired terminals cannot use voucher actions");
  assert.equal(matchesVoucherDeviceKey(null, "A".repeat(43)), false, "a supplied key cannot pair itself");
  const firstDeviceKey = await rotateVoucherDeviceKey(terminal.id);
  const [firstPairedTerminal] = await db.select({ keyHash: posTerminals.voucherDeviceKeyHash })
    .from(posTerminals).where(eq(posTerminals.id, terminal.id));
  assert.notEqual(firstPairedTerminal.keyHash, firstDeviceKey, "the cleartext key is never stored");
  assert.equal(matchesVoucherDeviceKey(firstPairedTerminal.keyHash, undefined), false, "a missing device key is rejected");
  assert.equal(matchesVoucherDeviceKey(firstPairedTerminal.keyHash, "wrong-key"), false, "a wrong device key is rejected");
  assert.equal(matchesVoucherDeviceKey(firstPairedTerminal.keyHash, firstDeviceKey), true);
  const secondDeviceKey = await rotateVoucherDeviceKey(terminal.id);
  const [repairedTerminal] = await db.select({ keyHash: posTerminals.voucherDeviceKeyHash })
    .from(posTerminals).where(eq(posTerminals.id, terminal.id));
  assert.notEqual(secondDeviceKey, firstDeviceKey);
  assert.equal(matchesVoucherDeviceKey(repairedTerminal.keyHash, firstDeviceKey), false, "rotation invalidates the previous terminal key");
  assert.equal(matchesVoucherDeviceKey(repairedTerminal.keyHash, secondDeviceKey), true);

  t.after(async () => {
    try {
      await db.delete(posGiftVoucherLedger).where(inArray(posGiftVoucherLedger.terminalId, [terminal.id]));
      await db.delete(posGiftVouchers).where(eq(posGiftVouchers.terminalId, terminal.id));
      await db.delete(posGiftVoucherOperations).where(eq(posGiftVoucherOperations.terminalId, terminal.id));
      await db.delete(posGiftVoucherAuthFailures).where(eq(posGiftVoucherAuthFailures.terminalId, terminal.id));
      const returns = await db.select({ id: posReturnOrders.id }).from(posReturnOrders)
        .where(eq(posReturnOrders.terminalId, terminal.id));
      if (returns.length) {
        const returnIds = returns.map((row) => row.id);
        await db.delete(posReturnOrderLines).where(inArray(posReturnOrderLines.returnOrderId, returnIds));
        await db.delete(posReturnOrders).where(inArray(posReturnOrders.id, returnIds));
      }
      const orders = await db.select({ id: posOrders.id }).from(posOrders).where(eq(posOrders.terminalId, terminal.id));
      if (orders.length) {
        const orderIds = orders.map((row) => row.id);
        await db.delete(posOrderLines).where(inArray(posOrderLines.orderId, orderIds));
        await db.delete(posOrders).where(inArray(posOrders.id, orderIds));
      }
      await db.delete(items).where(eq(items.id, item.id));
      await db.delete(posCashiers).where(eq(posCashiers.id, cashier.id));
      await db.delete(posTerminals).where(eq(posTerminals.id, terminal.id));
      await db.delete(posLayoutButtons).where(eq(posLayoutButtons.layoutSetId, layout.id));
      await db.delete(posLayoutSets).where(eq(posLayoutSets.id, layout.id));
      await db.delete(posLocations).where(eq(posLocations.id, location.id));
      await db.delete(systemSettings).where(inArray(systemSettings.key, settingKeys));
      for (const { key, value, label, group } of previousFunctionSettings) {
        await db.insert(systemSettings).values({ key, value, label, group }).onConflictDoUpdate({
          target: systemSettings.key,
          set: { value, label, group },
        });
      }
    } finally {
      await pool.end();
    }
  });

  const firstSale = await issueCashGiftVoucher({ ...auth, amountCents: 5_000, idempotencyKey: id("sale-replay") });
  const saleReplay = await issueCashGiftVoucher({ ...auth, amountCents: 5_000, idempotencyKey: id("sale-replay") });
  assert.deepEqual(saleReplay, firstSale, "retry returns the identical serial and order number");
  await assert.rejects(
    issueCashGiftVoucher({ ...auth, amountCents: 5_001, idempotencyKey: id("sale-replay") }),
    /different request/,
  );
  assert.equal(
    await db.select({ id: posGiftVouchers.id }).from(posGiftVouchers).where(eq(posGiftVouchers.terminalId, terminal.id)).then(rows => rows.length),
    1,
    "a conflicting idempotent retry cannot issue another voucher",
  );
  await db.delete(posLayoutButtons).where(and(
    eq(posLayoutButtons.layoutSetId, layout.id),
    eq(posLayoutButtons.actionCode, "GIFT_VOUCHER"),
  ));
  await assert.rejects(
    issueCashGiftVoucher({ ...auth, amountCents: 100, idempotencyKey: id("unassigned-sale") }),
    /Assign and approve/,
  );
  await db.insert(posLayoutButtons).values({
    layoutSetId: layout.id,
    position: 0,
    label: "Gift Voucher",
    buttonType: "action",
    actionCode: "GIFT_VOUCHER",
  });
  await db.update(systemSettings).set({ value: JSON.stringify({ approved: false }) })
    .where(eq(systemSettings.key, "pos_function_definition_gift_voucher"));
  await assert.rejects(
    issueCashGiftVoucher({ ...auth, amountCents: 100, idempotencyKey: id("unapproved-sale") }),
    /must be approved/,
  );
  await db.update(systemSettings).set({ value: JSON.stringify({ approved: true }) })
    .where(eq(systemSettings.key, "pos_function_definition_gift_voucher"));

  const partialRedemption = await redeemGiftVoucher({
    ...auth,
    serial: firstSale.voucher.serial,
    lines: [{ itemId: item.id, quantity: 1 }],
    expectedTotalCents: 3_600,
    cashPaidCents: 0,
    idempotencyKey: id("redeem-partial"),
  });
  assert.equal(partialRedemption.voucherAppliedCents, 3_600);
  assert.equal(partialRedemption.replacementVoucher?.amountCents, 1_400);
  assert.notEqual(partialRedemption.replacementVoucher?.serial, firstSale.voucher.serial);
  const [partialOrder] = await db.select().from(posOrders)
    .where(eq(posOrders.orderNumber, partialRedemption.orderNumber));
  assert.equal(partialOrder.total, "36.00", "POS order total remains the terminal's VAT-inclusive gross");
  assert.equal(partialOrder.subtotal, "36.00", "POS subtotal follows the terminal's gross-line convention");
  assert.equal(partialOrder.vatAmount, "6.00", "VAT is extracted from the included gross, not added");
  const [partialOrderLine] = await db.select().from(posOrderLines)
    .where(eq(posOrderLines.orderId, partialOrder.id));
  assert.equal(partialOrderLine.unitPrice, "36.00");
  assert.equal(partialOrderLine.total, "36.00");
  await assert.rejects(
    redeemGiftVoucher({
      ...auth,
      serial: firstSale.voucher.serial,
      lines: [{ itemId: item.id, quantity: 1 }],
      expectedTotalCents: 3_600,
      cashPaidCents: 0,
      idempotencyKey: id("redeem-old-serial"),
    }),
    /already used/,
  );

  await db.update(posTerminals).set({ priceLevel: 1 }).where(eq(posTerminals.id, terminal.id));
  const levelOneVoucher = await issueCashGiftVoucher({
    ...auth,
    amountCents: 5_000,
    idempotencyKey: id("level-one-source"),
  });
  const levelOneRedemption = await redeemGiftVoucher({
    ...auth,
    serial: levelOneVoucher.voucher.serial,
    lines: [{ itemId: item.id, quantity: 1 }],
    expectedTotalCents: 3_000,
    cashPaidCents: 0,
    idempotencyKey: id("level-one-unavailable"),
  });
  assert.equal(levelOneRedemption.totalCents, 3_000, "default level uses the synced catalog's price1, with VAT included");
  await db.update(posTerminals).set({ priceLevel: 3 }).where(eq(posTerminals.id, terminal.id));
  const levelThreeVoucher = await issueCashGiftVoucher({
    ...auth,
    amountCents: 5_000,
    idempotencyKey: id("level-three-source"),
  });
  const levelThreeRedemption = await redeemGiftVoucher({
    ...auth,
    serial: levelThreeVoucher.voucher.serial,
    lines: [{ itemId: item.id, quantity: 1 }],
    expectedTotalCents: 4_500,
    cashPaidCents: 0,
    idempotencyKey: id("level-three-redemption"),
  });
  const [levelThreeOrder] = await db.select().from(posOrders)
    .where(eq(posOrders.orderNumber, levelThreeRedemption.orderNumber));
  assert.equal(levelThreeOrder.total, "45.00", "the configured terminal price level is authoritative");
  assert.equal(levelThreeOrder.vatAmount, "7.50", "level 3 VAT is still included in the gross");
  await db.update(posTerminals).set({ priceLevel: 2 }).where(eq(posTerminals.id, terminal.id));

  const cashShortfallVoucher = await issueCashGiftVoucher({
    ...auth,
    amountCents: 3_000,
    idempotencyKey: id("cash-shortfall-source"),
  });
  await assert.rejects(redeemGiftVoucher({
    ...auth,
    serial: cashShortfallVoucher.voucher.serial,
    lines: [{ itemId: item.id, quantity: 1 }],
    expectedTotalCents: 3_600,
    cashPaidCents: 599,
    idempotencyKey: id("cash-shortfall"),
  }), /Collect at least 600 cents/);
  const cashShortfall = await redeemGiftVoucher({
    ...auth,
    serial: cashShortfallVoucher.voucher.serial,
    lines: [{ itemId: item.id, quantity: 1 }],
    expectedTotalCents: 3_600,
    cashPaidCents: 600,
    idempotencyKey: id("cash-shortfall"),
  });
  assert.equal(cashShortfall.voucherAppliedCents, 3_000);
  assert.equal(cashShortfall.cashPaidCents, 600);
  assert.equal(cashShortfall.replacementVoucher, null);

  const concurrentSale = await issueCashGiftVoucher({
    ...auth,
    amountCents: 3_600,
    idempotencyKey: id("concurrent-source"),
  });
  const concurrentRequests = await Promise.allSettled([
    redeemGiftVoucher({
      ...auth,
      serial: concurrentSale.voucher.serial,
      lines: [{ itemId: item.id, quantity: 1 }],
      expectedTotalCents: 3_600,
      cashPaidCents: 0,
      idempotencyKey: id("concurrent-a"),
    }),
    redeemGiftVoucher({
      ...auth,
      serial: concurrentSale.voucher.serial,
      lines: [{ itemId: item.id, quantity: 1 }],
      expectedTotalCents: 3_600,
      cashPaidCents: 0,
      idempotencyKey: id("concurrent-b"),
    }),
  ]);
  assert.equal(concurrentRequests.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentRequests.filter((result) => result.status === "rejected").length, 1);

  const [originalOrder] = await db.insert(posOrders).values({
    orderNumber: `RETURN-TEST-${suffix}`,
    terminalId: terminal.id,
    locationId: location.id,
    cashierId: cashier.id,
    cashierName: cashier.name,
    subtotal: "72.00",
    vatAmount: "12.00",
    discountAmount: "0.00",
    total: "72.00",
    paymentMethod: "cash",
    amountTendered: "72.00",
    status: "completed",
  }).returning();
  const [originalLine] = await db.insert(posOrderLines).values({
    orderId: originalOrder.id,
    itemId: item.id,
    description: "Two test products",
    quantity: "2",
    unitPrice: "36.00",
    vatRate: "20.00",
    discountPercent: "0.00",
    total: "72.00",
  }).returning();
  await assert.rejects(
    previewVoucherReturn({ ...auth, orderNumber: `MISSING-${suffix}` }),
    /No completed POS sale/,
  );

  const creditNote = await issueVoucherReturn({
    ...auth,
    orderNumber: originalOrder.orderNumber,
    lines: [{ lineId: originalLine.id, quantity: 1 }],
    idempotencyKey: id("return-once"),
  });
  const returnReplay = await issueVoucherReturn({
    ...auth,
    orderNumber: originalOrder.orderNumber,
    lines: [{ lineId: originalLine.id, quantity: 1 }],
    idempotencyKey: id("return-once"),
  });
  assert.deepEqual(returnReplay, creditNote, "retry returns the same serialized credit-note voucher");
  assert.equal(creditNote.refundAmountCents, 3_600);
  await assert.rejects(
    issueVoucherReturn({
      ...auth,
      orderNumber: originalOrder.orderNumber,
      lines: [{ lineId: originalLine.id, quantity: 2 }],
      idempotencyKey: id("return-over"),
    }),
    /remaining quantity/,
  );

  const [oldSerialAfterSpend] = await db.select().from(posGiftVouchers)
    .where(eq(posGiftVouchers.serialHash, createHash("sha256").update(firstSale.voucher.serial.replace(/[\s-]/g, "").toUpperCase()).digest("hex")));
  assert.equal(oldSerialAfterSpend.status, "spent");
  assert.equal(oldSerialAfterSpend.balanceCents, 0);
  const [newSerial] = await db.select().from(posGiftVouchers)
    .where(eq(posGiftVouchers.serialHash, createHash("sha256").update(partialRedemption.replacementVoucher!.serial.replace(/[\s-]/g, "").toUpperCase()).digest("hex")));
  assert.equal(newSerial.status, "active");
  assert.equal(newSerial.balanceCents, 1_400);
  assert.equal(
    await db.select({ id: posGiftVoucherLedger.id }).from(posGiftVoucherLedger)
      .where(and(eq(posGiftVoucherLedger.operationId, (await db.select({ id: posGiftVoucherOperations.id }).from(posGiftVoucherOperations)
        .where(eq(posGiftVoucherOperations.idempotencyKey, id("redeem-partial"))))[0].id), eq(posGiftVoucherLedger.eventType, "residual_issue")))
      .then(rows => rows.length),
    1,
  );
});