import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parse } = require("yaml");

const dependabotPath = fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url));
const posCiPath = fileURLToPath(new URL("../.github/workflows/ci-pos.yml", import.meta.url));
const posBuildPath = fileURLToPath(new URL("../.github/workflows/build-pos.yml", import.meta.url));

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

function getJob(workflow, jobName) {
  const job = workflow?.jobs?.[jobName];
  assert.ok(job, `POS workflow must keep the ${jobName} job`);
  return job;
}

function jobSteps(workflow, jobName) {
  const job = getJob(workflow, jobName);
  assert.ok(Array.isArray(job.steps), `POS workflow ${jobName} must define steps`);
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

function assertDesktopMatrix(job, description) {
  const operatingSystems = job?.strategy?.matrix?.include?.map((entry) => entry.os);
  assert.ok(operatingSystems?.includes("windows-latest"), `${description} must compile on Windows`);
  assert.ok(operatingSystems?.includes("macos-latest"), `${description} must compile on macOS`);
}

function assertPinnedToolchain(workflow, jobName, description) {
  const step = jobSteps(workflow, jobName).find(
    (candidate) => candidate?.run === "rustup show active-toolchain",
  );
  assert.equal(
    step?.["working-directory"],
    "pos-app",
    `${description} must activate pos-app/rust-toolchain.toml`,
  );
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
    pullRequestPaths.includes(".github/workflows/build-pos.yml"),
    "POS CI pull requests must run when the release workflow changes",
  );
  assert.ok(
    pullRequestPaths.includes("scripts/pos-toolchain-config.test.mjs"),
    "POS CI pull requests must run when this repository check changes",
  );

  assertJobRuns(workflow, "rust-check", "cargo check", "rust-check must run cargo check");
  assertJobRuns(workflow, "rust-check", "cargo clippy", "rust-check must run cargo clippy");
  assertJobRuns(workflow, "rust-check", "cargo fmt", "rust-check must run cargo fmt");
  assertJobRuns(workflow, "rust-test", "cargo test", "rust-test must run cargo test");

  const desktopCheck = getJob(workflow, "desktop-platform-check");
  assertDesktopMatrix(desktopCheck, "desktop-platform-check");
  assertPinnedToolchain(workflow, "desktop-platform-check", "desktop platform checks");
  assertJobRuns(
    workflow,
    "desktop-platform-check",
    "npx tauri build --no-bundle -- --locked",
    "desktop platform checks must compile the locked native application",
  );

  const smokeBuild = getJob(workflow, "smoke-build");
  assert.ok(
    smokeBuild.needs?.includes("desktop-platform-check"),
    "the Linux smoke build must depend on both desktop platform checks",
  );
  assert.equal(
    smokeBuild.if,
    "always()",
    "the required smoke status must run even when a prerequisite fails",
  );
  assert.ok(
    jobSteps(workflow, "smoke-build").some(
      (step) =>
        typeof step?.run === "string" &&
        step.run.includes("needs.desktop-platform-check.result") &&
        step.run.includes("'success'"),
    ),
    "the required smoke status must fail unless both desktop platform checks pass",
  );
  assertJobRuns(
    workflow,
    "smoke-build",
    "npx tauri build --no-bundle",
    "smoke-build must compile the POS application",
  );
}

function validateBuildWorkflow(source) {
  const workflow = parseConfig(source, "POS release workflow");
  const desktopPreflight = getJob(workflow, "desktop-native-preflight");

  assertDesktopMatrix(desktopPreflight, "release desktop preflight");
  assertPinnedToolchain(workflow, "desktop-native-preflight", "release desktop preflight");
  assertJobRuns(
    workflow,
    "desktop-native-preflight",
    "npx tauri build --no-bundle -- --locked",
    "release desktop preflight must compile the locked native application",
  );

  for (const jobName of ["build-desktop", "build-android"]) {
    assert.ok(
      getJob(workflow, jobName).needs?.includes("desktop-native-preflight"),
      `${jobName} must wait for desktop native preflight`,
    );
  }
}

test("Dependabot tracks the POS Rust toolchain", async () => {
  validateDependabot(await readFile(dependabotPath, "utf8"));
});

test("POS toolchain changes run every required pull-request gate", async () => {
  validatePosWorkflow(await readFile(posCiPath, "utf8"));
});

test("POS release waits for Windows and macOS native preflight builds", async () => {
  validateBuildWorkflow(await readFile(posBuildPath, "utf8"));
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
      - .github/workflows/build-pos.yml
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