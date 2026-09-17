import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPortalOrderTransition,
  calculateCashbackReservation,
  calculateCompletedRewards,
  calculateRefundCashbackBalance,
  validateRedemption,
  type LoyaltyPolicyValues,
} from "./loyalty-policy";

const policy: LoyaltyPolicyValues = {
  loyaltyEnabled: true,
  cashbackEnabled: true,
  pointsPerEuro: 1,
  redeemPointsPerEuro: 100,
  minimumRedemptionPoints: 100,
  silverThreshold: 1000,
  goldThreshold: 5000,
  bronzeCashbackPercent: 1,
  silverCashbackPercent: 1.5,
  goldCashbackPercent: 2,
  maxCashbackOrderPercent: 50,
};

test("cashback reservation respects wallet, total, cap, and disabled state", () => {
  assert.equal(calculateCashbackReservation(80, 100, true, policy), 50);
  assert.equal(calculateCashbackReservation(20, 100, true, policy), 20);
  assert.equal(calculateCashbackReservation(80, 100, false, policy), 0);
  assert.equal(calculateCashbackReservation(80, 100, true, { ...policy, cashbackEnabled: false }), 0);
});

test("completion awards configured points and post-award tier cashback", () => {
  assert.deepEqual(calculateCompletedRewards(100, 950, policy), {
    points: 100,
    cashback: 1.5,
    cashbackPercent: 1.5,
  });
  assert.deepEqual(calculateCompletedRewards(100, 950, { ...policy, loyaltyEnabled: false }), {
    points: 0,
    cashback: 1,
    cashbackPercent: 1,
  });
});

test("order lifecycle permits completion and one full refund only", () => {
  assert.doesNotThrow(() => assertPortalOrderTransition("pending", "confirmed"));
  assert.doesNotThrow(() => assertPortalOrderTransition("confirmed", "completed"));
  assert.doesNotThrow(() => assertPortalOrderTransition("completed", "refunded"));
  assert.doesNotThrow(() => assertPortalOrderTransition("completed", "completed"));
  assert.throws(() => assertPortalOrderTransition("pending", "completed"), /INVALID_ORDER_TRANSITION/);
  assert.throws(() => assertPortalOrderTransition("refunded", "confirmed"), /INVALID_ORDER_TRANSITION/);
});

test("redemption is strict about minimums, multiples, and available points", () => {
  assert.equal(validateRedemption(500, 900, policy), 5);
  assert.throws(() => validateRedemption(99, 900, policy), /REDEMPTION_BELOW_MINIMUM/);
  assert.throws(() => validateRedemption(150, 900, policy), /INVALID_REDEMPTION_MULTIPLE/);
  assert.throws(() => validateRedemption(1000, 900, policy), /INSUFFICIENT_POINTS/);
  assert.throws(() => validateRedemption(100.5, 900, policy), /INVALID_REDEMPTION/);
});

test("a refund records liability if earned cashback was already spent", () => {
  assert.equal(calculateRefundCashbackBalance(10, 2, 5), 13);
  assert.equal(calculateRefundCashbackBalance(0, 2, 0), -2);
});