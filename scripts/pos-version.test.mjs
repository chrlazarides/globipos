import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const helper = fileURLToPath(new URL("./pos-version.mjs", import.meta.url));
const publishScript = fileURLToPath(new URL("./publish-release.sh", import.meta.url));
const originalVersion = "1.2.3";
const updatedVersion = "2.4.6";

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pos-version-test-"));
  const tauriDir = path.join(root, "pos-app", "src-tauri");
  await mkdir(tauriDir, { recursive: true });
  await writeFile(
    path.join(root, "pos-app", "package.json"),
    `${JSON.stringify({ name: "pos-fixture", version: originalVersion }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "pos-app", "package-lock.json"),
    `${JSON.stringify({
      name: "pos-fixture",
      version: originalVersion,
      lockfileVersion: 3,
      packages: { "": { name: "pos-fixture", version: originalVersion } },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(tauriDir, "Cargo.toml"),
    `[package]\nname = "globipos-terminal"\nversion = "${originalVersion}"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n`,
  );
  await writeFile(
    path.join(tauriDir, "Cargo.lock"),
    `version = 3\n\n[[package]]\nname = "globipos-terminal"\nversion = "${originalVersion}"\ndependencies = [\n "serde",\n]\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n`,
  );
  await writeFile(
    path.join(tauriDir, "tauri.conf.json"),
    `${JSON.stringify({ productName: "GlobiPOS", version: originalVersion }, null, 2)}\n`,
  );
  return root;
}

async function runHelper(root, ...args) {
  return execFileAsync(process.execPath, [helper, ...args], { cwd: root });
}

async function createWindowsPreflightFixture(scenario) {
  const root = await createFixture();
  const scriptsDir = path.join(root, "scripts");
  const binDir = path.join(root, "test-bin");
  const gitLog = path.join(root, "git.log");
  const curlLog = path.join(root, "curl.log");
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(binDir);
  await cp(helper, path.join(scriptsDir, "pos-version.mjs"));
  await cp(publishScript, path.join(scriptsDir, "publish-release.sh"));

  const commands = {
    git: `#!/usr/bin/env bash
echo "$*" >>"$TEST_GIT_LOG"
case "$1 $2" in
  "remote -v") echo "origin https://github.com/example/globipos.git (fetch)" ;;
  "remote get-url") echo "https://github.com/example/globipos.git" ;;
  "branch --show-current") echo "main" ;;
  "status --porcelain") ;;
  "rev-parse HEAD") echo "release-head-sha" ;;
  "rev-parse "*) exit 1 ;;
  "diff --cached") exit 1 ;;
esac
exit 0
`,
    curl: `#!/usr/bin/env bash
url="\${!#}"
echo "$url" >>"$TEST_CURL_LOG"
case "$url" in
  */dispatches)
    if [[ "$TEST_SCENARIO" == "dispatch-failed" ]]; then
      printf '{"message":"workflow dispatch rejected"}' >&2
      exit 22
    fi
    exit 0
    ;;
  *"/runs?event="*)
    if [[ "$TEST_SCENARIO" == "missing" ]]; then
      printf '{"workflow_runs":[]}'
    else
      printf '{"workflow_runs":[{"id":4242,"head_sha":"release-head-sha","created_at":"2026-09-10T12:00:01Z"}]}'
    fi
    ;;
  */actions/runs/4242)
    case "$TEST_SCENARIO" in
      success) printf '{"status":"completed","conclusion":"success"}' ;;
      failed) printf '{"status":"completed","conclusion":"failure"}' ;;
      cancelled) printf '{"status":"completed","conclusion":"cancelled"}' ;;
      timeout) printf '{"status":"in_progress","conclusion":null}' ;;
      status-http-failed)
        printf '{"message":"run status unavailable"}' >&2
        exit 22
        ;;
    esac
    ;;
esac
`,
    date: `#!/usr/bin/env bash
printf '2026-09-10T12:00:00Z\\n'
`,
    sleep: "#!/usr/bin/env bash\nexit 0\n",
    npm: "#!/usr/bin/env bash\nexit 0\n",
    npx: "#!/usr/bin/env bash\nexit 0\n",
  };
  await Promise.all(Object.entries(commands).map(async ([name, contents]) => {
    const file = path.join(binDir, name);
    await writeFile(file, contents);
    await chmod(file, 0o755);
  }));

  return {
    root,
    gitLog,
    curlLog,
    run: () => execFileAsync(
      "bash",
      ["-c", 'printf "yes\\n" | bash scripts/publish-release.sh "$1"', "release-test", originalVersion],
      {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GLOBISYNC: "test-token",
        TEST_GIT_LOG: gitLog,
        TEST_CURL_LOG: curlLog,
        TEST_SCENARIO: scenario,
      },
      },
    ),
  };
}

async function readGitOperations(gitLog) {
  return readFile(gitLog, "utf8");
}

test("does not create or push a tag when GitHub rejects the Windows preflight dispatch", async (t) => {
  const fixture = await createWindowsPreflightFixture("dispatch-failed");
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    fixture.run(),
    (error) =>
      error.code === 1 &&
      error.stderr.includes("workflow dispatch rejected") &&
      error.stderr.includes("Could not start the Windows release preflight"),
  );

  const operations = await readGitOperations(fixture.gitLog);
  assert.doesNotMatch(operations, /^tag -a /m);
  assert.doesNotMatch(operations, /^push origin v1\.2\.3$/m);

  const requests = (await readFile(fixture.curlLog, "utf8")).trim().split("\n");
  assert.deepEqual(requests, [
    "https://api.github.com/repos/example/globipos/actions/workflows/build-pos.yml/dispatches",
  ]);
});

