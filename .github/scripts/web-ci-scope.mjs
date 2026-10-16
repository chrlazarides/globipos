// Lightweight CI routing only: no dependencies, builds, tests or database calls.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const base = process.env.DIFF_BASE;
const head = process.env.DIFF_HEAD;
if (!/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("Missing valid CI head commit");
if (!base || !/^[a-f0-9]{40}$/.test(base)) throw new Error("Missing valid CI base commit");
if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GitHub output file");

// A first push has no previous commit: require checks instead of assuming none.
const firstPush = /^0+$/.test(base);
// Include both sides of renames and every file, without API pagination limits.
const files = firstPush ? [] : execFileSync("git",
  ["diff", "--name-only", "--no-renames", "-z", base, head],
  { encoding: "utf8" }).split("\0").filter(Boolean);
const required = firstPush || files.some(file =>
  file.startsWith("artifacts/globipos/") ||
  file.startsWith("artifacts/api-server/") ||
  file.startsWith("lib/") ||
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|tsconfig[^/]*\.json)$/.test(file) ||
  file === ".github/workflows/ci-web-api.yml" ||
  file === ".github/scripts/web-ci.mjs" ||
  file === ".github/scripts/web-ci-scope.mjs" ||
  file === ".github/scripts/run-workspace-tests.mjs");
fs.appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`);
console.log(required
  ? "Back office/API inputs changed: the existing quick gate is required."
  : "No Back office/API inputs changed: skip dependency installation and application checks.");
