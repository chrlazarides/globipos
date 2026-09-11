import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const dependabotPath = fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url));
const posCiPath = fileURLToPath(new URL("../.github/workflows/ci-pos.yml", import.meta.url));

function parseConfig(source, description) {
  try {
    return parse(source);
  } catch (error) {
    assert.fail(`${description} must contain valid YAML: ${error.message}`);
  }
}

function validateDependabot(source) {
  const dependabot = parseConfig(source, "Dependabot configuration");
  const updates = dependabot?.updates;
  assert.ok(Array.isArray(updates), "Dependabot must define an updates list");

  const rustToolchainUpdate = updates.find(
    (update) => update?.["package-ecosystem"] === "rust-toolchain",
  );
  assert.ok(rustToolchainUpdate, "Dependabot must include a rust-toolchain update entry");
  assert.equal(
    rustToolchainUpdate.directory,
    "/pos-app",
    "Dependabot rust-toolchain updates must target /pos-app",
  );
}

function jobSteps(workflow, jobName) {
  const job = workflow?.jobs?.[jobName];
  assert.ok(job, `POS CI must keep the ${jobName} job`);
  assert.ok(Array.isArray(job.steps), `POS CI ${jobName} must define steps`);
  return job.steps;
}

function assertJobRuns(workflow, jobName, command, message) {
  const runsCommand = jobSteps(workflow, jobName).some(
    (step) =>
      typeof step?.run === "string" &&
      step.run.split("\n").some((line) => {
        const trimmed = line.trim();
        return trimmed === command || trimmed.startsWith(`${command} `);
      }),
  );
  assert.ok(runsCommand, message);
}

function validatePosWorkflow(source) {
  const workflow = parseConfig(source, "POS CI workflow");
  const pullRequestPaths = workflow?.on?.pull_request?.paths;
  assert.ok(Array.isArray(pullRequestPaths), "POS CI must keep pull-request path filters");
  assert.ok(
    pullRequestPaths.includes("pos-app/**"),
    "POS CI pull requests must include pos-app/** so rust-toolchain.toml changes run",
  );
  assert.ok(
    pullRequestPaths.includes(".github/dependabot.yml"),
    "POS CI pull requests must run when its Dependabot configuration changes",
  );
  assert.ok(
    pullRequestPaths.includes("scripts/pos-toolchain-config.test.mjs"),
    "POS CI pull requests must run when this repository check changes",
  );

  assertJobRuns(workflow, "rust-check", "cargo check", "rust-check must run cargo check");
  assertJobRuns(workflow, "rust-check", "cargo clippy", "rust-check must run cargo clippy");
  assertJobRuns(workflow, "rust-check", "cargo fmt", "rust-check must run cargo fmt");
  assertJobRuns(workflow, "rust-test", "cargo test", "rust-test must run cargo test");
  assertJobRuns(
    workflow,
    "smoke-build",
    "npx tauri build --no-bundle",
    "smoke-build must compile the POS application",
  );
}

test("Dependabot tracks the POS Rust toolchain", async () => {
  validateDependabot(await readFile(dependabotPath, "utf8"));
});

test("POS toolchain changes run every required pull-request gate", async () => {
  validatePosWorkflow(await readFile(posCiPath, "utf8"));
});

test("a commented-out Dependabot entry does not satisfy the guard", () => {
  const disconnectedDependabot = `
version: 2
updates:
  # - package-ecosystem: rust-toolchain
  #   directory: /pos-app
  - package-ecosystem: github-actions
    directory: /
`;

  assert.throws(
    () => validateDependabot(disconnectedDependabot),
    /Dependabot must include a rust-toolchain update entry/,
  );
});

test("commented-out POS commands do not satisfy required gates", () => {
  const disconnectedWorkflow = `
on:
  pull_request:
    paths:
      - pos-app/**
      - .github/dependabot.yml
      - scripts/pos-toolchain-config.test.mjs
jobs:
  rust-check:
    steps:
      - run: echo "Rust checks disconnected"
        # run: cargo check --workspace
        # run: cargo clippy --workspace
        # run: cargo fmt --all -- --check
  rust-test:
    steps:
      - run: echo "Rust tests disconnected"
        # run: cargo test --lib
  smoke-build:
    steps:
      - run: echo "Smoke build disconnected"
        # run: npx tauri build --no-bundle
`;

  assert.throws(
    () => validatePosWorkflow(disconnectedWorkflow),
    /rust-check must run cargo check/,
  );
});
