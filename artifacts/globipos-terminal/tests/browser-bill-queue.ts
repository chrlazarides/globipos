import { saveOrder, setConfig, getOutbox } from "../src/lib/db";
import { flushOutbox } from "../src/lib/sync";
import type { Order, OrderLine } from "../src/types";

const mode = new URLSearchParams(location.search).get("billScenario");
const output = document.querySelector<HTMLPreElement>("#result")!;
const publish = (status: string, value: unknown) => {
  output.dataset.status = status;
  output.textContent = JSON.stringify(value);
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function snapshot() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("globipos_terminal");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const result: Record<string, any[]> = {};
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["orders", "order_lines", "outbox", "sync_cursor"]);
    for (const store of ["orders", "order_lines", "outbox", "sync_cursor"]) {
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => { result[store] = request.result; };
    }
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
  return result;
}
const order: Order = {
  id: "gap-order", order_number: "GAP-184", status: "completed",
  cashier_id: "sample-cashier", cashier_name: "Sample cashier", price_level: 1,
  order_discount_pct: 0, order_discount_fixed: 0, surcharge_pct: 0, surcharge_amount: 0,
  subtotal: 3.20, discount_amount: 0, vat_amount: .15, total: 3.20,
  payment_method: "cash", amount_tendered: 5, change_due: 1.80,
  created_at: "2026-10-17T09:00:00.000Z",
};
const line: OrderLine = {
  id: "gap-line", order_id: order.id, product_id: "sample-product", description: "Sample item",
  qty: 1, unit_price: 3.20, line_discount_pct: 0, line_discount_fixed: 0,
  line_surcharge_pct: 0, vat_rate: 5, line_total: 3.20, vat_amount: .15, voided: false,
};

async function run() {
  check(!navigator.serviceWorker?.controller, "Fixture must not be controlled by an app service worker");
  await setConfig({
    server_url: "https://money-fixture.invalid", terminal_code: "GAP",
  });
  const sent: any[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    check(url.startsWith("https://money-fixture.invalid/"), `Unexpected external request ${url}`);
    if (url.endsWith("/api/sync/bills")) {
      const body = JSON.parse(String(options?.body));
      sent.push(body.bills[0]);
      if (mode === "lost-ack") {
        publish("accepted", { payload: body.bills[0], saved: await snapshot() });
        await new Promise(() => {}); // Kill the browser after simulated server acceptance.
      }
      return new Response(JSON.stringify({ results: [{ orderNumber: order.order_number, status: "ok" }] }));
    }
    check(url.includes("/sync-status"), `Unexpected fixture API ${url}`);
    return new Response("{}");
  };
  if (mode === "save" || mode === "lost-ack" || mode === "ack-abort" || mode === "save-abort") {
    if (mode === "save-abort") {
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        const transaction = original.apply(this, args);
        if (Array.from(args[0]).includes("orders") && args[1] === "readwrite") queueMicrotask(() => transaction.abort());
        return transaction;
      };
      const settled = await Promise.race([
        saveOrder(order, [line]).then(() => "resolved", () => "rejected"),
        new Promise(resolve => setTimeout(() => resolve("pending"), 200)),
      ]);
      const saved = await snapshot();
      check(saved.orders.length === 0 && saved.order_lines.length === 0 && saved.outbox.length === 0,
        "Aborted local save must not retain a partial bill");
      check(settled === "rejected", `Aborted save must reject, got ${settled}`);
      publish("passed", { settled, saved });
      return;
    }
    await saveOrder(order, [line]);
  }
  const before = await snapshot();
  check(before.orders.length === 1 && before.order_lines.length === 1 && before.outbox.length === 1,
    "Committed bill, lines and queue must survive together");
  if (mode === "save") { publish("saved", { before }); return; }
  if (mode === "ack-abort") {
    const original = IDBDatabase.prototype.transaction;
    let aborted = false;
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = original.apply(this, args);
      if (!aborted && Array.from(args[0]).includes("outbox") && Array.from(args[0]).includes("sync_cursor") && args[1] === "readwrite") {
        aborted = true;
        queueMicrotask(() => transaction.abort());
      }
      return transaction;
    };
    await flushOutbox();
    const failedAck = await snapshot();
    check(aborted && failedAck.outbox.length === 1, "Failed acknowledgement must retain the bill");
    const status = failedAck.sync_cursor.find(row => row.id === "status:https://money-fixture.invalid:GAP")?.snapshot;
    check(status && status.transactionsConfirmed === 0 && status.lastTransactionSyncAt === null,
      "Failed acknowledgement must not store a successful sync timestamp");
  }
  await flushOutbox();
  const after = await snapshot();
  check(after.outbox.length === 0 && after.orders.length === 1 && after.order_lines.length === 1,
    "Acknowledgement must remove only the queue entry, not the saved sale");
  check(after.orders[0].id === order.id && after.order_lines[0].order_id === order.id,
    "Recovery must retain original sale identities");
  const status = after.sync_cursor.find(row => row.id === "status:https://money-fixture.invalid:GAP")?.snapshot;
  check(status && status.transactionsConfirmed === 1 && status.lastTransactionSyncAt,
    "Acknowledgement must atomically persist the success timestamp and count");
  publish("passed", { before, after, sent });
}
run().catch(error => {
  output.dataset.status = "failed";
  output.textContent = String(error?.stack ?? error);
});
