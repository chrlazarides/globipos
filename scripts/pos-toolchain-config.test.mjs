import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dependabotPath = fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url));
const posCiPath = fileURLToPath(new URL("../.github/workflows/ci-pos.yml", import.meta.url));

function topLevelJobBlock(workflow, jobName) {
  const match = workflow.match(
    new RegExp(`^  ${jobName}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|(?![\\s\\S]))`, "m"),
  );
  assert.ok(match, `POS CI must keep the ${jobName} job`);
  return match[0];
}

test("Dependabot tracks the POS Rust toolchain", async () => {
  const dependabot = await readFile(dependabotPath, "utf8");
  const rustToolchainUpdate = dependabot.match(
    /(?:^|\n)  - package-ecosystem:\s*rust-toolchain\s*\n([\s\S]*?)(?=\n  - package-ecosystem:|\s*$)/,
  );

  assert.ok(rustToolchainUpdate, "Dependabot must include a rust-toolchain update entry");
  assert.match(
    rustToolchainUpdate[1],
    /^\s{4}directory:\s*\/pos-app\s*$/m,
    "Dependabot rust-toolchain updates must target /pos-app",
  );
});

test("POS toolchain changes run every required pull-request gate", async () => {
  const workflow = await readFile(posCiPath, "utf8");
  const pullRequestPaths = workflow.match(
    /^\s{2}pull_request:\s*\n[\s\S]*?^\s{4}paths:\s*\n([\s\S]*?)(?=^\s{2}[a-zA-Z_]+:|^\S|(?![\s\S]))/m,
  );

  assert.ok(pullRequestPaths, "POS CI must keep pull-request path filters");
  assert.match(
    pullRequestPaths[1],
    /^\s{6}-\s*['"]?pos-app\/\*\*['"]?\s*$/m,
    "POS CI pull requests must include pos-app/** so rust-toolchain.toml changes run",
  );
  assert.match(
    pullRequestPaths[1],
    /^\s{6}-\s*['"]?\.github\/dependabot\.yml['"]?\s*$/m,
    "POS CI pull requests must run when its Dependabot configuration changes",
  );
  assert.match(
    pullRequestPaths[1],
    /^\s{6}-\s*['"]?scripts\/pos-toolchain-config\.test\.mjs['"]?\s*$/m,
    "POS CI pull requests must run when this repository check changes",
  );

  const rustCheck = topLevelJobBlock(workflow, "rust-check");
  assert.match(rustCheck, /\brun:\s*cargo check(?:\s|$)/, "rust-check must run cargo check");
  assert.match(rustCheck, /\brun:\s*cargo clippy(?:\s|$)/, "rust-check must run cargo clippy");
  assert.match(rustCheck, /\brun:\s*cargo fmt(?:\s|$)/, "rust-check must run cargo fmt");

  const rustTest = topLevelJobBlock(workflow, "rust-test");
  assert.match(rustTest, /\brun:\s*cargo test(?:\s|$)/, "rust-test must run cargo test");

  const smokeBuild = topLevelJobBlock(workflow, "smoke-build");
  assert.match(
    smokeBuild,
    /\brun:\s*npx tauri build --no-bundle\s*$/m,
    "smoke-build must compile the POS application",
  );
});