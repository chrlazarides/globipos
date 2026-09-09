import fs from "fs";
import path from "path";
import { strToU8, zipSync } from "fflate";

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

type ArchiveFile = string | Uint8Array;

interface ArchiveDirectory {
  source: string;
  prefix: string;
}

function addDirectory(
  entries: Record<string, Uint8Array>,
  directory: string,
  prefix: string,
) {
  for (const name of fs.readdirSync(directory)) {
    const source = path.join(directory, name);
    const relative = `${prefix}/${name}`.replace(/^\/+/, "");
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) addDirectory(entries, source, relative);
    else if (stat.isFile()) entries[relative] = new Uint8Array(fs.readFileSync(source));
  }
}

export function createDeploymentPackageArchive(
  kind: DeploymentPackageKind,
  files: Record<string, ArchiveFile>,
  directories: ArchiveDirectory[] = [],
): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = typeof value === "string" ? strToU8(value) : value;
  }
  for (const directory of directories) {
    addDirectory(entries, directory.source, directory.prefix);
  }

  for (const required of requiredDeploymentPackageFiles[kind]) {
    const present = required.endsWith("/")
      ? Object.keys(entries).some((name) => name.startsWith(required))
      : Object.hasOwn(entries, required);
    if (!present) throw new Error(`Deployment package is missing required entry: ${required}`);
  }

  return Buffer.from(zipSync(entries, { level: 6 }));
}