test("does not create or push a tag when GitHub rejects the Windows run-status request", async (t) => {
  const fixture = await createWindowsPreflightFixture("status-http-failed");
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await assert.rejects(
    fixture.run(),
    (error) =>
      error.code === 1 &&
      error.stderr.includes("run status unavailable") &&
      error.stderr.includes("Could not fetch the Windows release preflight status"),
  );

  const operations = await readGitOperations(fixture.gitLog);
  assert.doesNotMatch(operations, /^tag -a /m);
  assert.doesNotMatch(operations, /^push origin v1\.2\.3$/m);

  const requests = (await readFile(fixture.curlLog, "utf8")).trim().split("\n");
  assert.deepEqual(requests, [
    "https://api.github.com/repos/example/globipos/actions/workflows/build-pos.yml/dispatches",
    "https://api.github.com/repos/example/globipos/actions/workflows/build-pos.yml/runs?event=workflow_dispatch&branch=main&per_page=20",
    "https://api.github.com/repos/example/globipos/actions/runs/4242",
  ]);
});

for (const [scenario, expectedMessage] of [
  ["failed", "Windows release preflight failed"],
  ["cancelled", "Windows release preflight failed"],
  ["timeout", "Windows release preflight did not finish within 60 minutes"],
  ["missing", "Windows release preflight did not appear in GitHub Actions"],
]) {
  test(`does not create or push a tag when Windows preflight is ${scenario}`, async (t) => {
    const fixture = await createWindowsPreflightFixture(scenario);
    t.after(() => rm(fixture.root, { recursive: true, force: true }));

    await assert.rejects(
      fixture.run(),
      (error) => error.code === 1 && error.stderr.includes(expectedMessage),
    );

    const operations = await readGitOperations(fixture.gitLog);
    assert.doesNotMatch(operations, /^tag -a /m);
    assert.doesNotMatch(operations, /^push origin v1\.2\.3$/m);
  });
}

test("creates and pushes the tag after a matching Windows preflight succeeds", async (t) => {
  const fixture = await createWindowsPreflightFixture("success");
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await fixture.run();

  const operations = await readGitOperations(fixture.gitLog);
  assert.match(operations, /^tag -a v1\.2\.3 -m GlobiPOS Terminal v1\.2\.3$/m);
  assert.match(operations, /^push origin v1\.2\.3$/m);
});

