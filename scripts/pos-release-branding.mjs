import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const mark = "4c5823371db86118b018da669dbc043684139a8f66693ef2e2309d4f18617a41";
const platforms = ["windows", "macos", "linux", "android"];
const requiredSurfaces = {
  ".msi": ["MSI application icon"],
  ".exe": ["NSIS setup icon", "installed application icon", "installed uninstaller icon"],
  ".dmg": ["DMG application ICNS"],
  ".deb": ["Linux desktop launcher PNGs"],
  ".appimage": ["Linux desktop launcher PNGs"],
  ".apk": ["APK manifest", "all density/round/foreground artwork", "adaptive launcher/background"],
};
const platformSuffixes = { windows: [".msi", ".exe"], macos: [".dmg"], linux: [".deb", ".appimage"], android: [".apk"] };

export async function verifyPublishedBranding(assets, directory, fetchAsset = fetch) {
  assert.ok(directory, "Package branding reports are required; metadata checks alone do not verify icons.");
  const files = await readdir(directory);
  const verified = new Map();
  for (const platform of platforms) {
    const name = `branding-${platform}.json`;
    assert.ok(files.includes(name), `Missing package branding report: ${platform}`);
    const report = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    assert.equal(report.schema, 1, `Unsupported branding report: ${platform}`);
    assert.equal(report.platform, platform, `Wrong branding report platform: ${platform}`);
    assert.equal(report.productMarkSha256, mark, `Unapproved product mark: ${platform}`);
    assert.ok(Array.isArray(report.packages) && report.packages.length, `No inspected packages: ${platform}`);
    for (const row of report.packages) {
      assert.ok(typeof row.name === "string", "Missing inspected package name");
      const suffix = path.extname(row.name).toLowerCase();
      assert.ok(platformSuffixes[platform].includes(suffix), `Unexpected ${platform} package: ${row.name}`);
      assert.match(row.sha256 ?? "", /^[a-f0-9]{64}$/, `Missing binary checksum: ${row.name}`);
      assert.ok(requiredSurfaces[suffix].every(surface => row.surfaces?.includes(surface)), `Unverified package surfaces: ${row.name}`);
      assert.ok(!verified.has(row.name), `Duplicate inspected package: ${row.name}`);
      verified.set(row.name, row.sha256);
    }
  }
  const packages = assets.filter(asset => requiredSurfaces[path.extname(asset.name).toLowerCase()]);
  for (const asset of packages) {
    assert.ok(verified.has(asset.name), `Published package has not been inspected: ${asset.name}`);
    const response = await fetchAsset(asset.browser_download_url, { headers: { Accept: "application/octet-stream" } });
    assert.ok(response.ok && response.body, `Could not download inspected package: ${asset.name} (HTTP ${response.status})`);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of response.body) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    assert.equal(bytes, asset.size, `Published package size mismatch: ${asset.name}`);
    assert.equal(hash.digest("hex"), verified.get(asset.name), `Published package differs from inspected binary: ${asset.name}`);
    verified.delete(asset.name);
  }
  assert.equal(verified.size, 0, "Inspected packages are missing from the published release");
  return packages.length;
}