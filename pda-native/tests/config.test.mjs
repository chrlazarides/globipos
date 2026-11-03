import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("src-tauri/tauri.conf.json", root)));

test("PDA has its own app identity and uses the deployed HTTPS PDA", () => {
  assert.equal(config.identifier, "com.globipos.pda");
  assert.equal(config.productName, "GlobiPOS PDA");
  const url = new URL(config.app.windows[0].url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "globipos.shop");
  assert.equal(url.pathname, "/pda/");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
});

test("remote PDA receives no native commands, plugins or capabilities", () => {
  assert.deepEqual(config.app.security.capabilities, []);
  assert.equal(config.plugins, undefined);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  const rust = readFileSync(new URL("src-tauri/src/lib.rs", root), "utf8");
  assert.doesNotMatch(rust, /\.invoke_handler\s*\(|\.plugin\s*\(/);
  assert.equal(config.bundle.android.minSdkVersion, 24);
});

test("PDA release does not share the POS updater or signing configuration", () => {
  const workflow = readFileSync(new URL("../.github/workflows/build-pda-android.yml", root), "utf8");
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /--debug --apk/);
  assert.doesNotMatch(workflow, /gh release|secrets\.ANDROID_|TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /if-no-files-found: error/);
});
