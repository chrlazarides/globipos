import test from "node:test";
import assert from "node:assert/strict";
import { searchStoreProducts } from "../src/lib/store-lookup.ts";
const config: any = { server_url: "https://shop.example", terminal_code: "TEST-A" };
test("lookup searches the shared catalogue and does not request a terminal category filter", async () => {
  const products = await searchStoreProducts(config, "not downloaded", (async (url: string, init: any) => {
    assert.equal(new URL(url).pathname, "/api/pos/stock/search");
    assert.equal(new URL(url).searchParams.get("q"), "not downloaded");
    assert.equal(new URL(url).searchParams.has("categoryIds"), false);
    assert.equal(init.headers["X-Terminal-Code"], "TEST-A");
    return new Response(JSON.stringify({ items: [{
      id: "outside-list", name: "Other store product", sku: "OTHER",
      price1: "2.50", price2: "0", price3: 0, price4: 0, price5: 0,
    }] }));
  }) as typeof fetch);
  assert.equal(products[0].server_id, "outside-list");
  assert.equal(products[0].price1, 2.5);
});
test("lookup failures are explicit, not empty results or fabricated prices", async () => {
  await assert.rejects(searchStoreProducts(config, "test", (async () => new Response("", { status: 503 })) as typeof fetch), /unavailable/);
  await assert.rejects(searchStoreProducts(config, "test", (async () => new Response('{"items":[{"id":"bad","name":"Bad","sku":"BAD"}]}')) as typeof fetch), /price/);
  await assert.rejects(searchStoreProducts(null, "test"), /Configure/);
});