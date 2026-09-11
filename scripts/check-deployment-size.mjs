#!/usr/bin/env node

import { access, readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const forbiddenTarget = path.join(root, "pos-app", "src-tauri", "target");
const warningBytes = 6 * 1024 ** 3;

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const deploymentIgnore = await readFile(path.join(root, ".replitignore"), "utf8");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!semverPattern.test(packageJson.version)) {
  throw new Error(`Backend package version is invalid: ${packageJson.version}.`);
}
if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
  throw new Error(
    `Backend package versions are not aligned: package=${packageJson.version}, ` +
    `lock=${packageLock.version}, lock root=${packageLock.packages?.[""]?.version}.`,
  );
}

const ignoredPaths = deploymentIgnore
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
if (ignoredPaths.includes("dist/") || ignoredPaths.includes("/dist/")) {
  throw new Error(
    ".replitignore must not exclude root dist/: npm run build writes the production server to dist/index.cjs.",
  );
}

try {
  await access(forbiddenTarget);
  throw new Error(
    "Generated Tauri output exists inside pos-app/src-tauri/target. " +
    "Use scripts/build-native.sh or scripts/build-native.ps1 so CARGO_TARGET_DIR stays outside the workspace.",
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const rootStats = await stat(root);
if (!rootStats.isDirectory()) throw new Error("Project root is not a directory.");

if (process.platform !== "win32") {
  const workspaceKiB = Number(execFileSync("du", ["-sk", root], { encoding: "utf8" }).trim().split(/\s+/)[0]);
  const workspaceBytes = workspaceKiB * 1024;
  if (workspaceBytes > warningBytes) {
    throw new Error(
      `Workspace is ${(workspaceBytes / 1024 ** 3).toFixed(2)} GiB and exceeds the 6 GiB deployment safety limit. ` +
      "Remove generated caches before publishing.",
    );
  }
}

console.log(`Deployment guard passed: backend ${packageJson.version} is aligned and no in-workspace Tauri target exists.`);