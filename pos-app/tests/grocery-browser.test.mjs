import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, readdir, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright";
const scaleProtocols = JSON.parse(await readFile("pos-app/scale-protocols.json", "utf8"));

const publicDir = await mkdtemp(resolve(tmpdir(), "grocery-ui-"));
await build({ entryPoints: ["pos-app/tests/grocery-ui.fixture.tsx"], bundle: true,
  platform: "browser", format: "esm", jsx: "automatic", outfile: resolve(publicDir, "grocery.js") });
const styles = (await readdir("pos-app/dist/assets")).find(name => name.endsWith(".css"));
if (!styles) throw new Error("Run the desktop frontend build before this test.");
await copyFile(resolve("pos-app/dist/assets", styles), resolve(publicDir, "grocery.css"));
await copyFile("pos-app/tests/grocery-ui.fixture.html", resolve(publicDir, "index.html"));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!["index.html", "grocery.js", "grocery.css"].includes(name)) { res.writeHead(404); res.end(); return; }
  try {
    const content = await readFile(resolve(publicDir, name));
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 850 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('[data-testid="grocery-product-item-0"]');
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 24);
  assert.ok((await page.locator('[data-testid="grocery-product-item-0"]').innerText()).includes("4011"));
  assert.ok((await page.locator('[data-testid="grocery-product-item-0"]').innerText()).includes("/kg"));
  assert.equal(await page.getByTestId("grocery-product-item-1").locator("img").count(), 1,
    "an available catalogue photo must render on the item button");
  // Check the actual large department key, not an ambiguously named tab.
  await page.getByTestId("category-tab-home").click();
  await page.getByTestId("grid-cat-1").waitFor();
  for (const key of ["2", "3", "0"]) await page.getByTestId(`corrections-numpad-${key}`).click();
  assert.ok((await page.getByTestId("text-correction-display").innerText()).includes("2.30"));
  await page.getByTestId("grid-cat-1").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 1);
  let state = await page.evaluate(() => ({ lines: window.posFixture.lines, digits: window.posFixture.digits, category: window.posFixture.category }));
  assert.equal(state.lines[0].line_total, 2.30);
  assert.equal(state.lines[0].category_id, "veg");
  assert.equal(state.lines[0].vat_rate, 5);
  assert.equal(state.digits, "");
  assert.equal(state.category, null, "a large department-key sale must not navigate");
  assert.equal(state.lines[0].qty, 1, "230 cents is an amount, never a quantity");
  assert.equal(await page.getByTestId("category-tabs").count(), 0, "the strip belongs to the submenu, not the main layout");
  await page.getByTestId("open-fast-keys").click();
  await page.waitForSelector('[data-testid="grocery-product-item-0"]');
  assert.equal(await page.evaluate(() => window.posFixture.lines.length), 1, "navigation must not add a sale");
  // The strip is operational for monetary entry too.
  for (const key of ["1", "2", "3"]) await page.getByTestId(`corrections-numpad-${key}`).click();
  await page.getByTestId("category-tab-veg").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 2);
  state = await page.evaluate(() => ({ lines: window.posFixture.lines, digits: window.posFixture.digits, category: window.posFixture.category }));
  assert.equal(state.lines[1].line_total, 1.23);
  assert.equal(state.lines[1].category_id, "veg");
  assert.equal(state.digits, "");
  assert.equal(state.category, "fruit", "a strip department sale must not navigate");
  await page.getByTestId("category-tab-veg").click();
  await page.waitForSelector('[data-testid="grocery-product-item-279"]');
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 1, "strip must change the displayed products");
  await page.getByTestId("category-tab-fruit").click();
  await page.waitForSelector('[data-testid="grocery-product-item-0"]');
  for (const reading of [
    null, { kg: 0, grams: 0, stable: true }, { kg: -.75, grams: -750, stable: true },
    { kg: .75, grams: 750, stable: false },
  ]) {
    await page.evaluate(value => window.posFixture.setReading(value), reading);
    await page.getByTestId("grocery-product-item-0").click();
    await page.waitForFunction(() =>
      window.posFixture.error && document.querySelector('[data-testid="grocery-product-item-0"]').getAttribute("aria-busy") === "false");
    assert.equal(await page.evaluate(() => window.posFixture.lines.length), 2, "unusable scale readings must not add a sale");
  }
  await page.evaluate(() => window.posFixture.setReading({ kg: .75, grams: 750, stable: true }));
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="grocery-product-item-0"]');
    button.click(); button.click();
  });
  await page.waitForFunction(() => window.posFixture.lines.length === 3);
  assert.equal(await page.evaluate(() => window.posFixture.lines[2].qty), .75);
  assert.equal(await page.evaluate(() => window.posFixture.lines[2].line_total), 2.35,
    "0.750 kg at the fixture's €2.99 net/kg, plus 5% VAT, must charge €2.35");
  await page.getByRole("button", { name: "Hold test order", exact: true }).click();
  assert.equal(await page.evaluate(() => window.posFixture.lines.length), 0);
  await page.getByRole("button", { name: "Recall test order", exact: true }).click();
  state = await page.evaluate(() => window.posFixture.lines);
  assert.equal(state[0].line_total, 2.30);
  assert.equal(state[0].price_includes_vat, true);
  assert.equal(state[2].qty, .75);
  assert.equal(state[2].line_total, 2.35);
  assert.equal(await page.getByTestId("scale-simulated").count(), 1);
  await page.getByRole("button", { name: "8x4", exact: true }).click();
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 32);
  await page.getByTestId("category-next").click();
  assert.equal(await page.locator('[data-testid="grocery-product-item-32"]').count(), 1);
  await page.getByTestId("category-tab-bread").click();
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 3);
  await page.getByTestId("category-tab-ice-bags").click();
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 3);
  await page.getByTestId("fast-key-plu-search").fill("4011");
  await page.getByTestId("grocery-product-item-0").waitFor();
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 1, "PLU lookup must ignore the selected category and page");
  assert.equal(await page.evaluate(() => window.posFixture.lines.length), 3, "search must not automatically sell an item");
  await page.getByTestId("fast-key-plu-search").fill("nonexistent");
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 0, "unknown PLU must not leave a stale product selectable");
  await page.getByTestId("clear-plu-search").click();
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 3);
  await page.getByRole("button", { name: "Test money keypad", exact: true }).click();
  for (const key of ["2", "3", "0"]) await page.getByTestId(`numpad-${key}`).click();
  await page.getByTestId("numpad-confirm").click();
  assert.equal(await page.evaluate(() => window.posFixture.confirmed), 2.30);
  await page.getByRole("button", { name: "Test quantity keypad", exact: true }).click();
  for (const key of ["2", "3", "0"]) await page.getByTestId(`numpad-${key}`).click();
  await page.getByTestId("numpad-confirm").click();
  assert.equal(await page.evaluate(() => window.posFixture.confirmed), 230);
  await page.getByRole("button", { name: "Scale settings", exact: true }).click();
  assert.equal(await page.getByLabel("Scale protocol", { exact: true }).locator("option").count(), scaleProtocols.length);
  for (const protocol of scaleProtocols) {
    await page.getByLabel("Scale protocol", { exact: true }).selectOption(protocol.id);
    assert.equal(await page.getByLabel("Scale protocol", { exact: true }).inputValue(), protocol.id);
  }
  await page.getByLabel("Scale model / protocol variant").fill("Custom checkout model / vendor protocol v1");
  await page.getByTestId("save-hardware-config").click();
  await page.getByRole("button", { name: "Saved!", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to till", exact: true }).click();
  await page.getByRole("button", { name: "Scale settings", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Scale protocol"]')?.value === "custom");
  assert.equal(await page.getByLabel("Scale model / protocol variant").inputValue(), "Custom checkout model / vendor protocol v1");
  await page.getByLabel("Scale source").selectOption("simulated");
  await page.getByLabel("Scale protocol").selectOption("cas");
  await page.getByLabel("Simulated units").selectOption("g");
  await page.getByLabel("Simulated weight", { exact: true }).fill("750");
  await page.getByRole("button", { name: "Save Configuration", exact: true }).click();
  await page.getByRole("button", { name: "Saved!", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Scale settings", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Simulated weight"]')?.value === "750");
  assert.equal(await page.getByLabel("Scale protocol").inputValue(), "cas");
  assert.equal(await page.getByLabel("Physical scale port").inputValue(), "COM3");
  await page.getByRole("button", { name: "Test", exact: true }).first().click();
  await page.getByRole("status").filter({ hasText: "0.750 kg / 750 g — Stable" }).waitFor();
  await page.getByRole("button", { name: "Back to till", exact: true }).click();
  await page.getByTestId("grocery-product-item-0").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 1);
  assert.equal(await page.evaluate(() => window.posFixture.lines[0].qty), .75);
  assert.equal(await page.evaluate(() => window.posFixture.lines[0].line_total), 2.35);
  for (const [readingState, value] of [["unstable", "750"], ["stable", "0"], ["disconnected", "750"]]) {
    await page.getByRole("button", { name: "Scale settings", exact: true }).click();
    await page.getByLabel("Simulated reading state").selectOption(readingState);
    await page.getByLabel("Simulated weight", { exact: true }).fill(value);
    await page.getByTestId("save-hardware-config").click();
    await page.getByRole("button", { name: "Saved!", exact: true }).waitFor();
    await page.getByRole("button", { name: "Back to till", exact: true }).click();
    await page.getByTestId("grocery-product-item-0").click();
    await page.waitForFunction(() => window.posFixture.error);
    assert.equal(await page.evaluate(() => window.posFixture.lines.length), 1, `${readingState}/${value} must not sell`);
  }
  await page.getByRole("button", { name: "Scale settings", exact: true }).click();
  await page.getByLabel("Scale source").selectOption("physical");
  await page.getByRole("button", { name: "Save Configuration", exact: true }).click();
  await page.getByRole("button", { name: "Saved!", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back to till", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="scale-simulated"]'));
  await page.getByTestId("grocery-product-item-0").click();
  await page.waitForFunction(() => window.posFixture.error);
  assert.equal(await page.evaluate(() => window.posFixture.lines.length), 1, "Physical failure must never fall back to simulator weight");
  await page.goto(`http://127.0.0.1:${server.address().port}/?fresh`);
  await page.waitForSelector('[data-testid="grocery-product-item-0"]');
  assert.equal(await page.locator('[data-testid^="grocery-product-"]').count(), 12,
    "Fresh must open its photo grid directly with three columns");
  assert.equal(await page.getByTestId("open-fast-keys").count(), 0);
  await page.getByTestId("category-cols-8").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="grocery-product-"]').length === 32);
  await page.getByTestId("category-cols-3").click();
  await page.getByTestId("fast-key-plu-search").fill("Apples");
  await page.getByTestId("plu-results").getByTestId("grocery-product-item-1").waitFor();
  await page.getByTestId("fast-key-plu-search").fill("4011");
  await page.getByTestId("plu-results").getByTestId("grocery-product-item-0").waitFor();
  assert.equal(await page.getByTestId("plu-results").locator('[data-testid^="grocery-product-"]').count(), 1);
  await page.getByTestId("clear-plu-search").click();
  await page.getByTestId("fresh-controls").click();
  for (const key of ["2", "8", "0"]) await page.getByTestId(`corrections-numpad-${key}`).click();
  await page.getByTestId("category-tab-bread").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 1);
  assert.equal(await page.evaluate(() => window.posFixture.lines[0].line_total), 2.8,
    "Fresh department entry must retain the VAT-inclusive €2.80 total");
  assert.equal(await page.evaluate(() => window.posFixture.lines[0].description), "Bakery");
  await page.getByTestId("category-tab-bread").click();
  await page.getByTestId("grocery-product-extra-1").click();
  await page.waitForFunction(() => window.posFixture.lines.length === 2);
  assert.deepEqual(errors, []);
  console.log("PASS: Fresh direct 3-column grid, 8-column option, name/PLU lookup, €2.80 VAT-inclusive department entry and Bakery item sale.");
  console.log("PASS: grocery pricing, €2.30 hold/recall, duplicate-tap prevention, peripheral settings reload, kg/gram simulator conversion, configured unstable/zero/disconnected rejection and no physical-failure fallback; no browser errors.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(publicDir, { recursive: true, force: true });
}