import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyPublishedBranding } from "./pos-release-branding.mjs";

const sourceHash = "4c5823371db86118b018da669dbc043684139a8f66693ef2e2309d4f18617a41";
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "package-branding-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const specs = {
    windows: { "pos.msi": ["MSI application icon"], "pos-setup.exe": ["NSIS setup icon", "installed application icon", "installed uninstaller icon"] },
    macos: { "pos.dmg": ["DMG application ICNS"] },
    linux: { "pos.deb": ["Linux desktop launcher PNGs"], "pos.AppImage": ["Linux desktop launcher PNGs"] },
    android: { "pos-arm64-signed.apk": ["APK manifest", "all density/round/foreground artwork", "adaptive launcher/background"] },
  };
  const assets = [];
  const bytes = new Map();
  for (const [platform, entries] of Object.entries(specs)) {
    const packages = Object.entries(entries).map(([name, surfaces]) => {
      const data = Buffer.from(`Inspected fixture binary ${name}`);
      bytes.set(`https://example.test/${name}`, data);
      assets.push({ name, size: data.length, browser_download_url: `https://example.test/${name}` });
      return { name, surfaces, sha256: createHash("sha256").update(data).digest("hex") };
    });
    await writeFile(path.join(dir, `branding-${platform}.json`), JSON.stringify({ schema: 1, platform, productMarkSha256: sourceHash, packages }));
  }
  return { dir, assets, download: async url => new Response(bytes.get(url)), bytes };
}

test("published installers must match every inspected binary and surface", async t => {
  const { dir, assets, download } = await fixture(t);
  assert.equal(await verifyPublishedBranding(assets, dir, download), 6);
});
test("GitHub space-to-dot filenames still require exact inspected binary checksums", async t => {
  const { dir, assets, download, bytes } = await fixture(t);
  for (const platform of ["windows", "macos", "linux"]) {
    const file = path.join(dir, `branding-${platform}.json`);
    const report = JSON.parse(await readFile(file, "utf8"));
    for (const row of report.packages) {
      const asset = assets.find(asset => asset.name === row.name);
      row.name = `GlobiPOS Terminal_${row.name}`;
      asset.name = row.name.replaceAll(" ", ".");
    }
    await writeFile(file, JSON.stringify(report));
  }
  assert.equal(await verifyPublishedBranding(assets, dir, download), 6);
  const asset = assets.find(asset => asset.name.endsWith(".AppImage"));
  bytes.set(asset.browser_download_url, Buffer.alloc(asset.size));
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /differs from inspected binary/);
});
test("space-to-dot filename collisions cannot overwrite an inspection", async t => {
  const { dir, assets, download } = await fixture(t);
  const file = path.join(dir, "branding-linux.json");
  const report = JSON.parse(await readFile(file, "utf8"));
  const row = report.packages.find(row => row.name.endsWith(".AppImage"));
  row.name = "GlobiPOS Terminal.AppImage";
  report.packages.push({ ...row, name: "GlobiPOS.Terminal.AppImage" });
  await writeFile(file, JSON.stringify(report));
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /Duplicate inspected package/);
});
test("unrelated filename changes do not bypass inspected package matching", async t => {
  const { dir, assets, download } = await fixture(t);
  assets.find(asset => asset.name.endsWith(".AppImage")).name = "different.AppImage";
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /has not been inspected/);
});
test("missing reports cannot silently fall back to source or metadata checks", async () => {
  await assert.rejects(verifyPublishedBranding([], undefined), /reports are required/);
});
test("missing platform report fails", async t => {
  const { dir, assets, download } = await fixture(t);
  await rm(path.join(dir, "branding-android.json"));
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /Missing package branding report: android/);
});
test("generic setup or replaced APK bytes invalidate the package inspection", async t => {
  const { dir, assets, download, bytes } = await fixture(t);
  for (const suffix of [".exe", ".apk"]) {
    const asset = assets.find(a => a.name.endsWith(suffix));
    const original = bytes.get(asset.browser_download_url);
    bytes.set(asset.browser_download_url, Buffer.alloc(original.length));
    await assert.rejects(verifyPublishedBranding(assets, dir, download), /differs from inspected binary/);
    bytes.set(asset.browser_download_url, original);
  }
});
test("new ABI APK cannot skip inspection", async t => {
  const { dir, assets, download } = await fixture(t);
  assets.push({ name: "pos-x86-signed.apk" });
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /has not been inspected/);
});
test("installer inspection without the uninstaller surface fails", async t => {
  const { dir, assets, download } = await fixture(t);
  const file = path.join(dir, "branding-windows.json");
  const report = JSON.parse(await readFile(file, "utf8"));
  report.packages[1].surfaces.pop();
  await writeFile(file, JSON.stringify(report));
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /Unverified package surfaces/);
});
test("unpublished inspected package and failed download fail explicitly", async t => {
  const { dir, assets, download } = await fixture(t);
  await assert.rejects(verifyPublishedBranding(assets.slice(0, -1), dir, download), /missing from the published release/);
  await assert.rejects(verifyPublishedBranding(assets, dir, async () => new Response("", { status: 404 })), /Could not download/);
});
test("reports using an unapproved customer logo fail", async t => {
  const { dir, assets, download } = await fixture(t);
  const file = path.join(dir, "branding-macos.json");
  const report = JSON.parse(await readFile(file, "utf8"));
  report.productMarkSha256 = "0".repeat(64);
  await writeFile(file, JSON.stringify(report));
  await assert.rejects(verifyPublishedBranding(assets, dir, download), /Unapproved product mark/);
});
test("release workflow consumes reports from all four builders", async () => {
  const workflow = await readFile(new URL("../.github/workflows/build-pos.yml", import.meta.url), "utf8");
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /--branding-reports branding-reports/);
  assert.match(workflow, /Inspect signed APK[\s\S]*Upload APK to release/);
  for (const platform of ["windows", "macos", "linux"]) assert.ok(workflow.includes(`branding-platform: ${platform}`));
});