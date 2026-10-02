import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { androidResources, syncAndroidBranding, verifyAndroidBranding, verifyNativeBranding } from "./pos-branding.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "pos-app/src-tauri");
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "globipos-branding-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ["tauri.conf.json", "app-icon.png", "icons"]) await cp(path.join(source, file), path.join(dir, file), { recursive: true });
  const main = path.join(dir, "gen/android/app/src/main");
  await mkdir(path.join(main, "res"), { recursive: true });
  await writeFile(path.join(main, "AndroidManifest.xml"), '<manifest><application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round" /></manifest>');
  return { dir, main, res: path.join(main, "res") };
}

test("desktop bundles and Windows installer/uninstaller use the approved product branding", async () => {
  await verifyNativeBranding(source);
});

test("a substituted customer logo fails the product-branding guard", async t => {
  const { dir } = await fixture(t);
  await writeFile(path.join(dir, "app-icon.png"), "customer logo");
  await assert.rejects(verifyNativeBranding(dir), /approved GlobiPOS product mark/);
});

test("omitting either Windows installer icon fails verification", async t => {
  const { dir } = await fixture(t);
  const config = JSON.parse(await readFile(path.join(dir, "tauri.conf.json"), "utf8"));
  for (const key of ["installerIcon", "uninstallerIcon"]) {
    const copy = structuredClone(config);
    delete copy.bundle.windows.nsis[key];
    await writeFile(path.join(dir, "tauri.conf.json"), JSON.stringify(copy));
    await assert.rejects(verifyNativeBranding(dir), /Windows .*installer must explicitly/);
  }
});

test("Android sync replaces default icons at all densities, including round adaptive icons", async t => {
  const { dir, res } = await fixture(t);
  await mkdir(path.join(res, "mipmap-anydpi-v33"));
  await writeFile(path.join(res, "mipmap-anydpi-v33/ic_launcher.xml"), "default Tauri adaptive icon");
  await mkdir(path.join(res, "values"));
  await writeFile(path.join(res, "values/strings.xml"), "<resources>Keep application settings</resources>");
  await syncAndroidBranding(dir);
  await verifyAndroidBranding(dir);
  for (const relative of androidResources) assert.ok((await readFile(path.join(res, relative))).equals(await readFile(path.join(dir, "icons/android", relative))));
  assert.equal(await readFile(path.join(res, "values/strings.xml"), "utf8"), "<resources>Keep application settings</resources>");
  await syncAndroidBranding(dir); // Safe to repeat during a build.
});

test("Android verification rejects corrupted icons and newer-API launcher overrides", async t => {
  const { dir, res } = await fixture(t);
  await syncAndroidBranding(dir);
  await writeFile(path.join(res, "mipmap-xxxhdpi/ic_launcher.png"), "incorrect icon");
  await assert.rejects(verifyAndroidBranding(dir), /does not match generated GlobiPOS branding/);
  await syncAndroidBranding(dir);
  await mkdir(path.join(res, "mipmap-anydpi-v33"));
  await writeFile(path.join(res, "mipmap-anydpi-v33/ic_launcher.xml"), "default icon");
  await assert.rejects(verifyAndroidBranding(dir), /Unexpected launcher override/);
});

test("Android branding cannot silently create an uninitialized Android project", async t => {
  const { dir } = await fixture(t);
  await rm(path.join(dir, "gen"), { recursive: true });
  await assert.rejects(syncAndroidBranding(dir), /ENOENT/);
});

test("Android manifest must point to the icons being verified", async t => {
  const { dir, main } = await fixture(t);
  await writeFile(path.join(main, "AndroidManifest.xml"), '<manifest><application android:icon="@drawable/default_logo" /></manifest>');
  await assert.rejects(syncAndroidBranding(dir), /manifest must reference/);
});

test("Android templates without a separate roundIcon still use the branded adaptive launcher", async t => {
  const { dir, main } = await fixture(t);
  await writeFile(path.join(main, "AndroidManifest.xml"), '<manifest><application android:icon="@mipmap/ic_launcher" /></manifest>');
  await syncAndroidBranding(dir);
  await verifyAndroidBranding(dir);
});

test("release pipeline applies Android icons after initialization and before APK build", async () => {
  const workflow = await readFile(path.join(root, ".github/workflows/build-pos.yml"), "utf8");
  const initialize = workflow.indexOf("run: npx tauri android init");
  const generate = workflow.indexOf("run: npx tauri icon src-tauri/app-icon.png", initialize);
  const sync = workflow.indexOf("run: node scripts/pos-branding.mjs --sync-android");
  const build = workflow.indexOf("run: npx tauri android build");
  assert.ok(initialize >= 0 && initialize < generate && generate < sync && sync < build);
  assert.ok(workflow.includes("node scripts/pos-branding.mjs\n"));
  assert.ok(workflow.includes("scripts/pos-branding.test.mjs"));
});