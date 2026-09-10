import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const helper = fileURLToPath(new URL("./pos-version.mjs", import.meta.url));
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