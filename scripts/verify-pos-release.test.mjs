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

async function runVerifier(assets) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/latest.json") {
      response.end(JSON.stringify({
        version,
        platforms: { "windows-x86_64": { url: "https://example.test/installer", signature: "test" } },
      }));
      return;
    }
    response.end(JSON.stringify({
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      assets: assets.map((name) => ({
        name,
        browser_download_url: name === "latest.json"
          ? `http://127.0.0.1:${server.address().port}/latest.json`
          : `https://example.test/${name}`,
      })),
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [verifier, "example/globipos", `v${version}`], {
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