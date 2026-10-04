import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, readdir, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright";

const dir = await mkdtemp(resolve(tmpdir(), "native-startup-"));
await build({ entryPoints: ["pos-app/tests/startup-ui.fixture.tsx"], bundle: true, platform: "browser",
  format: "esm", jsx: "automatic", outfile: resolve(dir, "grocery.js"),
  alias: { "@tauri-apps/api/core": resolve("pos-app/tests/startup-invoke.fixture.ts"),
    "@tauri-apps/plugin-store": resolve("pos-app/tests/startup-store.fixture.ts") },
  define: { __APP_VERSION__: '"fixture"', __BUILD_REFERENCE__: '"fixture"', __BUILD_ENVIRONMENT__: '"test"' } });
const css = (await readdir("pos-app/dist/assets")).find(name => name.endsWith(".css"));
await copyFile(resolve("pos-app/dist/assets", css), resolve(dir, "grocery.css"));
await copyFile("pos-app/tests/grocery-ui.fixture.html", resolve(dir, "index.html"));
const server = createServer(async (req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  if (!["index.html", "grocery.js", "grocery.css"].includes(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(resolve(dir, name)));
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const sync = page.getByTestId("button-sync-details");
  await sync.click();
  await page.getByTestId("button-close-sync").click();
  assert.equal(await page.getByTestId("panel-sync-details").count(), 0);
  await sync.click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByTestId("panel-sync-details").count(), 0);
  assert.equal(await sync.evaluate(el => el === document.activeElement), true);
  await sync.click();
  await page.getByTestId("sell-item").click();
  assert.equal(await page.getByTestId("panel-sync-details").count(), 0);
  assert.equal(await page.locator("#sale-result").textContent(), "Item added");
  await page.setViewportSize({ width: 1024, height: 600 });
  await sync.click();
  const panel = await page.getByTestId("panel-sync-details").boundingBox();
  assert.ok(panel.y + panel.height <= 600, "sync panel should stay within short viewport");
  await page.getByTestId("button-close-sync").click();
  console.log("PASS: Sync closes by close button, Escape and outside click; sale click continues.");

  for (const [pin, name] of [["1234", "First cashier"], ["87654321", "Second cashier"]]) {
    await page.goto(`${url}/?login`);
    await page.getByRole("status").filter({ hasText: "2 active cashiers synced" }).waitFor();
    assert.equal(await page.evaluate(() => window.nativeFixture.refreshes), 1);
    await page.getByTestId("button-refresh-cashiers").click();
    await page.getByRole("status").filter({ hasText: "2 active cashiers synced" }).waitFor();
    assert.equal(await page.evaluate(() => window.nativeFixture.refreshes), 2);
    for (const digit of pin) await page.getByTestId(`button-pin-${digit}`).click();
    await page.getByTestId("button-pin-sign-in").click();
    await page.getByTestId("signed-in").waitFor();
    assert.equal(await page.getByTestId("signed-in").textContent(), name);
  }
  await page.goto(`${url}/?login`);
  await page.getByRole("status").filter({ hasText: "2 active cashiers synced" }).waitFor();
  await page.evaluate(() => { window.nativeFixture.rejectRefresh = true; });
  await page.getByTestId("button-refresh-cashiers").click();
  await page.getByRole("status").filter({ hasText: "using previously synced PINs" }).waitFor();
  for (const digit of "1234") await page.getByTestId(`button-pin-${digit}`).click();
  await page.getByTestId("button-pin-sign-in").click();
  await page.getByTestId("signed-in").waitFor();
  await page.goto(`${url}/?configure`);
  await page.getByRole("status").filter({ hasText: "2 active cashiers synced" }).waitFor();
  await page.getByTestId("button-configure-terminal").click();
  assert.equal(await page.getByTestId("input-server-url").inputValue(), "https://fixture.invalid");
  assert.equal(await page.getByTestId("input-terminal-code").inputValue(), "FIXTURE-1");
  await page.getByTestId("input-terminal-code").fill("FIXTURE-2");
  await page.getByTestId("button-cancel-setup").click();
  await page.getByTestId("button-configure-terminal").click();
  assert.equal(await page.getByTestId("input-terminal-code").inputValue(), "FIXTURE-1");
  await page.getByTestId("input-server-url").fill("not-a-server");
  await page.getByTestId("button-register").click();
  await page.getByText("Please enter a valid server URL and terminal code.").waitFor();
  await page.getByTestId("input-server-url").fill("https://other-fixture.invalid");
  await page.getByTestId("input-terminal-code").fill("fixture-2");
  await page.evaluate(() => { window.nativeFixture.blockSwitch = true; });
  await page.getByTestId("button-register").click();
  await page.getByText("Cannot switch yet:", { exact: false }).waitFor();
  assert.equal(await page.getByTestId("button-restart-pos").count(), 0);
  await page.evaluate(() => { window.nativeFixture.blockSwitch = false; });
  await page.getByTestId("button-register").click();
  await page.getByTestId("button-restart-pos").waitFor();
  assert.deepEqual(await page.evaluate(() => window.nativeFixture.registered), {
    serverUrl: "https://other-fixture.invalid", terminalCode: "FIXTURE-2",
  });
  assert.equal(await page.getByTestId("button-cancel-setup").count(), 0, "cannot resume old pool after new profile is saved");
  await page.getByTestId("button-restart-pos").click();
  assert.equal(await page.evaluate(() => window.nativeFixture.restarted), true);
  const isolation = await page.evaluate(async () => {
    const first = { server_url: "https://one.invalid", terminal_code: "ONE" };
    const second = { ...first, terminal_code: "TWO" };
    const third = { ...first, server_url: "https://two.invalid" };
    await window.deviceFixture.writeDeviceKey("synthetic-fixture-key", first);
    return [
      await window.deviceFixture.readDeviceKey(first),
      await window.deviceFixture.readDeviceKey(second),
      await window.deviceFixture.readDeviceKey(third),
    ];
  });
  assert.deepEqual(isolation, ["synthetic-fixture-key", "", ""]);
  assert.deepEqual(errors, []);
  console.log("PASS: Startup/manual cashier refresh, two cashiers (4/8 digits), failed-refresh fallback; no browser errors.");
  console.log("PASS: Configure/cancel/save/restart, invalid URL and unsynced-sales block; device keys stay scoped to server/till.");
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  await rm(dir, { recursive: true, force: true });
}