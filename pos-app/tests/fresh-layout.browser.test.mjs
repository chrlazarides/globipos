import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, readdir, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright";

const dir = await mkdtemp(resolve(tmpdir(), "fresh-layout-"));
await build({ entryPoints: ["pos-app/tests/grocery-ui.fixture.tsx"], bundle: true,
  platform: "browser", format: "esm", jsx: "automatic", outfile: resolve(dir, "grocery.js") });
const css = (await readdir("pos-app/dist/assets")).find(name => name.endsWith(".css"));
await copyFile(resolve("pos-app/dist/assets", css), resolve(dir, "grocery.css"));
await copyFile("pos-app/tests/grocery-ui.fixture.html", resolve(dir, "index.html"));
console.log("Fresh fixture built.");
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const name = path === "/" ? "index.html" : path.slice(1);
  if (!["index.html", "grocery.js", "grocery.css"].includes(name)) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(resolve(dir, name)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium",
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?fresh`);
  await page.getByTestId("grocery-product-item-0").waitFor();
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 12);
  assert.equal(await page.getByTestId("open-fast-keys").count(), 0);
  assert.equal(await page.getByTestId("fresh-pay_card").isDisabled(), true);
  console.log("Fresh opens directly with 3-column photo tiles.");
  await page.getByTestId("category-cols-8").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="grocery-product-"]').length === 32);
  await page.getByTestId("category-cols-3").click();
  await page.getByTestId("fast-key-plu-search").fill("Apples");
  await page.getByTestId("plu-results").getByTestId("grocery-product-item-1").waitFor();
  await page.getByTestId("fast-key-plu-search").fill("4011");
  await page.getByTestId("plu-results").getByTestId("grocery-product-item-0").waitFor();
  assert.equal(await page.getByTestId("plu-results").locator('[data-testid^="grocery-product-"]').count(), 1);
  console.log("Grid options, product-name search and exact PLU lookup pass.");
  await page.getByTestId("clear-plu-search").click();
  await page.getByTestId("fresh-controls").click();
  for (const digit of ["2", "8", "0"]) await page.getByTestId(`corrections-numpad-${digit}`).click();
  await page.getByTestId("category-tab-bread").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 1);
  assert.equal(await page.evaluate(() => window.posFixture.lines[0].line_total), 2.8);
  assert.equal(await page.evaluate(() => window.posFixture.lines[0].description), "Bakery");
  await page.getByTestId("category-tab-bread").click();
  await page.getByTestId("grocery-product-extra-1").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 2);
  for (const code of ["PAY_CASH", "PAY_CARD", "PAY_SPLIT"]) {
    await page.getByTestId(`fresh-${code.toLowerCase()}`).click();
  }
  assert.deepEqual(await page.evaluate(() => window.posActions), ["PAY_CASH", "PAY_CARD", "PAY_SPLIT"]);
  await page.getByTestId("fresh-layout-functions").click();
  await page.getByTestId("grid-action-25").click();
  await page.getByTestId("grid-action-26").click();
  assert.deepEqual(await page.evaluate(() => window.posActions), ["PAY_CASH", "PAY_CARD", "PAY_SPLIT", "REFUND", "REPORT_X"]);
  await page.getByTestId("fresh-layout-functions").click();
  await page.getByTestId("grocery-product-extra-1").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: Fresh department entry, Bakery sale, cash/card/split actions, assigned refund/report buttons, product return; no browser errors.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}