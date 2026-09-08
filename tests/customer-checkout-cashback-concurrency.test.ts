import test from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { storage } from "../server/storage";
import {
  customerLoyaltyPoints,
  customers,
  portalOrderItems,
  portalOrders,
} from "../shared/schema";

const runId = Date.now();
const customerCode = `CASHBACK-RACE-${runId}`;
let customerId = "";
let rollbackCustomerId = "";
const orderIds: string[] = [];

const policy = {
  useCashback: true,
  loyaltyEnabled: true,
  cashbackEnabled: true,
  pointsPerEuro: 1,
  silverThreshold: 1_000,
  goldThreshold: 5_000,
  bronzeCashbackPercent: 0,
  silverCashbackPercent: 0,
  goldCashbackPercent: 0,
  maxCashbackOrderPercent: 100,
};

test("simultaneous customer checkouts cannot spend the same cashback twice", async () => {
  await db.execute(sql`
    alter table portal_orders add column if not exists checkout_key varchar;
    create unique index if not exists portal_orders_customer_checkout_key_unique
    on portal_orders (customer_id, checkout_key)
    where checkout_key is not null;
    create unique index if not exists customer_loyalty_points_source_unique
    on customer_loyalty_points (source_type, source_id)
    where source_type is not null and source_id is not null
  `);
  const [customer] = await db.insert(customers).values({
    name: `Cashback race customer ${runId}`,
    code: customerCode,
    cashbackBalance: "10.00",
  }).returning({ id: customers.id });
  customerId = customer.id;

  const createOrder = (checkoutKey = crypto.randomUUID()) => storage.createCustomerPortalOrderAtomic(
    {
      customerId,
      checkoutKey,
      subtotal: "8.40",
      vatAmount: "1.60",
      status: "pending",
    },
    [{
      orderId: "TEMP",
      itemId: `cashback-test-item-${runId}`,
      itemName: "Cashback concurrency item",
      quantity: 1,
      unitPrice: "8.40",
      total: "8.40",
    }],
    policy,
  );

  try {
    const checkoutKeys = [crypto.randomUUID(), crypto.randomUUID()];
    const checkouts = await Promise.all([
      createOrder(checkoutKeys[0]),
      createOrder(checkoutKeys[1]),
    ]);
    const orders = checkouts.map(({ order }) => order);
    orderIds.push(...orders.map((order) => order.id));

    const applied = orders.map((order) => Number(order.cashbackApplied)).sort((a, b) => a - b);
    assert.deepEqual(applied, [0, 10]);
    assert.equal(applied.reduce((sum, amount) => sum + amount, 0), 10);

    const [savedCustomer] = await db.select({
      cashbackBalance: customers.cashbackBalance,
    }).from(customers).where(eq(customers.id, customerId));
    assert.equal(Number(savedCustomer.cashbackBalance), 0);

    const awards = await db.select().from(customerLoyaltyPoints)
      .where(eq(customerLoyaltyPoints.customerId, customerId));
    assert.equal(awards.length, 2);
    assert.equal(awards.reduce((sum, award) => sum + award.points, 0), 16);
    assert.equal(new Set(awards.map((award) => award.sourceId)).size, 2);

    const replays = await Promise.all([
      createOrder(checkoutKeys[0]),
      createOrder(checkoutKeys[0]),
    ]);
    assert.ok(replays.every((replay) => replay.replayed));
    assert.ok(replays.every((replay) => replay.order.id === orders[0].id));
    const ordersAfterReplay = await db.select({ id: portalOrders.id }).from(portalOrders)
      .where(eq(portalOrders.customerId, customerId));
    const awardsAfterReplay = await db.select().from(customerLoyaltyPoints)
      .where(eq(customerLoyaltyPoints.customerId, customerId));
    assert.equal(ordersAfterReplay.length, 2);
    assert.equal(awardsAfterReplay.length, 2);

    await db.execute(sql`
      create or replace function fail_cashback_rollback_test() returns trigger
      language plpgsql as $$
      begin
        if new.code like 'CASHBACK-ROLLBACK-%' then
          raise exception 'forced late checkout failure';
        end if;
        return new;
      end;
      $$;
      drop trigger if exists cashback_rollback_test_trigger on customers;
      create trigger cashback_rollback_test_trigger
      after update of cashback_balance on customers
      for each row execute function fail_cashback_rollback_test()
    `);
    const [rollbackCustomer] = await db.insert(customers).values({
      name: `Cashback rollback customer ${runId}`,
      code: `CASHBACK-ROLLBACK-${runId}`,
      cashbackBalance: "5.00",
    }).returning({ id: customers.id });
    rollbackCustomerId = rollbackCustomer.id;

    await assert.rejects(
      storage.createCustomerPortalOrderAtomic(
        {
          customerId: rollbackCustomerId,
          checkoutKey: crypto.randomUUID(),
          subtotal: "8.40",
          vatAmount: "1.60",
          status: "pending",
        },
        [{
          orderId: "TEMP",
          itemId: `cashback-test-item-${runId}`,
          itemName: "Rollback concurrency item",
          quantity: 1,
          unitPrice: "8.40",
          total: "8.40",
        }],
        policy,
      ),
      (error: any) => error?.cause?.message === "forced late checkout failure",
    );

    const [customerAfterFailure] = await db.select({
      cashbackBalance: customers.cashbackBalance,
    }).from(customers).where(eq(customers.id, rollbackCustomerId));
    const ordersAfterFailure = await db.select({ id: portalOrders.id }).from(portalOrders)
      .where(eq(portalOrders.customerId, rollbackCustomerId));
    const awardsAfterFailure = await db.select().from(customerLoyaltyPoints)
      .where(eq(customerLoyaltyPoints.customerId, rollbackCustomerId));
    assert.equal(Number(customerAfterFailure.cashbackBalance), 5);
    assert.equal(ordersAfterFailure.length, 0);
    assert.equal(awardsAfterFailure.length, 0);
  } finally {
    await db.execute(sql`
      drop trigger if exists cashback_rollback_test_trigger on customers;
      drop function if exists fail_cashback_rollback_test()
    `);
    if (orderIds.length) {
      await db.delete(portalOrderItems).where(inArray(portalOrderItems.orderId, orderIds));
      await db.delete(customerLoyaltyPoints).where(eq(customerLoyaltyPoints.customerId, customerId));
      await db.delete(portalOrders).where(inArray(portalOrders.id, orderIds));
    }
    if (rollbackCustomerId) {
      await db.delete(customerLoyaltyPoints).where(eq(customerLoyaltyPoints.customerId, rollbackCustomerId));
      await db.delete(portalOrders).where(eq(portalOrders.customerId, rollbackCustomerId));
      await db.delete(customers).where(eq(customers.id, rollbackCustomerId));
    }
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    await pool.end();
  }
});