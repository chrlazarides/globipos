import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, readdir, copyFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright";

const preview = process.argv.includes("--preview");
const dir = preview ? resolve("artifacts/mockup-sandbox/public/verification/split-tender")
  : await mkdtemp(resolve(tmpdir(), "split-tender-"));
await mkdir(dir, { recursive: true });
await build({ entryPoints: ["pos-app/tests/split-tender.fixture.tsx"], bundle: true,
  platform: "browser", format: "esm", jsx: "automatic", outfile: resolve(dir, "fixture.js"),
  alias: { "@": resolve("pos-app/src") } });
const css = (await readdir("pos-app/dist/assets")).find(name => name.endsWith(".css"));
await copyFile(resolve("pos-app/dist/assets", css), resolve(dir, "fixture.css"));
await writeFile(resolve(dir, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Split tender verification</title><link rel="icon" href="data:,"><link rel="stylesheet" href="./fixture.css"></head>
<body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>`);
if (preview) { console.log("Split fixture ready for screenshot."); process.exit(0); }
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  if (!["index.html", "fixture.js", "fixture.css"].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(resolve(dir, name)));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const load = async () => {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByTestId("split-tender-window").waitFor();
  };
  const claim = async (amount, method) => {
    await page.getByTestId("input-split-amount").fill(String(amount));
    await page.getByTestId(`btn-split-claim-${method}`).click();
  };
  await load();
  await claim(10, "cash");
  await claim(20, "card");
  await page.getByTestId("btn-payment-complete").click();
  let saved = await page.evaluate(() => window.savedPayments[0]);
  assert.deepEqual(saved.tenders.map(t => [t.method, t.amount]), [["cash", 10], ["card_jcc", 20]]);
  assert.equal(saved.changeDue, 0);
  assert.deepEqual(await page.evaluate(() => window.nativeOrders[0].payment_tenders), saved.tenders);
  console.log("PASS: split window claims €10 cash + €20 card and saves both portions.");

  await load();
  await claim(10, "cash");
  await page.getByTestId("input-split-amount").fill("25");
  assert.equal(await page.getByTestId("btn-split-claim-card").isDisabled(), true);
  await page.getByTestId("tab-payment-card").click();
  for (const digit of "2500") await page.getByTestId(`pkpad-${digit}`).click();
  await page.getByTestId("btn-process-card").click();
  assert.equal(await page.evaluate(() => window.cardCalls), 0);
  console.log("PASS: card overpayment is blocked before any gateway request.");

  await load();
  await page.evaluate(() => { window.cardMode = "delayed"; });
  await claim(10, "cash");
  await claim(20, "card");
  assert.equal(await page.getByTestId("btn-payment-complete").isDisabled(), true);
  assert.equal(await page.getByTestId("btn-payment-cancel").isDisabled(), true);
  assert.equal(await page.getByTestId("tab-payment-cash").isDisabled(), true);
  await page.evaluate(() => window.releaseCard());
  await page.waitForFunction(() => !document.querySelector('[data-testid="btn-payment-complete"]').disabled);
  const approvedRemove = page.locator('[data-testid^="tender-row-"]').filter({ hasText: "Card (JCC)" }).locator("button");
  assert.equal(await approvedRemove.isDisabled(), true);
  assert.equal(await page.getByTestId("btn-payment-cancel").isDisabled(), true);
  await page.evaluate(() => { window.rejectSave = true; });
  await page.getByTestId("btn-payment-complete").click();
  await page.getByTestId("payment-error").filter({ hasText: "TEST_SAVE_FAILED" }).waitFor();
  assert.equal(await page.evaluate(() => window.cardCalls), 1);
  assert.equal(await page.evaluate(() => window.orderNumbers), 1);
  await page.evaluate(() => { window.rejectSave = false; });
  await page.getByTestId("btn-payment-complete").click();
  assert.equal(await page.evaluate(() => window.savedPayments.length), 1);
  assert.deepEqual(await page.evaluate(() => window.saveAttempts[0]), await page.evaluate(() => window.saveAttempts[1]));
  assert.equal(await page.evaluate(() => window.cardCalls), 1);
  console.log("PASS: pending/approved cards cannot be cancelled or removed; failed save retries without another charge.");

  await load();
  await page.evaluate(() => { window.cardMode = "declined"; });
  await claim(10, "cash");
  await claim(20, "card");
  assert.equal(await page.getByTestId("btn-payment-complete").isDisabled(), true);
  assert.equal(await page.locator('[data-testid^="tender-row-"]').count(), 1);
  assert.equal(await page.getByTestId("btn-payment-cancel").isDisabled(), false);
  console.log("PASS: declined card leaves €20 unpaid and can be cancelled.");

  for (const mode of ["error", "missing-reference"]) {
    await load();
    await page.evaluate(mode => { window.cardMode = mode; }, mode);
    await claim(10, "cash");
    await claim(20, "card");
    assert.equal(await page.getByTestId("btn-split-claim-card").isDisabled(), true);
    assert.equal(await page.getByTestId("btn-payment-complete").isDisabled(), true);
    assert.equal(await page.getByTestId("btn-payment-cancel").isDisabled(), true);
    assert.equal(await page.evaluate(() => window.cardCalls), 1);
  }
  console.log("PASS: ambiguous card outcomes require verification and cannot be recharged.");

  await load();
  await page.getByTestId("input-split-amount").fill("5");
  await page.getByTestId("input-voucher-code").fill("GIFT");
  await page.getByTestId("btn-lookup-voucher").click();
  await page.getByTestId("btn-apply-voucher").click();
  await page.getByTestId("input-split-amount").fill("5");
  await page.getByTestId("input-credit-note-code").fill("NOTE");
  await page.getByTestId("btn-lookup-credit-note").click();
  await page.getByTestId("btn-apply-credit-note").click();
  await page.getByTestId("input-split-amount").fill("5");
  await page.getByTestId("btn-add-cheque").click();
  await claim(15, "cash");
  await page.getByTestId("btn-payment-complete").click();
  saved = await page.evaluate(() => window.savedPayments[0]);
  assert.deepEqual(saved.tenders.map(t => [t.method, t.amount]), [["voucher", 5], ["credit_note", 5], ["cheque", 5], ["cash", 15]]);
  console.log("PASS: voucher, credit-note and cheque portions use the explicitly claimed amounts.");
  await load();
  await claim(20, "card");
  await claim(15, "cash");
  await page.getByTestId("btn-payment-complete").click();
  assert.equal(await page.evaluate(() => window.savedPayments[0].changeDue), 5);
  assert.equal(await page.evaluate(() => window.nativeOrders[0].change_due), 5);
  console.log("PASS: split cash overpayment gives cash change and persists the correct amount.");
  await load();
  await page.setViewportSize({ width: 800, height: 1000 });
  assert.equal(await page.getByTestId("split-tender-window").isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  for (const size of [{ width: 1024, height: 768 }, { width: 402, height: 874 }]) {
    await page.setViewportSize(size);
    const dialog = page.getByTestId("payment-dialog");
    const bounds = await dialog.boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= size.height, "Payment window must fit vertically");
    assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth), false, "Payment controls must not overflow inside the dialog");
    assert.equal(await dialog.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    await page.getByTestId("btn-payment-complete").scrollIntoViewIfNeeded();
    assert.equal(await page.getByTestId("btn-payment-complete").isVisible(), true);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: tablet split window fits without horizontal overflow; no browser errors.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}