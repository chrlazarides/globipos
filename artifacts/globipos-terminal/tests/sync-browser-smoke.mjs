// Run against the terminal's running preview: node artifacts/globipos-terminal/tests/sync-browser-smoke.mjs
// Uses an isolated Chromium profile and a mocked server. Never contacts customer data.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { once } from "node:events";

const base = process.env.TERMINAL_TEST_URL ?? "http://localhost:80/terminal/";
const directory = await mkdtemp(path.join(tmpdir(), "globipos-sync-"));
const chrome = spawn("chromium", [
  "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--remote-debugging-port=0", `--user-data-dir=${directory}`, "about:blank",
], { stdio: "ignore" });

let connection;
try {
  let port;
  for (let i = 0; i < 80; i++) {
    try { port = Number((await readFile(path.join(directory, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!port) throw new Error("Chromium did not start");
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not open test page: ${response.status}`);
  const target = await response.json();
  connection = new WebSocket(target.webSocketDebuggerUrl);
  const connected = new Promise((resolve, reject) => {
    connection.addEventListener("open", resolve, { once: true });
    connection.addEventListener("error", reject, { once: true });
  });
  await connected;
  let id = 0;
  const pending = new Map();
  connection.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      connection.send(JSON.stringify({ id: current, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text +
      ` ${response.exceptionDetails.exception?.description ?? ""}`);
    return response.result?.value;
  }
  await cdp("Runtime.enable");
  for (let i = 0; i < 70; i++) {
    if (await evaluate("document.readyState === 'complete' && location.pathname === '/terminal/'")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const result = await evaluate(`(async () => {
    const db = await import('/terminal/src/lib/db.ts');
    const sync = await import('/terminal/src/lib/sync.ts');
    const origin = 'https://example.invalid';
    const terminalCode = 'SYNC-TEST';
    await db.setConfig({
      server_url: origin, terminal_code: terminalCode, terminal_id: 'test-terminal',
      terminal_name: 'Browser test', location_id: 'test-location', location_name: 'Test',
      price_level: 1, initial_sync_complete: false,
    });
    const original = { id: 'old', sku: 'OLD', name: 'Old safe catalog', price1: 1, active: true };
    await db.saveCatalogPage([], [original], true, origin, terminalCode, null);
    let secondPageFails = true;
    let billAccepted = false;
    let billsPosted = 0;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/sync/catalog') {
        if (!url.searchParams.has('cursor')) {
          return new Response(JSON.stringify({
            items: [{ id: 'new1', sku: 'NEW1', name: 'New item 1', price1: 2 }],
            categories: [], done: false, nextCursor: 'page-2',
          }), { status: 200 });
        }
        if (secondPageFails) {
          secondPageFails = false;
          return new Response('Unavailable', { status: 503 });
        }
        return new Response(JSON.stringify({
          items: [{ id: 'new2', sku: 'NEW2', name: 'New item 2', price1: 3 }],
          categories: [], done: true,
        }), { status: 200 });
      }
      if (url.pathname === '/api/pos/sync/cashiers') return new Response('[]', { status: 200 });
      if (url.pathname === '/api/sync/bills') {
        billsPosted++;
        return new Response(JSON.stringify({
          results: [{ orderNumber: 'TEST-BILL-1', status: billAccepted ? 'ok' : 'rejected' }],
        }), { status: 200 });
      }
      if (url.pathname === '/api/pos/terminals/test-terminal/heartbeat') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('Unexpected request to ' + url.pathname);
    };
    let firstFailed = false;
    try { await sync.syncCatalog(); } catch { firstFailed = true; }
    const oldProducts = await db.getProducts();
    const heldCursor = await db.getSyncCursor(origin, terminalCode);
    const partial = await db.getSyncSnapshot(origin, terminalCode);
    await sync.syncCatalog();
    const newProducts = await db.getProducts();
    const completed = await db.getSyncSnapshot(origin, terminalCode);
    await db.saveOrder({
      id: 'test-order', order_number: 'TEST-BILL-1', cashier_id: 'test-cashier', cashier_name: 'Test',
      subtotal: 1, discount_amount: 0, vat_amount: 0, total: 1, status: 'completed',
      created_at: new Date().toISOString(),
    }, []);
    await sync.flushOutbox();
    const rejected = await db.getOutbox();
    const firstBillCount = billsPosted;
    await sync.flushOutbox();
    const skippedBillCount = billsPosted;
    billAccepted = true;
    await sync.syncAll(true); // only an explicit retry can resubmit a rejected bill
    const finalOutbox = await db.getOutbox();
    const final = await db.getSyncSnapshot(origin, terminalCode);
    const state = await import('/terminal/src/lib/sync-state.ts');
    let releaseLock;
    const held = new Promise(resolve => {
      releaseLock = () => resolve();
    });
    let acquired;
    const acquisition = new Promise(resolve => { acquired = resolve; });
    const lock = navigator.locks.request(state.SYNC_LOCK, async () => { acquired(); await held; });
    await acquisition;
    await db.saveSyncSnapshot(origin, terminalCode, {
      ...final, phase: 'catalog-download', syncing: true,
    });
    const heldState = await state.refreshSyncSnapshot();
    let competingSyncRejected = false;
    try { await sync.syncCatalog(); } catch { competingSyncRejected = true; }
    releaseLock();
    await lock;
    const abandonedState = await state.refreshSyncSnapshot();
    await db.saveSyncSnapshot(origin, terminalCode, final);
    return {
      firstFailed, oldProductIds: oldProducts.map(p => p.id), heldCursor,
      partialPhase: partial.phase, partialCatalogSuccess: partial.lastCatalogSyncAt,
      newProductIds: newProducts.map(p => p.id).sort(), completedCatalogSuccess: completed.lastCatalogSyncAt,
      rejectedLength: rejected.length, rejectedRetryable: rejected[0]?.sync_retryable,
      firstBillCount, skippedBillCount, finalOutboxLength: finalOutbox.length,
      finalBillsConfirmed: final.transactionsConfirmed, finalSuccessAt: final.lastSuccessAt,
      heldPhase: heldState.phase, competingSyncRejected, abandonedPhase: abandonedState.phase,
    };
  })()`);
  assert.equal(result.firstFailed, true);
  assert.deepEqual(result.oldProductIds, ["old"]);
  assert.equal(result.heldCursor, "page-2");
  assert.equal(result.partialPhase, "failed");
  assert.equal(result.partialCatalogSuccess, null);
  assert.deepEqual(result.newProductIds, ["new1", "new2"]);
  assert.ok(result.completedCatalogSuccess);
  assert.equal(result.rejectedLength, 1);
  assert.equal(result.rejectedRetryable, false);
  assert.equal(result.skippedBillCount, result.firstBillCount);
  assert.equal(result.finalOutboxLength, 0);
  assert.equal(result.finalBillsConfirmed, 1);
  assert.ok(result.finalSuccessAt);
  assert.equal(result.heldPhase, "catalog-download");
  assert.equal(result.competingSyncRejected, true);
  assert.equal(result.abandonedPhase, "interrupted");
  await cdp("Page.enable");
  await cdp("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 70; i++) {
    if (await evaluate("document.readyState === 'complete'")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const persisted = await evaluate(`(async () => {
    const db = await import('/terminal/src/lib/db.ts');
    const s = await db.getSyncSnapshot('https://example.invalid', 'SYNC-TEST');
    return { confirmed: s.transactionsConfirmed, lastSuccessAt: s.lastSuccessAt, queue: (await db.getOutbox()).length };
  })()`);
  assert.equal(persisted.confirmed, 1);
  assert.equal(persisted.lastSuccessAt, result.finalSuccessAt);
  assert.equal(persisted.queue, 0);
  console.log("Browser sync smoke passed: staged catalog recovery, rejected bill retention, confirmed retry, Web Lock exclusion, interrupted recovery and reload persistence.");
} finally {
  connection?.close();
  if (chrome.exitCode === null) {
    const exited = once(chrome, "exit");
    chrome.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
    if (chrome.exitCode === null) { chrome.kill("SIGKILL"); await exited; }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}