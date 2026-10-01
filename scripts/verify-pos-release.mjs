#!/usr/bin/env node

const [repo, rawTag] = process.argv.slice(2);
if (!repo || !rawTag) {
  console.error("Usage: node scripts/verify-pos-release.mjs owner/repo <v1.2.3|latest>");
  process.exit(2);
}

const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const releasePath = rawTag === "latest" ? "releases/latest" : `releases/tags/${rawTag.startsWith("v") ? rawTag : `v${rawTag}`}`;
const response = await fetch(`${apiUrl}/repos/${repo}/${releasePath}`, { headers });
if (!response.ok) {
  throw new Error(`GitHub release lookup failed with HTTP ${response.status}.`);
}
const release = await response.json();
const tag = release.tag_name;
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`GitHub release has invalid tag ${tag || "(missing)"}.`);
const version = tag.slice(1);
if (release.draft || release.prerelease) throw new Error(`${tag} is not a final published release.`);

const assets = release.assets ?? [];
const isSecureDownloadUrl = (value) =>
  /^https:\/\//.test(value ?? "") ||
  /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(value ?? "");
const invalidAssets = assets.filter((asset) =>
  asset.state !== "uploaded" ||
  !Number.isFinite(asset.size) ||
  asset.size <= 0 ||
  !isSecureDownloadUrl(asset.browser_download_url)
);
if (invalidAssets.length) {
  throw new Error(`Release ${tag} has assets that are not ready: ${invalidAssets.map((asset) => asset.name).join(", ")}.`);
}

const names = assets.map((asset) => asset.name);
const required = [
  ["Windows MSI", new RegExp(`${version.replaceAll(".", "\\.")}.*\\.msi$`, "i")],
  ["Windows EXE", new RegExp(`${version.replaceAll(".", "\\.")}.*\\.exe$`, "i")],
  ["macOS DMG", new RegExp(`${version.replaceAll(".", "\\.")}.*\\.dmg$`, "i")],
  ["Linux AppImage", new RegExp(`${version.replaceAll(".", "\\.")}.*\\.AppImage$`, "i")],
  ["Linux DEB", new RegExp(`${version.replaceAll(".", "\\.")}.*\\.deb$`, "i")],
  ["Android APK", /-signed\.apk$/i],
  ["updater metadata", /^latest\.json$/],
];
const missing = required.filter(([, pattern]) => !names.some((name) => pattern.test(name)));
if (missing.length) throw new Error(`Release ${tag} is missing: ${missing.map(([label]) => label).join(", ")}.`);

const latestAsset = release.assets.find((asset) => asset.name === "latest.json");
const latestResponse = await fetch(latestAsset.browser_download_url, { headers: { Accept: "application/octet-stream" } });
if (!latestResponse.ok) throw new Error(`latest.json download failed with HTTP ${latestResponse.status}.`);
const latest = await latestResponse.json();
if (latest.version !== version) throw new Error(`latest.json reports ${latest.version}, expected ${version}.`);
const updaterPlatformGroups = [
  ["Windows", ["windows-x86_64"]],
  ["Linux", ["linux-x86_64", "linux-x86_64-appimage"]],
  ["macOS", ["darwin-universal", "darwin-aarch64", "darwin-x86_64"]],
];
for (const [label, keys] of updaterPlatformGroups) {
  const entries = keys.map((key) => latest.platforms?.[key]).filter(Boolean);
  if (!entries.length) throw new Error(`latest.json has no ${label} updater entry.`);
  for (const entry of entries) {
    if (!/^https:\/\//.test(entry.url ?? "")) throw new Error(`latest.json has an invalid ${label} updater URL.`);
    if (typeof entry.signature !== "string" || entry.signature.trim().length === 0) {
      throw new Error(`latest.json has no ${label} updater signature.`);
    }
  }
}

console.log(`Verified ${tag}: all desktop, Android, and updater assets are published.`);