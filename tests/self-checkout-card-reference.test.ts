import test from "node:test";
import assert from "node:assert/strict";
import {
  canGenericAttendantRelease,
  canStartSelfCheckoutPayment,
  resolveApprovedCardReference,
  resolveCardPaymentOutcome,
} from "../pos-app/src/lib/cardPayment";

test("self-checkout locks an approved payment without a reference against retry", () => {
  for (const missingReference of [undefined, null, "", "   "]) {
    const result = resolveApprovedCardReference(missingReference);
    assert.equal(result.kind, "verification_required");
    assert.equal(result.canRetry, false);
    assert.match(result.message, /no terminal reference/i);
  }
});

test("self-checkout stores a normalized approved card reference", () => {
  assert.deepEqual(resolveApprovedCardReference("  AUTH-123  "), {
    kind: "complete",
    reference: "AUTH-123",
    canRetry: false,
  });
});

test("payment verification cannot retry or use the generic attendant release", () => {
  assert.equal(canStartSelfCheckoutPayment("payment_verification"), false);
  assert.equal(canGenericAttendantRelease("payment_verification"), false);
  assert.equal(canStartSelfCheckoutPayment("scanning"), true);
});

test("terminal communication failure remains locked instead of allowing another charge", () => {
  assert.deepEqual(
    resolveCardPaymentOutcome({ approved: false, error: "terminal communication failed" }),
    {
      kind: "verification_required",
      message: "terminal communication failed",
      canRetry: false,
    },
  );
});

test("only a definitive terminal decline permits retry", () => {
  assert.deepEqual(
    resolveCardPaymentOutcome({ approved: false, error: "Payment declined by terminal" }),
    {
      kind: "declined",
      message: "Payment declined by terminal",
      canRetry: true,
    },
  );
});