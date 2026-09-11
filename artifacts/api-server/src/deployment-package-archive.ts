import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { finished, pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { Zip, ZipDeflate, strToU8 } from "fflate";

export type DeploymentPackageKind = "cpanel" | "compiled" | "synology";

export const cpanelDeploymentSourceFiles = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "postcss.config.js",
  "tailwind.config.ts",
  "drizzle.config.ts",
] as const;

export const cpanelDeploymentSourceDirectories = [
  "client",
  "server",
  "shared",
  "script",
  "migrations",
] as const;

export const requiredDeploymentPackageFiles: Record<DeploymentPackageKind, readonly string[]> = {
  cpanel: [
    ...cpanelDeploymentSourceFiles,
    ...cpanelDeploymentSourceDirectories.map((directory) => `${directory}/`),
    "database.sql",
    ".env.example",
    "ecosystem.config.js",
    "setup.sh",
    "Caddyfile",
    "README-DEPLOY.md",
  ],
  compiled: [
    "dist/",
    "database.sql",
    ".env.example",
    "ecosystem.config.js",
    "start.sh",
    "Caddyfile",
    "README-DEPLOY.md",
  ],
  synology: [
    "dist/",
    "database.sql",
    "Dockerfile",
    "docker-compose.yml",
    ".env.template",
    "setup.sh",
    "README-SYNOLOGY.md",
  ],
};

export type ArchiveFile = string | Uint8Array | { source: string };

interface ArchiveDirectory {
  source: string;
  prefix: string;
}

export interface DeploymentPackageArchive {
  path: string;
  cleanup: () => Promise<void>;
}
export async function createDeploymentPackageArchive(
  kind: DeploymentPackageKind,
  files: Record<string, ArchiveFile>,
  directories: ArchiveDirectory[] = [],
  signal?: AbortSignal,
): Promise<DeploymentPackageArchive> {
  const entries: ArchiveEntry[] = Object.entries(files).map(([name, value]) => ({ name, value }));
  for (const directory of directories) {
    collectDirectory(entries, directory.source, directory.prefix);
  }

  for (const required of requiredDeploymentPackageFiles[kind]) {
    const present = required.endsWith("/")
      ? entries.some(({ name }) => name.startsWith(required))
      : entries.some(({ name }) => name === required);
    if (!present) throw new Error(`Deployment package is missing required entry: ${required}`);
  }

  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "deployment-package-"));
  const archivePath = path.join(tempDirectory, `${kind}.zip`);
  const output = fs.createWriteStream(archivePath, { highWaterMark: 64 * 1024 });
  let streamError: Error | undefined;
  output.on("error", (error) => {
    streamError = error;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      streamError = error;
      output.destroy(error);
      return;
    }
    output.write(chunk);
    if (final) output.end();
  });

  try {
    for (const entry of entries) {
      if (streamError) throw streamError;
      await pushFile(zip, output, entry.name, entry.value, signal);
    }
    zip.end();
    await finished(output);
    if (streamError) throw streamError;
    return {
      path: archivePath,
      cleanup: () => fs.promises.rm(tempDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    zip.terminate();
    output.destroy();
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function createDatabaseDump(databaseUrl: string, signal?: AbortSignal): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  if (signal?.aborted) throw signal.reason ?? new Error("Database dump cancelled");
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "deployment-database-"));
  if (signal?.aborted) {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
    throw signal.reason ?? new Error("Database dump cancelled");
  }
  const dumpPath = path.join(tempDirectory, "database.sql");
  const output = fs.createWriteStream(dumpPath);
  const child = spawn("pg_dump", [
    databaseUrl,
    "--no-password",
    "--format=plain",
    "--no-owner",
    "--no-acl",
    "--quote-all-identifiers",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.reduce((size, part) => size + part.length, 0) < 64 * 1024) stderr.push(chunk);
  });
  const abort = () => child.kill();
  signal?.addEventListener("abort", abort, { once: true });
  const closePromise = once(child, "close") as Promise<[number | null]>;
  const pipelinePromise = pipeline(child.stdout, output);

  try {
    const [[exitCode]] = await Promise.all([closePromise, pipelinePromise]);
    if (signal?.aborted) throw signal.reason ?? new Error("Database dump cancelled");
    if (exitCode !== 0) {
      throw new Error(`pg_dump failed (${exitCode ?? "terminated"}): ${Buffer.concat(stderr).toString("utf8").trim()}`);
    }
    return {
      path: dumpPath,
      cleanup: () => fs.promises.rm(tempDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    child.kill();
    output.destroy();
    await Promise.allSettled([closePromise, pipelinePromise]);
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

interface ArchiveEntry {
  name: string;
  value: ArchiveFile;
}

function collectDirectory(entries: ArchiveEntry[], directory: string, prefix: string) {
  for (const name of fs.readdirSync(directory)) {
    const source = path.join(directory, name);
    const relative = `${prefix}/${name}`.replace(/^\/+/, "");
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) collectDirectory(entries, source, relative);
    else if (stat.isFile()) entries.push({ name: relative, value: { source } });
  }
}

async function pushFile(
  zip: Zip,
  output: fs.WriteStream,
  name: string,
  value: ArchiveFile,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw signal.reason ?? new Error("Deployment package generation cancelled");
  const entry = new ZipDeflate(name, { level: 6 });
  zip.add(entry);

  if (typeof value === "string" || value instanceof Uint8Array) {
    entry.push(typeof value === "string" ? strToU8(value) : value, true);
    if (output.writableNeedDrain) await once(output, "drain");
    return;
  }

  const input = fs.createReadStream(value.source, { highWaterMark: 64 * 1024 });
  for await (const chunk of input) {
    if (signal?.aborted) {
      input.destroy();
      throw signal.reason ?? new Error("Deployment package generation cancelled");
    }
    entry.push(new Uint8Array(chunk as Buffer), false);
    if (output.writableNeedDrain) await once(output, "drain");
  }
  entry.push(new Uint8Array(0), true);
  if (output.writableNeedDrain) await once(output, "drain");
}
