import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const defaultTauriDir = path.resolve(path.dirname(here), "../pos-app/src-tauri");
// Approved GlobiPOS product mark, never a customer-managed logo.
const productMarkHash = "4c5823371db86118b018da669dbc043684139a8f66693ef2e2309d4f18617a41";
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
const launcherFiles = new Set(["ic_launcher.png", "ic_launcher.xml", "ic_launcher_round.png", "ic_launcher_round.xml", "ic_launcher_foreground.png", "ic_launcher_foreground.xml"]);
const densities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
export const androidResources = [
  ...densities.flatMap(density => ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"].map(name => `mipmap-${density}/${name}`)),
  "mipmap-anydpi-v26/ic_launcher.xml",
  "values/ic_launcher_background.xml",
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function verifyNativeBranding(tauriDir = defaultTauriDir) {
  const config = JSON.parse(await readFile(path.join(tauriDir, "tauri.conf.json"), "utf8"));
  assert.equal(config.productName, "GlobiPOS Terminal", "Native product name must remain GlobiPOS Terminal");
  assert.equal(hash(await readFile(path.join(tauriDir, "app-icon.png"))), productMarkHash, "Native icon source must be the approved GlobiPOS product mark");
  for (const [name, size] of [["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256]]) {
    const relative = `icons/${name}`;
    assert.ok(config.bundle.icon.includes(relative), `Missing bundle icon: ${relative}`);
    const bytes = await readFile(path.join(tauriDir, relative));
    assert.ok(bytes.subarray(0, 8).equals(pngSignature), `Invalid PNG: ${relative}`);
    assert.equal(bytes.readUInt32BE(16), size, `Wrong icon width: ${relative}`);
    assert.equal(bytes.readUInt32BE(20), size, `Wrong icon height: ${relative}`);
  }
  for (const [relative, magic] of [["icons/icon.ico", Buffer.from("00000100", "hex")], ["icons/icon.icns", Buffer.from("icns")]]) {
    assert.ok(config.bundle.icon.includes(relative), `Missing bundle icon: ${relative}`);
    assert.ok((await readFile(path.join(tauriDir, relative))).subarray(0, 4).equals(magic), `Invalid native icon: ${relative}`);
  }
  assert.equal(config.bundle.windows?.nsis?.installerIcon, "icons/icon.ico", "Windows installer must explicitly use the GlobiPOS icon");
  assert.equal(config.bundle.windows?.nsis?.uninstallerIcon, "icons/icon.ico", "Windows uninstaller must explicitly use the GlobiPOS icon");
}

export async function verifyAndroidBranding(tauriDir = defaultTauriDir) {
  const source = path.join(tauriDir, "icons/android");
  const main = path.join(tauriDir, "gen/android/app/src/main");
  const manifest = await readFile(path.join(main, "AndroidManifest.xml"), "utf8");
  assert.match(manifest, /android:icon\s*=\s*["']@mipmap\/ic_launcher["']/, "Android manifest must reference the branded launcher");
  if (/android:roundIcon\s*=/.test(manifest)) {
    assert.match(manifest, /android:roundIcon\s*=\s*["']@mipmap\/ic_launcher_round["']/, "Android manifest must reference the branded round launcher");
  }
  for (const relative of androidResources) {
    const expected = await readFile(path.join(source, relative));
    const actual = await readFile(path.join(main, "res", relative));
    assert.equal(hash(actual), hash(expected), `Android resource does not match generated GlobiPOS branding: ${relative}`);
  }
  const adaptive = await readFile(path.join(source, "mipmap-anydpi-v26/ic_launcher.xml"));
  assert.ok(adaptive.equals(await readFile(path.join(main, "res/mipmap-anydpi-v26/ic_launcher_round.xml"))), "Round adaptive launcher must use the same GlobiPOS artwork");
  const res = path.join(main, "res");
  for (const directory of await readdir(res, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.startsWith("mipmap")) continue;
    for (const name of await readdir(path.join(res, directory.name))) {
      if (!launcherFiles.has(name)) continue;
      const relative = `${directory.name}/${name}`;
      assert.ok(androidResources.includes(relative) || relative === "mipmap-anydpi-v26/ic_launcher_round.xml", `Unexpected launcher override: ${relative}`);
    }
  }
}

export async function syncAndroidBranding(tauriDir = defaultTauriDir) {
  await verifyNativeBranding(tauriDir);
  const source = path.join(tauriDir, "icons/android");
  const res = path.join(tauriDir, "gen/android/app/src/main/res");
  assert.ok((await stat(res)).isDirectory(), "Initialize the Android project before installing its icons");
  // Validate all inputs before replacing only launcher-owned generated resources.
  for (const relative of androidResources) await readFile(path.join(source, relative));
  for (const directory of await readdir(res, { withFileTypes: true })) {
    if (!directory.isDirectory() || !directory.name.startsWith("mipmap")) continue;
    for (const name of await readdir(path.join(res, directory.name))) {
      if (launcherFiles.has(name)) await rm(path.join(res, directory.name, name));
    }
  }
  for (const relative of androidResources) {
    const target = path.join(res, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, relative), target);
  }
  await copyFile(path.join(source, "mipmap-anydpi-v26/ic_launcher.xml"), path.join(res, "mipmap-anydpi-v26/ic_launcher_round.xml"));
  await verifyAndroidBranding(tauriDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.every(arg => ["--sync-android", "--check-android"].includes(arg)), "Usage: node scripts/pos-branding.mjs [--sync-android | --check-android]");
    await verifyNativeBranding();
    if (args.includes("--sync-android")) await syncAndroidBranding();
    else if (args.includes("--check-android")) await verifyAndroidBranding();
    console.log("GlobiPOS native branding verified" + (args.length ? " (including Android launcher resources)." : "."));
  } catch (error) {
    console.error(`Native branding check failed: ${error.message}`);
    process.exitCode = 1;
  }
}