import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Express, Request, RequestHandler, Response } from "express";
import { approvedAssignedVoucherActions, registerPosVoucherRoutes } from "./pos-voucher-routes";

const buttons = [
  { buttonType: "action", actionCode: "GIFT_VOUCHER" },
  { buttonType: "action", actionCode: "PAY_VOUCHER" },
  { buttonType: "action", actionCode: "REFUND" },
  { buttonType: "item", actionCode: "GIFT_VOUCHER" },
];

test("layout config exposes only assigned, explicitly approved, supported voucher action codes", () => {
  const settings = [
    { key: "pos_function_definition_gift_voucher", value: JSON.stringify({ approved: true }) },
    { key: "pos_function_definition_pay_voucher", value: JSON.stringify({ approved: true, rules: [{ result: "custom" }] }) },
    { key: "pos_function_definition_refund", value: JSON.stringify({ approved: true }) },
  ];
  assert.deepEqual(approvedAssignedVoucherActions(buttons, settings), ["GIFT_VOUCHER", "PAY_VOUCHER"]);
});

test("voucher layout allowlist fails closed for missing, unapproved, malformed and unassigned functions", () => {
  assert.deepEqual(approvedAssignedVoucherActions(buttons, []), []);
  assert.deepEqual(approvedAssignedVoucherActions(buttons, [
    { key: "pos_function_definition_gift_voucher", value: JSON.stringify({ approved: false }) },
    { key: "pos_function_definition_pay_voucher", value: "not-json" },
  ]), []);
  assert.deepEqual(approvedAssignedVoucherActions(
    [{ buttonType: "item", actionCode: "GIFT_VOUCHER" }],
    [{ key: "pos_function_definition_gift_voucher", value: JSON.stringify({ approved: true }) }],
  ), []);
});

test("all value-changing voucher routes reject missing/wrong device keys before business handlers", () => {
  const handlers = new Map<string, RequestHandler[]>();
  const app = {
    post: (path: string, ...registered: RequestHandler[]) => handlers.set(path, registered),
  } as unknown as Express;
  const passThrough: RequestHandler = (_req, _res, next) => next();
  registerPosVoucherRoutes(app, passThrough, passThrough);

  const key = Buffer.alloc(32, 17).toString("base64url");
  const hash = createHash("sha256").update(key).digest("hex");
  for (const path of [
    "/api/pos/vouchers/sale",
    "/api/pos/vouchers/return-preview",
    "/api/pos/vouchers/return",
    "/api/pos/vouchers/redeem",
  ]) {
    const routeHandlers = handlers.get(path)!;
    const deviceKeyGuard = routeHandlers[2];
    for (const supplied of [undefined, "wrong-key"]) {
      let passed = false;
      let responseStatus = 0;
      let responseBody: unknown;
      const request = {
        terminal: { voucherDeviceKeyHash: hash },
        get: () => supplied,
      } as unknown as Request;
      const response = {
        status(code: number) { responseStatus = code; return this; },
        json(body: unknown) { responseBody = body; return this; },
      } as unknown as Response;
      deviceKeyGuard(request, response, () => { passed = true; });
      assert.equal(passed, false, `${path} must block a missing or wrong pairing key`);
      assert.equal(responseStatus, 401);
      assert.deepEqual(responseBody, { message: "Voucher device key is missing or invalid" });
    }
    let passed = false;
    deviceKeyGuard(
      {
        terminal: { voucherDeviceKeyHash: hash },
        get: () => key,
      } as unknown as Request,
      {} as Response,
      () => { passed = true; },
    );
    assert.equal(passed, true, `${path} must accept the currently paired device key`);
  }
});