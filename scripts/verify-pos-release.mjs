#!/usr/bin/env node

const [repo, rawTag] = process.argv.slice(2);
if (!repo || !rawTag) {
  console.error("Usage: node scripts/verify-pos-release.mjs owner/repo v1.2.3");
  process.exit(2);
}

const tag = rawTag.startsWith("v") ? rawTag : `v${rawTag}`;
const version = tag.slice(1);
const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const response = await fetch(`${apiUrl}/repos/${repo}/releases/tags/${tag}`, { headers });
if (!response.ok) {
  throw new Error(`GitHub release lookup failed with HTTP ${response.status}.`);
}
const release = await response.json();
if (release.draft || release.prerelease) throw new Error(`${tag} is not a final published release.`);

const names = release.assets.map((asset) => asset.name);
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
if (!latest.platforms?.["windows-x86_64"]) throw new Error("latest.json has no Windows updater entry.");

console.log(`Verified ${tag}: all desktop, Android, and updater assets are published.`);