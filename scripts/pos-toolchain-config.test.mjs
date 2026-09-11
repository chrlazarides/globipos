import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertJobRuns,
  parseYaml,
  parseWorkflow,
  workflowJob,
  workflowJobSteps,
} from "./workflow-test-helpers.mjs";

const dependabotPath = fileURLToPath(new URL("../.github/dependabot.yml", import.meta.url));
const posCiPath = fileURLToPath(new URL("../.github/workflows/ci-pos.yml", import.meta.url));
const posBuildPath = fileURLToPath(new URL("../.github/workflows/build-pos.yml", import.meta.url));

function validateDependabot(source) {
  const dependabot = parseYaml(source, "Dependabot configuration");
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

function assertDesktopMatrix(job, description) {
  const operatingSystems = job?.strategy?.matrix?.include?.map((entry) => entry.os);
  assert.ok(operatingSystems?.includes("windows-latest"), `${description} must compile on Windows`);
  assert.ok(operatingSystems?.includes("macos-latest"), `${description} must compile on macOS`);
}

function assertPinnedToolchain(workflow, jobName, description, workflowDescription) {
  const step = workflowJobSteps(workflow, jobName, workflowDescription).find(
    (candidate) => candidate?.run === "rustup show active-toolchain",
  );
  assert.equal(
    step?.["working-directory"],
    "pos-app",
    `${description} must activate pos-app/rust-toolchain.toml`,
  );
}

function validatePosWorkflow(source) {
  const workflow = parseWorkflow(source, "POS CI workflow");
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
  assert.ok(
    pullRequestPaths.includes("scripts/workflow-test-helpers.mjs"),
    "POS CI pull requests must run when shared workflow test helpers change",
  );

  const rustCheck = workflowJob(workflow, "rust-check", "POS CI workflow");
  assertJobRuns(rustCheck, "cargo check", "rust-check must run cargo check");
  assertJobRuns(rustCheck, "cargo clippy", "rust-check must run cargo clippy");
  assertJobRuns(rustCheck, "cargo fmt", "rust-check must run cargo fmt");
  assertJobRuns(
    workflowJob(workflow, "rust-test", "POS CI workflow"),
    "cargo test",
    "rust-test must run cargo test",
  );

  const desktopCheck = workflowJob(workflow, "desktop-platform-check", "POS CI workflow");
  assertDesktopMatrix(desktopCheck, "desktop-platform-check");
  assertPinnedToolchain(
    workflow,
    "desktop-platform-check",
    "desktop platform checks",
    "POS CI workflow",
  );
  assertJobRuns(
    desktopCheck,
    "npx tauri build --no-bundle -- --locked",
    "desktop platform checks must compile the locked native application",
  );

  const smokeBuild = workflowJob(workflow, "smoke-build", "POS CI workflow");
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
    workflowJobSteps(workflow, "smoke-build", "POS CI workflow").some(
      (step) =>
        typeof step?.run === "string" &&
        step.run.includes("needs.desktop-platform-check.result") &&
        step.run.includes("'success'"),
    ),
    "the required smoke status must fail unless both desktop platform checks pass",
  );
  assertJobRuns(
    smokeBuild,
    "npx tauri build --no-bundle",
    "smoke-build must compile the POS application",
  );
}

function validateBuildWorkflow(source) {
  const workflow = parseWorkflow(source, "POS release workflow");
  const desktopPreflight = workflowJob(workflow, "desktop-native-preflight", "POS release workflow");

  assertDesktopMatrix(desktopPreflight, "release desktop preflight");
  assertPinnedToolchain(
    workflow,
    "desktop-native-preflight",
    "release desktop preflight",
    "POS release workflow",
  );
  assertJobRuns(
    desktopPreflight,
    "npx tauri build --no-bundle -- --locked",
    "release desktop preflight must compile the locked native application",
  );

  for (const jobName of ["build-desktop", "build-android"]) {
    assert.ok(
      workflowJob(workflow, jobName, "POS release workflow").needs?.includes("desktop-native-preflight"),
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
      - scripts/workflow-test-helpers.mjs
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