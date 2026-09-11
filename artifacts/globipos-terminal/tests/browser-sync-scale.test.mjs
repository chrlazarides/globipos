import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const artifactRoot = path.resolve(import.meta.dirname, "..");
const port = 43117;
const baseUrl = `http://127.0.0.1:${port}/terminal/tests/browser-sync-scale.html`;

async function waitForServer(server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the scale-test server");
}

async function runBrowser(profile, url) {
  const browser = spawn("chromium", [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    url,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let diagnostics = "";

  try {
    const debuggerUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out starting Chromium\n${diagnostics}`)), 10_000);
      browser.stderr.on("data", (chunk) => {
        diagnostics += chunk;
        const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      browser.on("error", reject);
      browser.on("exit", (code) => reject(new Error(`Chromium exited ${code}\n${diagnostics}`)));
    });

    const { port } = new URL(debuggerUrl);
    let page;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      page = pages.find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl));
      if (page) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(page, `Could not find scale-test page\n${diagnostics}`);

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let commandId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    const evaluate = (expression) => new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true },
      }));
    });

    for (let attempt = 0; attempt < 1_200; attempt += 1) {
      const response = await evaluate(`({
        status: document.querySelector("#result")?.dataset.status,
        text: document.querySelector("#result")?.textContent
      })`);
      const value = response.result.value;
      if (value?.status === "failed") throw new Error(`Browser test failed:\n${value.text}`);
      if (value?.status === "passed") {
        socket.close();
        return JSON.parse(value.text);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for browser test\n${diagnostics}`);
  } finally {
    browser.kill("SIGTERM");
    await new Promise((resolve) => browser.once("exit", resolve));
  }
}

test("130,000-product browser sync survives repeated browser restarts", { timeout: 120_000 }, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "globipos-browser-sync-"));
  const server = spawn("pnpm", ["exec", "vite", "--config", "vite.config.ts", "--host", "127.0.0.1"], {
    cwd: artifactRoot,
    env: { ...process.env, PORT: String(port), BASE_PATH: "/terminal/" },
    stdio: "ignore",
  });

  try {
    await waitForServer(server);
    const checkpoints = [9_250, 43_250, 102_750, 130_000];
    const results = [];

    for (const stopAfter of checkpoints) {
      results.push(await runBrowser(profile, `${baseUrl}?stopAfter=${stopAfter}`));
    }

    assert.deepEqual(results.map((entry) => entry.productCount), checkpoints);
    assert.deepEqual(results.map((entry) => entry.cursor), ["9250", "43250", "102750", null]);
    assert.deepEqual(results.map((entry) => entry.firstRequestedOffset), [0, 9250, 43250, 102750]);
    assert.equal(results.at(-1).productCount, 130_000);
  } finally {
    server.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true });
  }
});