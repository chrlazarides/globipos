import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("./verify-pos-release.mjs", import.meta.url));
const version = "1.2.3";
const completeAssets = [
  `GlobiPOS.Terminal_${version}_x64_en-US.msi`,
  `GlobiPOS.Terminal_${version}_x64-setup.exe`,
  `GlobiPOS.Terminal_${version}_universal.dmg`,
  `GlobiPOS.Terminal_${version}_amd64.AppImage`,
  `GlobiPOS.Terminal_${version}_amd64.deb`,
  "app-arm64-v8a-release-signed.apk",
  "latest.json",
];

const completePlatforms = {
  "windows-x86_64": { url: "https://example.test/windows", signature: "windows-signature" },
  "linux-x86_64": { url: "https://example.test/linux", signature: "linux-signature" },
  "darwin-universal": { url: "https://example.test/macos", signature: "macos-signature" },
};

async function runVerifier(assets, { rawTag = `v${version}`, platforms = completePlatforms, mutateAssets } = {}) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/latest.json") {
      response.end(JSON.stringify({
        version,
        platforms,
      }));
      return;
    }
    response.end(JSON.stringify({
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
       assets: assets.map((name) => mutateAssets?.({
         name,
         state: "uploaded",
         size: 1024,
         browser_download_url: name === "latest.json"
           ? `http://127.0.0.1:${server.address().port}/latest.json`
           : `https://example.test/${name}`,
       }) ?? ({
        name,
         state: "uploaded",
         size: 1024,
        browser_download_url: name === "latest.json"
          ? `http://127.0.0.1:${server.address().port}/latest.json`
          : `https://example.test/${name}`,
      })),
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [verifier, "example/globipos", rawTag], {
    env: {
      ...process.env,
      GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
      GITHUB_TOKEN: "",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  await new Promise((resolve) => server.close(resolve));
  return { code, stdout, stderr };
}

test("accepts a complete signed multi-platform release", async () => {
  const result = await runVerifier(completeAssets);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /all desktop, Android, and updater assets are published/);
});

test("rejects a release missing its Windows installer", async () => {
  const result = await runVerifier(completeAssets.filter((name) => !name.endsWith(".exe")));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Windows EXE/);
});

test("accepts the latest release endpoint", async () => {
  const result = await runVerifier(completeAssets, { rawTag: "latest" });
  assert.equal(result.code, 0, result.stderr);
});

for (const [label, suffix] of [
  ["macOS DMG", ".dmg"],
  ["Linux AppImage", ".AppImage"],
  ["Linux DEB", ".deb"],
  ["Android APK", ".apk"],
]) {
  test(`rejects a release missing its ${label}`, async () => {
    const result = await runVerifier(completeAssets.filter((name) => !name.endsWith(suffix)));
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(label));
  });
}

test("rejects an empty or unprocessed release asset", async () => {
  const result = await runVerifier(completeAssets, {
    mutateAssets: (asset) => asset.name.endsWith(".msi") ? { ...asset, state: "new", size: 0 } : asset,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not ready/);
});

for (const [label, key] of [
  ["Windows", "windows-x86_64"],
  ["Linux", "linux-x86_64"],
  ["macOS", "darwin-universal"],
]) {
  test(`rejects missing ${label} updater metadata`, async () => {
    const platforms = { ...completePlatforms };
    delete platforms[key];
    const result = await runVerifier(completeAssets, { platforms });
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`no ${label} updater entry`));
  });

  test(`rejects missing ${label} updater signature`, async () => {
    const platforms = {
      ...completePlatforms,
      [key]: { ...completePlatforms[key], signature: "" },
    };
    const result = await runVerifier(completeAssets, { platforms });
    assert.equal(result.code, 1);
    assert.match(result.stderr, new RegExp(`no ${label} updater signature`));
  });
}