async function readFixtureVersions(root) {
  const packageJson = JSON.parse(await readFile(path.join(root, "pos-app/package.json"), "utf8"));
  const lockJson = JSON.parse(await readFile(path.join(root, "pos-app/package-lock.json"), "utf8"));
  const cargo = await readFile(path.join(root, "pos-app/src-tauri/Cargo.toml"), "utf8");
  const cargoLock = await readFile(path.join(root, "pos-app/src-tauri/Cargo.lock"), "utf8");
  const tauri = JSON.parse(await readFile(path.join(root, "pos-app/src-tauri/tauri.conf.json"), "utf8"));
  return {
    package: packageJson.version,
    lock: lockJson.version,
    lockRoot: lockJson.packages[""].version,
    cargo: cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1],
    cargoLock: cargoLock
      .split(/(?=\[\[package\]\])/)
      .find((block) => /^name\s*=\s*"globipos-terminal"$/m.test(block))
      ?.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    tauri: tauri.version,
  };
}

async function createReleaseFixture() {
  const root = await createFixture();
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await cp(helper, path.join(root, "scripts", "pos-version.mjs"));
  await cp(publishScript, path.join(root, "scripts", "publish-release.sh"));
  await mkdir(path.join(root, "fake-bin"));
  const gitLog = path.join(root, "git.log");
  await writeFile(
    path.join(root, "fake-bin", "git"),
    `#!/usr/bin/env bash
echo "$*" >> "$GIT_LOG"
case "$1" in
  remote)
    if [[ "$2" == "-v" ]]; then echo "origin https://github.com/example/globipos.git (fetch)"; else echo "https://github.com/example/globipos.git"; fi ;;
  branch) echo "main" ;;
  status) exit 0 ;;
  show-ref|merge-base|push|fetch|ls-remote) exit 0 ;;
  rev-parse) exit 1 ;;
  *) exit 0 ;;
esac
`,
  );
  await writeFile(
    path.join(root, "fake-bin", "npm"),
    `#!/usr/bin/env bash
echo "npm $*" >> "$COMMAND_LOG"
[[ "$FAIL_STAGE" == "install" && "$1" == "ci" ]] && exit 41
[[ "$FAIL_STAGE" == "frontend" && "$1 $2" == "run build" ]] && exit 42
exit 0
`,
  );
  await writeFile(
    path.join(root, "fake-bin", "npx"),
    `#!/usr/bin/env bash
echo "npx $*" >> "$COMMAND_LOG"
[[ "$FAIL_STAGE" == "native" && "$1 $2" == "tauri build" ]] && exit 43
exit 0
`,
  );
  await Promise.all(["git", "npm", "npx"].map((name) => chmod(path.join(root, "fake-bin", name), 0o755)));
  return { root, gitLog };
}

