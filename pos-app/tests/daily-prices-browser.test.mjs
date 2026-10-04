import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, readdir, copyFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright";

const dir = await mkdtemp(resolve(tmpdir(), "daily-prices-ui-"));
await build({ entryPoints: ["pos-app/tests/daily-prices-ui.fixture.tsx"], bundle: true, platform: "browser",
  format: "esm", jsx: "automatic", outfile: resolve(dir, "grocery.js"),
  define: { __APP_VERSION__: '"test"', __BUILD_REFERENCE__: '"fixture"', __BUILD_ENVIRONMENT__: '"test"' } });
const css = (await readdir("pos-app/dist/assets")).find(n => n.endsWith(".css"));
await copyFile(resolve("pos-app/dist/assets", css), resolve(dir, "grocery.css"));
await copyFile("pos-app/tests/grocery-ui.fixture.html", resolve(dir, "index.html"));
const server = createServer(async (req, res) => {
  const name = req.url === "/" ? "index.html" : req.url.slice(1);
  if (!["index.html", "grocery.js", "grocery.css"].includes(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(resolve(dir, name)));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByTestId("grid-action-2").click();
  await page.getByLabel("Your cashier PIN").fill("1234");
  await page.getByRole("dialog", { name: "Price Change" }).getByRole("button", { name: "Fruit", exact: true }).click();
  await page.getByLabel("Bananas new price").waitFor();
  assert.equal(await page.getByLabel("Bananas new price").inputValue(), "");
  assert.ok((await page.getByLabel("Bananas new price").locator("..").locator("..").innerText()).includes("3.49"));
  await page.getByLabel("Bananas new price").fill("4.20");
  await page.getByRole("button", { name: "Save and print", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Price list is saved" }).waitFor();
  let state = await page.evaluate(() => window.dailyFixture);
  assert.equal(state.saves.length, 1);
  assert.deepEqual(state.saves[0].prices, [{ itemId: "banana", previousPrice: 3.49, price: 4.20 }]);
  assert.equal(state.saves[0].categoryId, "fruit");
  assert.equal(state.saves[0].cashierId, "clerk");
  assert.ok(state.prints[0].some(line => line.text === "EUR 4.20 / kg"));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("grid-cat-0").click();
  await page.getByTestId("grocery-product-banana").click();
  await page.locator('[data-testid^="ticket-line-"]').waitFor();
  const ticket = await page.locator('[data-testid^="ticket-line-"]').innerText();
  assert.ok(ticket.includes("Bananas") && ticket.includes("0.75") && ticket.includes("4.20"), ticket);
  assert.ok((await page.evaluate(() => window.dailyFixture.scaleReads)) > 0, "real POS handler must request a checkout-scale reading");
  await page.reload();
  await page.getByTestId("grid-cat-0").click();
  await page.getByTestId("grocery-product-banana").click();
  await page.locator('[data-testid^="ticket-line-"]').waitFor();
  assert.ok((await page.locator('[data-testid^="ticket-line-"]').innerText()).includes("4.20"), "saved prices survive reopening");
  await page.getByTestId("button-clear-order").click();
  // A normal background sync can leave the displayed item stale; selecting it must reload the local record.
  await page.evaluate(() => {
    const products = JSON.parse(localStorage.getItem("daily-server"));
    products.find(p => p.server_id === "banana").price2 = 4.50;
    localStorage.setItem("daily-server", JSON.stringify(products)); window.dailyFixture.sync();
  });
  await page.getByTestId("grocery-product-banana").click();
  await page.locator('[data-testid^="ticket-line-"]').waitFor();
  assert.ok((await page.locator('[data-testid^="ticket-line-"]').innerText()).includes("4.50"), "normal sync updates checkout without stale button prices");
  await page.getByTestId("button-clear-order").click();
  await page.reload();
  await page.getByTestId("grid-action-3").click();
  await page.getByLabel("Your cashier PIN").fill("1234");
  await page.getByRole("dialog", { name: "Price Change" }).getByRole("button", { name: "Bakery", exact: true }).click();
  await page.getByLabel("Baguette new price").fill("2.10");
  await page.evaluate(() => { window.dailyFixture.printFail = true; });
  await page.getByRole("button", { name: "Save and print", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Prices were saved" }).waitFor();
  assert.equal((await page.evaluate(() => window.dailyFixture.saves)).length, 1);
  await page.evaluate(() => { window.dailyFixture.printFail = false; });
  await page.getByRole("button", { name: "Print current list", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Price list is saved" }).waitFor();
  state = await page.evaluate(() => window.dailyFixture);
  assert.equal(state.saves.length, 1, "print retry must not save again");
  assert.deepEqual(state.printLogs.map(l => l.status), ["failed", "sent_to_printer"]);
  assert.ok(state.prints.at(-1).some(l => l.text === "EUR 2.10 / pc"));
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("grid-action-2").click();
  await page.getByLabel("Your cashier PIN").fill("1234");
  await page.getByRole("dialog", { name: "Price Change" }).getByRole("button", { name: "Fruit", exact: true }).click();
  await page.getByLabel("Bananas new price").fill("4.75");
  await page.evaluate(() => { window.dailyFixture.syncFail = true; });
  await page.getByRole("button", { name: "Save and print", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fixture sync unavailable" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.dailyFixture.syncFail = false; });
  await page.getByRole("button", { name: "Confirm saved prices and print", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Price list is saved" }).waitFor();
  assert.equal((await page.evaluate(() => window.dailyFixture.saves)).length, 2);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByTestId("grid-action-2").click();
  await page.getByLabel("Your cashier PIN").fill("1234");
  await page.evaluate(() => { window.dailyFixture.denied = true; });
  await page.getByRole("dialog", { name: "Price Change" }).getByRole("button", { name: "Bakery", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "do not have access" }).waitFor();
  assert.equal(await page.getByLabel("Baguette new price").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Daily prices: real native POS/UI, direct & conditional macro, category edits, live scale request, reopening, normal sync, access denial, print/sync retry passed.");
  // Keep compiled fixture for the separate static screenshot check.
  await writeFile("/tmp/daily-price-fixture-path", dir);
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
}