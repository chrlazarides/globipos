import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { app, now } from "./bootstrap.mjs";

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "money-queue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const disk = path.join(dir, "queue.json");
  writeFileSync(disk, JSON.stringify([{
    id: 1, sync_retryable: true,
    order: {
      order_number: "POS-TEST-001", cashier_id: "sample-cashier", cashier_name: "Sample Cashier",
      subtotal: 9, discount_amount: 0, vat_amount: 0.43, total: 9,
      payment_method: "cash", amount_tendered: 10, change_due: 1,
      status: "completed", created_at: now,
    },
    lines: [{
      product_id: "sample-item", description: "Sample Milk", qty: 3, unit_price: 3,
      line_discount_pct: 0, vat_rate: 5, line_total: 9,
    }],
  }]));
  const c = globalThis.__moneySync = {
    disk, server: new Map(), snapshot: {}, sequence: 0, confirmations: 0,
    requests: 0, posts: 0, validate: app.bills.validateTerminalBill, matches: app.bills.terminalBillMatchesExisting,
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true, locks: { request: async (_name, _options, fn) => fn({ name: "fixture-lock" }) } },
  });
  c.rows = () => JSON.parse(readFileSync(disk, "utf8"));
  return c;
}
let generation = 0;
const restart = () => import(`${process.env.MONEY_SYNC_MODULE}?restart=${++generation}`);
const flush = async sync => {
  const count = await sync.flushOutbox();
  await sync.reportSyncStatus();
  return count;
};
test("[offline] disconnected queue retained without sending; controller restart then acknowledges once", async t => {
  const c = fixture(t);
  navigator.onLine = false;
  const initial = await restart();
  await assert.rejects(initial.flushOutbox(), /offline/i);
  assert.equal(c.requests, 0);
  assert.equal(c.rows().length, 1);
  navigator.onLine = true;
  const afterRestart = await restart();
  assert.equal(await flush(afterRestart), 1);
  assert.equal(c.posts, 1);
  assert.equal(c.confirmations, 1);
  assert.equal(c.rows().length, 0);
  assert.equal(await flush(afterRestart), 0);
  assert.equal(c.confirmations, 1);
});
test("[offline] accepted bill with lost reply survives restart and canonical replay is accepted once", async t => {
  const c = fixture(t);
  c.loseReply = true;
  assert.equal(await flush(await restart()), 0);
  assert.equal(c.posts, 1);
  assert.equal(c.confirmations, 0);
  assert.equal(c.rows().length, 1);
  assert.equal(await flush(await restart()), 1);
  assert.equal(c.requests, 2);
  assert.equal(c.posts, 1);
  assert.equal(c.confirmations, 1);
});
test("[offline] explicit rejection is retained, not acknowledged or automatically replayed", async t => {
  const c = fixture(t);
  c.reject = true;
  const sync = await restart();
  assert.equal(await flush(sync), 0);
  assert.equal(c.confirmations, 0);
  assert.equal(c.rows()[0].sync_retryable, false);
  c.reject = false;
  assert.equal(await flush(sync), 0);
  assert.equal(c.requests, 1);
});
test("[offline] concurrent flush calls share the same production controller run", async t => {
  const c = fixture(t);
  const sync = await restart();
  let release;
  c.wait = new Promise(resolve => { release = resolve; });
  const first = sync.flushOutbox(), second = sync.flushOutbox();
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  await sync.reportSyncStatus();
  assert.equal(c.requests, 1);
  assert.equal(c.confirmations, 1);
});