for (const failStage of ["install", "frontend"]) {
  test(`release script restores all version files when ${failStage} preflight fails`, async (t) => {
    const { root, gitLog } = await createReleaseFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const versionFiles = [
      "pos-app/package.json",
      "pos-app/package-lock.json",
      "pos-app/src-tauri/Cargo.toml",
      "pos-app/src-tauri/Cargo.lock",
      "pos-app/src-tauri/tauri.conf.json",
    ];
    const originals = new Map(await Promise.all(versionFiles.map(async (file) => [
      file,
      await readFile(path.join(root, file), "utf8"),
    ])));

    await assert.rejects(
      execFileAsync("bash", ["-c", `printf 'y\\n' | bash scripts/publish-release.sh ${updatedVersion}`], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${path.join(root, "fake-bin")}:${process.env.PATH}`,
          FAIL_STAGE: failStage,
          GIT_LOG: gitLog,
          COMMAND_LOG: path.join(root, "commands.log"),
        },
      }),
      (error) => error.code === { install: 41, frontend: 42 }[failStage],
    );

    for (const [file, contents] of originals) {
      assert.equal(await readFile(path.join(root, file), "utf8"), contents);
    }
    const gitCalls = await readFile(gitLog, "utf8");
    assert.doesNotMatch(gitCalls, /(^|\n)(commit|tag) /);
  });
}

test("updates package, lockfile, Cargo, and Tauri versions together", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await runHelper(root, "--set", updatedVersion);

  assert.deepEqual(await readFixtureVersions(root), {
    package: updatedVersion,
    lock: updatedVersion,
    lockRoot: updatedVersion,
    cargo: updatedVersion,
    cargoLock: updatedVersion,
    tauri: updatedVersion,
  });
  await runHelper(root, "--check", `v${updatedVersion}`);
});

const mismatches = [
  ["package.json", async (root) => {
    const file = path.join(root, "pos-app/package.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    json.version = "9.9.9";
    await writeFile(file, JSON.stringify(json));
  }],
  ["package-lock.json", async (root) => {
    const file = path.join(root, "pos-app/package-lock.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    json.version = "9.9.9";
    json.packages[""].version = "9.9.9";
    await writeFile(file, JSON.stringify(json));
  }],
  ["Cargo.toml", async (root) => {
    const file = path.join(root, "pos-app/src-tauri/Cargo.toml");
    await writeFile(file, (await readFile(file, "utf8")).replace(originalVersion, "9.9.9"));
  }],
  ["Cargo.lock", async (root) => {
    const file = path.join(root, "pos-app/src-tauri/Cargo.lock");
    await writeFile(file, (await readFile(file, "utf8")).replace(originalVersion, "9.9.9"));
  }],
  ["tauri.conf.json", async (root) => {
    const file = path.join(root, "pos-app/src-tauri/tauri.conf.json");
    const json = JSON.parse(await readFile(file, "utf8"));
    json.version = "9.9.9";
    await writeFile(file, JSON.stringify(json));
  }],
];

for (const [name, introduceMismatch] of mismatches) {
  test(`fails validation when only ${name} has a different version`, async (t) => {
    const root = await createFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    await introduceMismatch(root);

    await assert.rejects(
      runHelper(root, "--check", originalVersion),
      (error) => error.code === 1 && error.stderr.includes("POS versions are not aligned"),
    );
  });
}

test("recovers original files from an interrupted update before checking", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const versionFiles = [
    "pos-app/package.json",
    "pos-app/package-lock.json",
    "pos-app/src-tauri/Cargo.toml",
    "pos-app/src-tauri/Cargo.lock",
    "pos-app/src-tauri/tauri.conf.json",
  ];
  const originals = await Promise.all(
    versionFiles.map(async (relativeFile) => ({
      file: path.join(root, relativeFile),
      contents: await readFile(path.join(root, relativeFile), "utf8"),
    })),
  );

  await Promise.all(originals.map(({ file }) => writeFile(file, "interrupted update contents")));
  await writeFile(
    path.join(root, ".pos-version-transaction.json"),
    JSON.stringify({ files: originals }),
  );

  const result = await runHelper(root, "--check", originalVersion);

  assert.match(result.stderr, /Restored POS version files from an interrupted update/);
  await assert.rejects(
    readFile(path.join(root, ".pos-version-transaction.json")),
    (error) => error.code === "ENOENT",
  );
  for (const { file, contents } of originals) {
    assert.equal(await readFile(file, "utf8"), contents);
  }
});

test("rejects lockfiles that point at a Replit-internal registry", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockFile = path.join(root, "pos-app", "package-lock.json");
  const lockJson = JSON.parse(await readFile(lockFile, "utf8"));
  lockJson.packages["node_modules/example"] = {
    version: "1.0.0",
    resolved: "http://package-firewall.replit.internal/npm/example/-/example-1.0.0.tgz",
  };
  await writeFile(lockFile, `${JSON.stringify(lockJson, null, 2)}\n`);

  await assert.rejects(
    runHelper(root, "--check", originalVersion),
    (error) => error.code === 1 && error.stderr.includes("unavailable to GitHub Actions"),
  );
});

test("rejects Cargo.lock entries that point at a Replit-internal registry", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lockFile = path.join(root, "pos-app", "src-tauri", "Cargo.lock");
  const lockText = await readFile(lockFile, "utf8");
  await writeFile(
    lockFile,
    `${lockText}\n[[package]]\nname = "internal-only-dependency"\nversion = "1.0.0"\nsource = "sparse+https://cargo-cache.replit.internal/index/"\n`,
  );

  await assert.rejects(
    runHelper(root, "--check", originalVersion),
    (error) =>
      error.code === 1 &&
      error.stderr.includes("pos-app/src-tauri/Cargo.lock") &&
      error.stderr.includes("unavailable to GitHub Actions"),
  );
});