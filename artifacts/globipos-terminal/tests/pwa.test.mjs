import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("../public/manifest.json", import.meta.url);
const serviceWorkerUrl = new URL("../public/sw.js", import.meta.url);
const databaseUrl = new URL("../src/lib/db.ts", import.meta.url);
const backOfficeServiceWorkerUrl = new URL("../../globipos/public/sw.js", import.meta.url);

test("manifest identifies an independent installable Terminal PWA", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.equal(manifest.name, "GlobiPOS Terminal");
  assert.equal(manifest.id, "/terminal/");
  assert.equal(manifest.start_url, "/terminal/");
  assert.equal(manifest.scope, "/terminal/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  assert.ok(manifest.icons.every((icon) => icon.purpose.includes("maskable")));
});

test("service worker caches only the Terminal shell and excludes APIs", async () => {
  const source = await readFile(serviceWorkerUrl, "utf8");
  assert.match(source, /globipos-terminal-shell-v\d+/);
  assert.match(source, /includes\('\/api\/'\)/);
  assert.match(source, /\/terminal\/index\.html/);
  assert.match(source, /matchAll\(\/\(\?:src\|href\)/);
  assert.match(source, /\/terminal\/assets\//);
  assert.doesNotMatch(source, /cache\.put\(.*api/i);
  assert.match(source, /name\.startsWith\('globipos-terminal-'\)/);
});

test("Terminal and back-office service workers delete only caches they own", async () => {
  const terminalSource = await readFile(serviceWorkerUrl, "utf8");
  const backOfficeSource = await readFile(backOfficeServiceWorkerUrl, "utf8");
  assert.match(terminalSource, /name\.startsWith\('globipos-terminal-'\)/);
  assert.match(backOfficeSource, /name\.startsWith\('vintrade-'\)/);
  assert.doesNotMatch(terminalSource, /\.filter\(\(name\) => name !== CACHE_NAME\)/);
});

test("browser database declares the required persistent stores", async () => {
  const source = await readFile(databaseUrl, "utf8");
  for (const store of ["config", "cashiers", "products", "categories", "orders", "order_lines", "outbox", "sync_cursor", "audit"]) {
    assert.match(source, new RegExp(`createObjectStore\\("${store}"`));
  }
});