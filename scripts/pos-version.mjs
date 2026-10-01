#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const files = {
  package: path.join(root, "pos-app/package.json"),
  lock: path.join(root, "pos-app/package-lock.json"),
  cargo: path.join(root, "pos-app/src-tauri/Cargo.toml"),
  cargoLock: path.join(root, "pos-app/src-tauri/Cargo.lock"),
  tauri: path.join(root, "pos-app/src-tauri/tauri.conf.json"),
};
const journalFile = path.join(root, ".pos-version-transaction.json");

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function normalizeVersion(value) {
  const version = value?.replace(/^v/, "");
  if (!version || !semverPattern.test(version)) {
    throw new Error(`Invalid POS version "${value ?? ""}". Expected a semantic version such as 1.2.3.`);
  }
  return version;
}

function cargoVersion(contents) {
  const packageStart = contents.indexOf("[package]");
  if (packageStart === -1) throw new Error("Could not find [package] in pos-app/src-tauri/Cargo.toml.");
  const packageAndRest = contents.slice(packageStart + "[package]".length);
  const nextSection = packageAndRest.search(/\r?\n\[/);
  const packageSection = nextSection === -1 ? packageAndRest : packageAndRest.slice(0, nextSection);
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error("Could not read [package].version from pos-app/src-tauri/Cargo.toml.");
  return version;
}

function cargoLockVersion(contents) {
  const block = contents
    .split(/(?=\[\[package\]\])/)
    .find((candidate) => /^name\s*=\s*"globipos-terminal"\s*$/m.test(candidate));
  const version = block?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error("Could not read globipos-terminal version from pos-app/src-tauri/Cargo.lock.");
  return version;
}

async function recoverInterruptedTransaction() {
  let journal;
  try {
    journal = JSON.parse(await readFile(journalFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(journal.files.map(({ file, contents }) => writeFile(file, contents)));
  await unlink(journalFile);
  console.error("[WARN] Restored POS version files from an interrupted update.");
}

async function readVersions() {
  const [packageText, lockText, cargoText, cargoLockText, tauriText] = await Promise.all([
    readFile(files.package, "utf8"),
    readFile(files.lock, "utf8"),
    readFile(files.cargo, "utf8"),
    readFile(files.cargoLock, "utf8"),
    readFile(files.tauri, "utf8"),
  ]);
  const lockJson = JSON.parse(lockText);
  return {
    package: JSON.parse(packageText).version,
    lock: lockJson.version,
    "lock root": lockJson.packages?.[""]?.version,
    cargo: cargoVersion(cargoText),
    "Cargo.lock": cargoLockVersion(cargoLockText),
    tauri: JSON.parse(tauriText).version,
  };
}

function assertPortableLockfile(lockText, lockfileName) {
  const blockedHostPatterns = [
    /(?:[a-z0-9-]+\.)*replit\.internal/gi,
    /\blocalhost\b/gi,
    /\b127\.0\.0\.1\b/g,
  ];
  const matches = [
    ...new Set(blockedHostPatterns.flatMap((pattern) => lockText.match(pattern) ?? [])),
  ];
  if (matches.length) {
    throw new Error(
      `${lockfileName} contains registry URLs unavailable to GitHub Actions: ${matches.join(", ")}. ` +
      "Regenerate it with public registries before releasing.",
    );
  }
}

async function check(expectedValue) {
  const [lockText, cargoLockText] = await Promise.all([
    readFile(files.lock, "utf8"),
    readFile(files.cargoLock, "utf8"),
  ]);
  assertPortableLockfile(lockText, "pos-app/package-lock.json");
  assertPortableLockfile(cargoLockText, "pos-app/src-tauri/Cargo.lock");
  const versions = await readVersions();
  const expected = expectedValue ? normalizeVersion(expectedValue) : versions.package;
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length) {
    const details = Object.entries(versions).map(([name, version]) => `${name}=${version}`).join(", ");
    throw new Error(`POS versions are not aligned with ${expected}: ${details}`);
  }
  console.log(`POS versions aligned at ${expected}.`);
}

async function setVersion(value) {
  const version = normalizeVersion(value);
  const original = new Map();
  for (const file of Object.values(files)) {
    try {
      original.set(file, await readFile(file, "utf8"));
    } catch (error) {
      if (file !== files.lock || error.code !== "ENOENT") throw error;
    }
  }

  const packageJson = JSON.parse(original.get(files.package));
  packageJson.version = version;
  const tauriJson = JSON.parse(original.get(files.tauri));
  tauriJson.version = version;
  const cargoText = original.get(files.cargo).replace(
    /(^\[package\]\s*$[\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  const cargoLockText = original.get(files.cargoLock).replace(
    /(\[\[package\]\]\s*\r?\nname\s*=\s*"globipos-terminal"\s*\r?\nversion\s*=\s*")[^"]+(")/,
    `$1${version}$2`,
  );

  const updates = new Map([
    [files.package, `${JSON.stringify(packageJson, null, 2)}\n`],
    [files.cargo, cargoText],
    [files.cargoLock, cargoLockText],
    [files.tauri, `${JSON.stringify(tauriJson, null, 2)}\n`],
  ]);

  if (original.has(files.lock)) {
    assertPortableLockfile(original.get(files.lock), "pos-app/package-lock.json");
    assertPortableLockfile(original.get(files.cargoLock), "pos-app/src-tauri/Cargo.lock");
    const lockJson = JSON.parse(original.get(files.lock));
    lockJson.version = version;
    if (lockJson.packages?.[""]) lockJson.packages[""].version = version;
    updates.set(files.lock, `${JSON.stringify(lockJson, null, 2)}\n`);
  }

  const temporary = new Map();
  try {
    const journalTemp = `${journalFile}.${process.pid}`;
    await writeFile(
      journalTemp,
      JSON.stringify({ files: [...original].map(([file, contents]) => ({ file, contents })) }),
    );
    await rename(journalTemp, journalFile);
    for (const [file, contents] of updates) {
      const temp = `${file}.pos-version-${process.pid}`;
      await writeFile(temp, contents);
      temporary.set(file, temp);
    }
    for (const [file, temp] of temporary) await rename(temp, file);
    await check(version);
    await unlink(journalFile);
  } catch (error) {
    await Promise.allSettled([...temporary.values()].map((temp) => unlink(temp)));
    const restoration = await Promise.allSettled(
      [...original].map(([file, contents]) => writeFile(file, contents)),
    );
    const rollbackFailures = restoration
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (rollbackFailures.length) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        `${error.message}; rollback was incomplete, so ${journalFile} was retained for recovery.`,
      );
    }
    await unlink(journalFile).catch((unlinkError) => {
      if (unlinkError.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }

  console.log(`Updated all POS version files to ${version}.`);
}

const [command, value, ...extra] = process.argv.slice(2);
if (extra.length || !["--check", "--set"].includes(command)) {
  console.error("Usage: node scripts/pos-version.mjs --check [version-or-tag]");
  console.error("       node scripts/pos-version.mjs --set <version>");
  process.exit(2);
}

try {
  await recoverInterruptedTransaction();
  if (command === "--set") await setVersion(value);
  else await check(value);
} catch (error) {
  console.error(`[ERROR] ${error.message}`);
  process.exit(1);
}