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

import { withPointsDatabase } from "../tests/loyalty-concurrency.fixture";

test("shared points storage: races, lost replies and failed ledger writes", { timeout: 45_000 }, async (t) => {
  await withPointsDatabase(async ({ pool, seed, redeem, state }) => {
    await t.test("two distinct requests cannot both spend the same available points", async () => {
      await seed("points-race", 300);
      const blocker = await pool.connect();
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM customers WHERE id='points-race' FOR UPDATE");
      const pending = Promise.allSettled([
        redeem("points-race", 200, "race-a", policy), redeem("points-race", 200, "race-b", policy),
      ]);
      try {
        let waiting = 0;
        for (let attempt = 0; attempt < 100 && waiting !== 2; attempt++) {
          waiting = Number((await pool.query(`SELECT count(*) AS waiting FROM pg_stat_activity
            WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%for update%'`)).rows[0].waiting);
          if (waiting !== 2) await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, 2, "Both actual transactions must reach the row lock before either spends");
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const results = await pending;
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
      assert.match(String(failure.reason), /INSUFFICIENT_POINTS/);
      assert.deepEqual(await state("points-race"), [{ wallet: "2.00", points: 100, debits: 1, credits: 1 }]);
    });
    await t.test("concurrent same-key retries return one credit, including recovery after a lost reply", async () => {
      await seed("points-retry", 340);
      const results = await Promise.all([
        redeem("points-retry", 200, "same-key", policy),
        redeem("points-retry", 200, "same-key", policy),
      ]);
      assert.deepEqual(results.map(r => r.replayed).sort(), [false, true]);
      const after = await state("points-retry");
      assert.deepEqual(after, [{ wallet: "2.00", points: 140, debits: 1, credits: 1 }]);
      assert.equal((await redeem("points-retry", 200, "same-key", policy)).replayed, true);
      assert.deepEqual(await state("points-retry"), after);
      await assert.rejects(redeem("points-retry", 100, "same-key", policy), /REDEMPTION_KEY_CONFLICT/);
      assert.deepEqual(await state("points-retry"), after);
    });
    await t.test("a failure between points debit and wallet credit rolls the whole transaction back", async () => {
      await seed("points-rollback", 340);
      const before = await state("points-rollback");
      await pool.query(`ALTER TABLE customer_cashback_ledger ADD CONSTRAINT fixture_reject_credit
        CHECK (customer_id <> 'points-rollback')`);
      await assert.rejects(redeem("points-rollback", 200, "failed-key", policy), (error: unknown) => {
        const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
        assert.equal(cause?.code, "23514");
        assert.equal(cause?.constraint, "fixture_reject_credit");
        return true;
      });
      assert.deepEqual(await state("points-rollback"), before);
      await pool.query("ALTER TABLE customer_cashback_ledger DROP CONSTRAINT fixture_reject_credit");
      await redeem("points-rollback", 200, "failed-key", policy);
      assert.deepEqual(await state("points-rollback"), [{ wallet: "2.00", points: 140, debits: 1, credits: 1 }]);
    });
  });
});