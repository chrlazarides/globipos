import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchWithRetry, hashPin, HttpError, normalizeServerUrl } from "./utils.ts";

test("normalizes only an HTTPS origin", () => {
  assert.equal(normalizeServerUrl("store.globipos.shop"), "https://store.globipos.shop");
  assert.equal(normalizeServerUrl("https://STORE.globipos.shop:443/"), "https://store.globipos.shop");
  assert.throws(() => normalizeServerUrl("http://store.globipos.shop"), /HTTPS/);
  assert.throws(() => normalizeServerUrl("https://store.globipos.shop/api"), /path allowed/);
  assert.throws(() => normalizeServerUrl("https://user:pass@store.globipos.shop"), /credentials/);
});

test("hashes cashier PINs as lowercase SHA-256", async () => {
  const expected = createHash("sha256").update("1234").digest("hex");
  assert.equal(await hashPin("1234"), expected);
});

test("retries interrupted successful response bodies four times", async (t) => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts < 4) {
      return { ok: true, text: async () => { throw new TypeError("interrupted"); } } as Response;
    }
    return new Response('{"ok":true}', { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.equal(await fetchWithRetry("https://store.example/api/sync/catalog", {}, [0, 0, 0]), '{"ok":true}');
  assert.equal(attempts, 4);
});

test("does not retry HTTP errors", async (t) => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response("denied", { status: 403 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await assert.rejects(
    fetchWithRetry("https://store.example/api/sync/catalog", {}, [0, 0, 0]),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
  assert.equal(attempts, 1);
});