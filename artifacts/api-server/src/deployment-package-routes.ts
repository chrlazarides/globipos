import type { Express, Response } from "express";
import fs from "fs";
import path from "path";
import { execFileSync } from "node:child_process";
import { storage } from "./storage";
import { requireSuperuser } from "./auth";
import {
  cpanelDeploymentSourceDirectories,
  cpanelDeploymentSourceFiles,
  createDatabaseDump,
  createDeploymentPackageArchive,
  type DeploymentPackageArchive,
} from "./deployment-package-archive";
import {
  buildDeploymentEnvironmentTemplate,
  buildDeploymentPm2Config,
} from "./deployment-package-templates";

function downloadDeploymentPackage(
  res: Response,
  archive: DeploymentPackageArchive,
  filename: string,
) {
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = archive.cleanup().catch((error) => {
      cleanupPromise = undefined;
      console.error("Failed to clean temporary deployment package:", error);
    });
    return cleanupPromise;
  };
  res.once("close", () => void cleanup());
  res.download(archive.path, filename, async (error) => {
    await cleanup();
    if (error && !res.headersSent) {
      res.status(500).json({ message: error.message });
    }
  });
}

type PgDumpRunner = typeof execFileSync;

export function runDeploymentPgDump(
  databaseUrl: string,
  runner: PgDumpRunner = execFileSync,
): Buffer {
  return runner(
    "pg_dump",
    [
      databaseUrl,
      "--no-password",
      "--format=plain",
      "--no-owner",
      "--no-acl",
      "--quote-all-identifiers",
    ],
    { maxBuffer: 200 * 1024 * 1024 },
  );
}

type DeploymentPackageRouteDependencies = {
  getCompanyName: () => Promise<string>;
  dumpDatabase: typeof createDatabaseDump;
  compiledBuildExists: (distPath: string) => boolean;
  workingDirectory: () => string;
};

const defaultDeploymentPackageRouteDependencies: DeploymentPackageRouteDependencies = {
  getCompanyName: async () => (await storage.getSetting("company_name"))?.value || "Company",
  dumpDatabase: createDatabaseDump,
  compiledBuildExists: fs.existsSync,
  workingDirectory: process.cwd,
};

let deploymentPackageRouteDependencies = defaultDeploymentPackageRouteDependencies;

export function setDeploymentPackageRouteDependenciesForTests(
  overrides?: Partial<DeploymentPackageRouteDependencies>,
) {
  deploymentPackageRouteDependencies = overrides
    ? { ...defaultDeploymentPackageRouteDependencies, ...overrides }
    : defaultDeploymentPackageRouteDependencies;
}

async function dumpDatabaseForDeployment(databaseUrl: string, signal: AbortSignal) {
  try {
    return await deploymentPackageRouteDependencies.dumpDatabase(databaseUrl, signal);
  } catch {
    throw new Error("Database export failed. Check the database connection and try again.");
  }
}

const fileSlug = (name: string) =>
  (name || "backup").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "backup";

const shellDisplayText = (value: string) =>
  value.replace(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, " ");

const shellDoubleQuotedText = (value: string) =>
  shellDisplayText(value).replace(/[\\"`$]/g, "\\$&");

export function registerDeploymentPackageRoutes(app: Express) {
// ─── cPANEL DEPLOYMENT PACKAGE (superuser only) ─────────────────────────────
app.get("/api/backup/cpanel-package", requireSuperuser, async (req, res) => {
  let databaseDump: Awaited<ReturnType<typeof createDatabaseDump>> | undefined;
  let archive: DeploymentPackageArchive | undefined;
  const abortController = new AbortController();
  const cleanupUnclaimedArchive = async () => {
    const current = archive;
    if (!current) return;
    await current.cleanup();
    if (archive === current) archive = undefined;
  };
  req.once("aborted", () => {
    abortController.abort(new Error("Download cancelled"));
    void cleanupUnclaimedArchive().catch((error) => {
      console.error("Failed to clean cancelled deployment package:", error);
    });
  });
  try {
    const companyName = await deploymentPackageRouteDependencies.getCompanyName();
    const slug = fileSlug(companyName);
    const shellCompanyName = shellDisplayText(companyName);
    const shellQuotedCompanyName = shellDoubleQuotedText(companyName);
    const date = new Date().toISOString().split("T")[0];
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL environment variable not configured");

    // Generate SQL dump via pg_dump
    databaseDump = await dumpDatabaseForDeployment(dbUrl, abortController.signal);

    const envExample = buildDeploymentEnvironmentTemplate();
    const ecosystem = buildDeploymentPm2Config(slug);

    // setup.sh
    const setupSh = [
      "#!/bin/bash",
      "# VinTrade / " + shellCompanyName + " — automated cPanel/VPS setup",
      "# Generated: " + date,
      "set -e",
      "",
      "echo \"\"",
      "echo \"--------------------------------------------------------\"",
      "echo \" " + shellQuotedCompanyName + " — Deployment Setup\"",
      "echo \"--------------------------------------------------------\"",
      "echo \"\"",
      "",
      "# ── 1. Check prerequisites ────────────────────────────────",
      "command -v node >/dev/null 2>&1 || { echo \"ERROR: Node.js not found. Install Node.js 20+ first.\"; exit 1; }",
      "command -v npm  >/dev/null 2>&1 || { echo \"ERROR: npm not found.\"; exit 1; }",
      "command -v psql >/dev/null 2>&1 || { echo \"ERROR: psql not found. Install PostgreSQL client tools.\"; exit 1; }",
      "NODE_VER=$(node -v)",
      "echo \"✓ Node.js $NODE_VER\"",
      "",
      "# ── 2. Create .env if missing ─────────────────────────────",
      "if [ ! -f .env ]; then",
      "  cp .env.example .env",
      "  echo \"\"",
      "  echo \">>> .env file created from .env.example\"",
      "  echo \">>> EDIT .env NOW — set DATABASE_URL and SESSION_SECRET\"",
      "  echo \">>> Then re-run this script.\"",
      "  exit 0",
      "fi",
      "",
      "# Load env",
      "set -a; source .env; set +a",
      "",
      "if [ -z \"$DATABASE_URL\" ]; then",
      "  echo \"ERROR: DATABASE_URL not set in .env\"; exit 1",
      "fi",
      "echo \"✓ .env loaded\"",
      "",
      "# ── 3. Install dependencies ───────────────────────────────",
      "echo \"Installing npm packages (production)...\"",
      "npm install --include=dev",
      "echo \"✓ Dependencies installed\"",
      "",
      "# ── 4. Build the app ──────────────────────────────────────",
      "echo \"Building application...\"",
      "npm run build",
      "echo \"✓ Build complete\"",
      "",
      "# ── 5. Import database ────────────────────────────────────",
      "echo \"Importing database from database.sql...\"",
      "psql \"$DATABASE_URL\" < database.sql",
      "echo \"✓ Database imported\"",
      "",
      "# ── 6. Run migrations ─────────────────────────────────────",
      "echo \"Applying latest schema migrations...\"",
      "npm run db:push",
      "echo \"✓ Schema up to date\"",
      "",
      "# ── 7. Create log directory ───────────────────────────────",
      "mkdir -p logs",
      "",
      "# ── 8. Start with PM2 ────────────────────────────────────",
      "if command -v pm2 >/dev/null 2>&1; then",
      "  pm2 delete " + slug + " 2>/dev/null || true",
      "  pm2 start ecosystem.config.js",
      "  pm2 save",
      "  pm2 startup 2>/dev/null || true",
      "  echo \"✓ App started with PM2\"",
      "else",
      "  echo \"PM2 not found — install globally: npm install -g pm2\"",
      "  echo \"Then run: pm2 start ecosystem.config.js && pm2 save\"",
      "fi",
      "",
      "echo \"\"",
      "echo \"--------------------------------------------------------\"",
      "echo \" Setup complete! Visit your domain to access the app.\"",
      "echo \"--------------------------------------------------------\"",
    ].join("\n");

    // Caddyfile (optional reverse proxy)
    const caddyfile = [
      "# Caddyfile — replace yourdomain.com with your actual domain",
      "# Caddy auto-provisions TLS. Install: https://caddyserver.com",
      "",
      "yourdomain.com {",
      "  reverse_proxy localhost:3000",
      "}",
    ].join("\n");

    // README-DEPLOY.md
    const readme = [
      "# " + companyName + " — cPanel / VPS Deployment Guide",
      "",
      "Generated: " + new Date().toISOString(),
      "",
      "## Contents of this package",
      "",
      "| File | Purpose |",
      "|------|---------|",
      "| `database.sql` | Full PostgreSQL dump — schema + all data |",
      "| `.env.example` | Environment variable template |",
      "| `ecosystem.config.js` | PM2 process manager config |",
      "| `setup.sh` | Automated setup script |",
      "| `Caddyfile` | Optional Caddy reverse proxy config |",
      "| `README-DEPLOY.md` | This guide |",
      "",
      "---",
      "",
      "## Requirements",
      "",
      "| Requirement | Version | Notes |",
      "|-------------|---------|-------|",
      "| Node.js | 20+ | Use [nvm](https://github.com/nvm-sh/nvm) or cPanel Setup Node.js App |",
      "| PostgreSQL | 14+ | Local or remote |",
      "| npm | 8+ | Comes with Node.js |",
      "| PM2 | latest | `npm install -g pm2` |",
      "",
      "---",
      "",
      "## Quick Start (automated)",
      "",
      "```bash",
      "# 1. Upload all files to your server",
      "# 2. Make setup script executable",
      "chmod +x setup.sh",
      "",
      "# 3. Run — it will create .env on first run",
      "./setup.sh",
      "",
      "# 4. Edit .env (set DATABASE_URL and SESSION_SECRET)",
      "nano .env",
      "",
      "# 5. Run setup.sh again to install, build, import DB and start",
      "./setup.sh",
      "```",
      "",
      "---",
      "",
      "## Step-by-step (manual)",
      "",
      "### Step 1 — PostgreSQL database",
      "",
      "In **cPanel > PostgreSQL Databases**:",
      "1. Create a new database, e.g. `cpuser_vintrade`",
      "2. Create a database user with a strong password",
      "3. Add the user to the database with **All Privileges**",
      "",
      "Your `DATABASE_URL` will be:",
      "```",
      "postgresql://cpuser_DBUSER:PASSWORD@localhost:5432/cpuser_vintrade",
      "```",
      "",
      "### Step 2 — Import the database",
      "",
      "```bash",
      "psql \"$DATABASE_URL\" < database.sql",
      "```",
      "",
      "Or via phpPgAdmin: select the database → SQL tab → upload `database.sql`.",
      "",
      "### Step 3 — Environment variables",
      "",
      "```bash",
      "cp .env.example .env",
      "nano .env",
      "```",
      "",
      "Fill in at minimum:",
      "- `DATABASE_URL` — PostgreSQL connection string",
      "- `SESSION_SECRET` — random 64-char hex string",
      "  ```bash",
      "  node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
      "  ```",
      "",
      "### Step 4 — Install & build",
      "",
      "```bash",
      "npm install --include=dev",
      "npm run build",
      "```",
      "",
      "### Step 5 — Run schema migrations",
      "",
      "```bash",
      "npm run db:push",
      "```",
      "",
      "### Step 6 — Start with PM2",
      "",
      "```bash",
      "npm install -g pm2",
      "pm2 start ecosystem.config.js",
      "pm2 save",
      "pm2 startup   # follow the printed command to enable auto-start",
      "```",
      "",
      "### Step 7 — Reverse proxy (Nginx or Caddy)",
      "",
      "**Nginx** (cPanel EasyApache or standalone):",
      "```nginx",
      "server {",
      "    listen 80;",
      "    server_name yourdomain.com;",
      "    location / {",
      "        proxy_pass http://127.0.0.1:3000;",
      "        proxy_http_version 1.1;",
      "        proxy_set_header Upgrade $http_upgrade;",
      "        proxy_set_header Connection 'upgrade';",
      "        proxy_set_header Host $host;",
      "        proxy_cache_bypass $http_upgrade;",
      "    }",
      "}",
      "```",
      "",
      "**Caddy** (auto-TLS):",
      "```",
      "yourdomain.com {",
      "    reverse_proxy localhost:3000",
      "}",
      "```",
      "",
      "---",
      "",
      "## cPanel Node.js App setup (alternative to PM2)",
      "",
      "If your cPanel host supports **Setup Node.js App**:",
      "",
      "1. Go to cPanel > **Setup Node.js App**",
      "2. Click **Create Application**",
      "3. Node.js version: **20.x** (or latest LTS)",
      "4. Application mode: **Production**",
      "5. Application root: path to your uploaded files",
      "6. Application URL: your domain",
      "7. Application startup file: `dist/index.cjs`",
      "8. Click **Create**",
      "9. In the app's environment section, add all variables from `.env`",
      "10. Click **Run NPM Install**, then **Start App**",
      "",
      "---",
      "",
      "## Email configuration",
      "",
      "Email (invoice sending, backup alerts) is powered by **Resend**.",
      "After the app starts, go to **Settings > Email** to enter your Resend API key.",
      "No environment variable is needed — it is stored in the database.",
      "",
      "---",
      "",
      "## Automatic daily backup",
      "",
      "Go to **Settings > Backup & Recovery > Automatic Daily Backup**,",
      "enter an email address and toggle it on.",
      "The app will email a differential backup every 24 hours automatically.",
      "",
      "---",
      "",
      "## Default login",
      "",
      "The database dump includes all user accounts from the source system.",
      "Use the same username and password you used before migrating.",
      "If you need to reset a password, use the **Users** tab in Settings.",
      "",
      "---",
      "",
      "## Troubleshooting",
      "",
      "| Problem | Solution |",
      "|---------|----------|",
      "| `ECONNREFUSED` on startup | Check `DATABASE_URL` in `.env` |",
      "| Port already in use | Change `PORT` in `.env` or stop other processes |",
      "| App crashes immediately | Run `pm2 logs` to see the error |",
      "| Login fails | Passwords in the dump are bcrypt-hashed — they carry over correctly |",
      "| 502 Bad Gateway | The app may not have started; check `pm2 status` |",
      "",
      "---",
      "",
      "*Generated by " + companyName + " VinTrade ERP — " + date + "*",
    ].join("\n");

    const workingDirectory = deploymentPackageRouteDependencies.workingDirectory();
    const applicationFiles = Object.fromEntries(
      cpanelDeploymentSourceFiles.map((name) => [
        name,
        { source: path.join(workingDirectory, name) },
      ]),
    );
    const applicationDirectories = cpanelDeploymentSourceDirectories.map((name) => ({
      source: path.join(workingDirectory, name),
      prefix: name,
    }));

    archive = await createDeploymentPackageArchive("cpanel", {
      ...applicationFiles,
      "database.sql": { source: databaseDump.path },
      ".env.example": envExample,
      "ecosystem.config.js": ecosystem,
      "setup.sh": setupSh,
      "Caddyfile": caddyfile,
      "README-DEPLOY.md": readme,
    }, applicationDirectories, abortController.signal);
    if (abortController.signal.aborted) {
      await cleanupUnclaimedArchive();
      throw abortController.signal.reason;
    }
    await databaseDump.cleanup();
    databaseDump = undefined;
    downloadDeploymentPackage(res, archive, `${slug}-cpanel-${date}.zip`);
    archive = undefined;
  } catch (e: any) {
    const cleanupResults = await Promise.allSettled([
      databaseDump?.cleanup(),
      cleanupUnclaimedArchive(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        console.error("Failed to clean deployment package resource:", result.reason);
      }
    }
    if (!res.headersSent) res.status(500).json({ message: e.message });
  }
});

app.get("/api/backup/compiled-package", requireSuperuser, async (req, res) => {
  let databaseDump: Awaited<ReturnType<typeof createDatabaseDump>> | undefined;
  let archive: DeploymentPackageArchive | undefined;
  const abortController = new AbortController();
  const cleanupUnclaimedArchive = async () => {
    const current = archive;
    if (!current) return;
    await current.cleanup();
    if (archive === current) archive = undefined;
  };
  req.once("aborted", () => {
    abortController.abort(new Error("Download cancelled"));
    void cleanupUnclaimedArchive().catch((error) => {
      console.error("Failed to clean cancelled deployment package:", error);
    });
  });
  try {
    const companyName = await deploymentPackageRouteDependencies.getCompanyName();
    const slug = fileSlug(companyName);
    const shellCompanyName = shellDisplayText(companyName);
    const shellQuotedCompanyName = shellDoubleQuotedText(companyName);
    const date = new Date().toISOString().split("T")[0];
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL environment variable not configured");

    // Check dist/ exists
    const distPath = path.join(deploymentPackageRouteDependencies.workingDirectory(), "dist");
    if (!deploymentPackageRouteDependencies.compiledBuildExists(distPath)) {
      throw new Error("Compiled build not found. Run 'npm run build' first.");
    }

    // SQL dump
    databaseDump = await dumpDatabaseForDeployment(dbUrl, abortController.signal);

    const envExample = buildDeploymentEnvironmentTemplate();
    const ecosystem = buildDeploymentPm2Config(slug);

    // start.sh — no build step needed (app is pre-compiled)
    const startSh = [
      "#!/bin/bash",
      "# " + shellCompanyName + " — Pre-compiled VPS/cPanel Startup Script",
      "# Generated: " + date,
      "# This package contains the pre-compiled application.",
      "# No npm install or build step required.",
      "set -e",
      "",
      "echo \"\"",
      "echo \"--------------------------------------------------------\"",
      "echo \" " + shellQuotedCompanyName + " — Startup\"",
      "echo \"--------------------------------------------------------\"",
      "echo \"\"",
      "",
      "# ── 1. Prerequisites ──────────────────────────────────────",
      "command -v node >/dev/null 2>&1 || { echo \"ERROR: Node.js 20+ required.\"; exit 1; }",
      "command -v psql >/dev/null 2>&1 || { echo \"ERROR: psql required (PostgreSQL client).\"; exit 1; }",
      "",
      "# ── 2. Create .env if missing ─────────────────────────────",
      "if [ ! -f .env ]; then",
      "  cp .env.example .env",
      "  echo \">>> .env created. EDIT IT NOW — set DATABASE_URL and SESSION_SECRET.\"",
      "  echo \">>> Then re-run this script.\"",
      "  exit 0",
      "fi",
      "set -a; source .env; set +a",
      "if [ -z \"$DATABASE_URL\" ]; then",
      "  echo \"ERROR: DATABASE_URL not set in .env\"; exit 1",
      "fi",
      "echo \"✓ .env loaded\"",
      "",
      "# ── 3. Import database ────────────────────────────────────",
      "read -rp \"Import database from database.sql? (y/N) \" ans",
      "if [[ \"$ans\" =~ ^[Yy]$ ]]; then",
      "  echo \"Importing database...\"",
      "  psql \"$DATABASE_URL\" < database.sql",
      "  echo \"✓ Database imported\"",
      "fi",
      "",
      "# ── 4. Create log directory ───────────────────────────────",
      "mkdir -p logs",
      "",
      "# ── 5. Start with PM2 ────────────────────────────────────",
      "if command -v pm2 >/dev/null 2>&1; then",
      "  pm2 delete " + slug + " 2>/dev/null || true",
      "  pm2 start ecosystem.config.js",
      "  pm2 save",
      "  pm2 startup 2>/dev/null || true",
      "  echo \"✓ App started with PM2\"",
      "else",
      "  echo \"PM2 not found — install: npm install -g pm2\"",
      "  echo \"Then run: pm2 start ecosystem.config.js && pm2 save\"",
      "  echo \"\"",
      "  echo \"Or start directly: node dist/index.cjs\"",
      "fi",
      "",
      "echo \"\"",
      "echo \"--------------------------------------------------------\"",
      "echo \" Done! Visit your domain to access the app.\"",
      "echo \"--------------------------------------------------------\"",
    ].join("\n");

    // Caddyfile
    const caddyfile = [
      "# Caddyfile — replace yourdomain.com with your domain",
      "# Caddy auto-provisions TLS. Install: https://caddyserver.com",
      "",
      "yourdomain.com {",
      "  reverse_proxy localhost:3000",
      "}",
    ].join("\n");

    // README
    const readme = [
      "# " + companyName + " — Pre-Compiled Deployment Package",
      "",
      "Generated: " + new Date().toISOString(),
      "",
      "> **This package contains the pre-compiled application.**",
      "> No `npm install` or `npm run build` step is required on the target server.",
      "",
      "## Contents",
      "",
      "| File / Folder | Purpose |",
      "|---------------|---------|",
      "| `dist/` | Pre-compiled application (server + frontend assets) |",
      "| `database.sql` | Full PostgreSQL dump — schema + all live data |",
      "| `.env.example` | Environment variable template |",
      "| `ecosystem.config.js` | PM2 process manager config |",
      "| `start.sh` | Interactive startup script |",
      "| `Caddyfile` | Optional Caddy reverse proxy config |",
      "| `README-DEPLOY.md` | This guide |",
      "",
      "---",
      "",
      "## Requirements",
      "",
      "| Requirement | Version | Notes |",
      "|-------------|---------|-------|",
      "| Node.js | 20+ | Runtime only — no build tools needed |",
      "| PostgreSQL | 14+ | Local or remote |",
      "| PM2 | latest | `npm install -g pm2` (optional but recommended) |",
      "",
      "---",
      "",
      "## Quick Start",
      "",
      "```bash",
      "# 1. Upload and extract this ZIP on your server",
      "unzip " + slug + "-compiled-" + date + ".zip -d app && cd app",
      "",
      "# 2. Make start script executable",
      "chmod +x start.sh",
      "",
      "# 3. Run — creates .env on first run",
      "./start.sh",
      "",
      "# 4. Edit .env (set DATABASE_URL + SESSION_SECRET)",
      "nano .env",
      "",
      "# 5. Run again — imports DB and starts the app",
      "./start.sh",
      "```",
      "",
      "---",
      "",
      "## Manual Steps",
      "",
      "### 1. Set up the database",
      "",
      "```bash",
      "cp .env.example .env",
      "nano .env   # fill in DATABASE_URL and SESSION_SECRET",
      "```",
      "",
      "### 2. Import the database",
      "",
      "```bash",
      "psql \"$DATABASE_URL\" < database.sql",
      "```",
      "",
      "### 3. Start the application",
      "",
      "```bash",
      "# With PM2 (recommended)",
      "npm install -g pm2",
      "pm2 start ecosystem.config.js",
      "pm2 save && pm2 startup",
      "",
      "# Or directly",
      "node dist/index.cjs",
      "```",
      "",
      "### 4. Reverse proxy (optional)",
      "",
      "Use the included `Caddyfile` (Caddy auto-TLS) or an Nginx/Apache config",
      "pointing to `http://localhost:3000`.",
      "",
      "---",
      "",
      "*Generated by " + companyName + " GlobiPOS ERP — " + date + "*",
    ].join("\n");

    archive = await createDeploymentPackageArchive("compiled", {
      "database.sql": { source: databaseDump.path },
      ".env.example": envExample,
      "ecosystem.config.js": ecosystem,
      "start.sh": startSh,
      "Caddyfile": caddyfile,
      "README-DEPLOY.md": readme,
    }, [{ source: distPath, prefix: "dist" }], abortController.signal);
    if (abortController.signal.aborted) {
      await cleanupUnclaimedArchive();
      throw abortController.signal.reason;
    }
    await databaseDump.cleanup();
    databaseDump = undefined;
    downloadDeploymentPackage(res, archive, `${slug}-compiled-${date}.zip`);
    archive = undefined;
  } catch (e: any) {
    const cleanupResults = await Promise.allSettled([
      databaseDump?.cleanup(),
      cleanupUnclaimedArchive(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        console.error("Failed to clean deployment package resource:", result.reason);
      }
    }
    if (!res.headersSent) res.status(500).json({ message: e.message });
  }
});

app.get("/api/backup/synology-package", requireSuperuser, async (req, res) => {
  let databaseDump: Awaited<ReturnType<typeof createDatabaseDump>> | undefined;
  let archive: DeploymentPackageArchive | undefined;
  const abortController = new AbortController();
  const cleanupUnclaimedArchive = async () => {
    const current = archive;
    if (!current) return;
    await current.cleanup();
    if (archive === current) archive = undefined;
  };
  req.once("aborted", () => {
    abortController.abort(new Error("Download cancelled"));
    void cleanupUnclaimedArchive().catch((error) => {
      console.error("Failed to clean cancelled deployment package:", error);
    });
  });
  try {
    const companyName = await deploymentPackageRouteDependencies.getCompanyName();
    const slug = fileSlug(companyName);
    const shellCompanyName = shellDisplayText(companyName);
    const shellQuotedCompanyName = shellDoubleQuotedText(companyName);
    const date = new Date().toISOString().split("T")[0];
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL environment variable not configured");

    const distPath = path.join(deploymentPackageRouteDependencies.workingDirectory(), "dist");
    if (!deploymentPackageRouteDependencies.compiledBuildExists(distPath)) {
      throw new Error("Compiled build not found. Run 'npm run build' first.");
    }

    // SQL dump
    databaseDump = await dumpDatabaseForDeployment(dbUrl, abortController.signal);

    // Dockerfile — minimal Node.js image, copies pre-built dist/
    const dockerfile = [
      "FROM node:20-alpine",
      "WORKDIR /app",
      "COPY dist/ ./dist/",
      "EXPOSE 3000",
      'CMD ["node", "dist/index.cjs"]',
    ].join("\n");

    // docker-compose.yml — app + postgres, DB auto-imported on first start
    const dockerCompose = [
      "version: '3.8'",
      "",
      "services:",
      "  app:",
      "    build: .",
      "    container_name: " + slug + "-app",
      "    ports:",
      '      - "${APP_PORT:-3000}:3000"',
      "    environment:",
      "      - NODE_ENV=production",
      "      - DATABASE_URL=postgresql://globipos:${DB_PASSWORD:-globipos}@db:5432/globipos",
      "      - SESSION_SECRET=${SESSION_SECRET}",
      "    depends_on:",
      "      db:",
      "        condition: service_healthy",
      "    restart: unless-stopped",
      "    networks:",
      "      - globipos-net",
      "",
      "  db:",
      "    image: postgres:16-alpine",
      "    container_name: " + slug + "-db",
      "    environment:",
      "      - POSTGRES_DB=globipos",
      "      - POSTGRES_USER=globipos",
      "      - POSTGRES_PASSWORD=${DB_PASSWORD:-globipos}",
      "    volumes:",
      "      - postgres_data:/var/lib/postgresql/data",
      "      - ./database.sql:/docker-entrypoint-initdb.d/01-init.sql",
      "    healthcheck:",
      '      test: ["CMD-SHELL", "pg_isready -U globipos"]',
      "      interval: 5s",
      "      timeout: 5s",
      "      retries: 10",
      "    restart: unless-stopped",
      "    networks:",
      "      - globipos-net",
      "",
      "volumes:",
      "  postgres_data:",
      "",
      "networks:",
      "  globipos-net:",
    ].join("\n");

    // .env for docker-compose
    const envFile = [
      "# ── GlobiPOS Synology / Docker deployment ──────────────────────────────",
      "# Generated: " + date,
      "",
      "# Port the app will be accessible on (on your Synology)",
      "APP_PORT=3000",
      "",
      "# PostgreSQL password (change before first start)",
      "DB_PASSWORD=globipos_CHANGE_ME",
      "",
      "# Session secret — generate with:",
      "# node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
      "SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX",
    ].join("\n");

    // setup.sh for SSH deployment on Synology
    const setupSh = [
      "#!/bin/bash",
      "# " + shellCompanyName + " — Synology NAS Docker Setup",
      "# Generated: " + date,
      "# Run this via SSH on your Synology (or manually follow the README steps).",
      "set -e",
      "",
      "echo \"\"",
      "echo \"--------------------------------------------------------\"",
      "echo \" " + shellQuotedCompanyName + " — Synology Docker Setup\"",
      "echo \"--------------------------------------------------------\"",
      "echo \"\"",
      "",
      "command -v docker >/dev/null 2>&1 || { echo \"ERROR: Docker not found. Install Container Manager from Synology Package Center.\"; exit 1; }",
      "command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1 || { echo \"ERROR: docker compose not available.\"; exit 1; }",
      "echo \"✓ Docker available\"",
      "",
      "if [ ! -f .env ]; then",
      "  cp .env.template .env",
      "  echo \"\"",
      "  echo \">>> .env file created from .env.template\"",
      "  echo \">>> IMPORTANT: Edit .env and set DB_PASSWORD and SESSION_SECRET\"",
      "  echo \">>> Then re-run this script.\"",
      "  exit 0",
      "fi",
      "echo \"✓ .env file found\"",
      "",
      "# Prefer docker compose (v2) over docker-compose (v1)",
      "DC=\"docker compose\"",
      "if ! docker compose version >/dev/null 2>&1; then",
      "  DC=\"docker-compose\"",
      "fi",
      "",
      "echo \"Building Docker image...\"",
      "$DC build",
      "echo \"✓ Image built\"",
      "",
      "echo \"Starting services...\"",
      "$DC up -d",
      "echo \"✓ Services started\"",
      "",
      "echo \"\"",
      "echo \"--------------------------------------------------------\"",
      "echo \" Done!\"",
      "echo \" App is available at http://YOUR-SYNOLOGY-IP:$(grep APP_PORT .env | cut -d= -f2 || echo 3000)\"",
      "echo \" Note: First start imports the database automatically.\"",
      "echo \" This takes ~30 seconds — wait before opening the app.\"",
      "echo \"--------------------------------------------------------\"",
    ].join("\n");

    // README-SYNOLOGY.md
    const readme = [
      "# " + companyName + " — Synology NAS Deployment Guide",
      "",
      "Generated: " + new Date().toISOString(),
      "",
      "> **Deploy on your Synology NAS using Docker / Container Manager.**",
      "> No build tools needed — the app is pre-compiled.",
      "> The database is imported automatically on first start.",
      "",
      "---",
      "",
      "## Contents",
      "",
      "| File | Purpose |",
      "|------|---------|",
      "| `dist/` | Pre-compiled application |",
      "| `database.sql` | Full database dump (auto-imported on first start) |",
      "| `Dockerfile` | Builds the app container from `dist/` |",
      "| `docker-compose.yml` | Orchestrates app + PostgreSQL containers |",
      "| `.env.template` | Environment variable template |",
      "| `setup.sh` | SSH-based quick-start script |",
      "| `README-SYNOLOGY.md` | This guide |",
      "",
      "---",
      "",
      "## Method 1 — Container Manager UI (recommended for most users)",
      "",
      "### Step 1 — Install Docker / Container Manager",
      "",
      "Open **Package Center** on your Synology → search for **Container Manager** → Install.",
      "",
      "### Step 2 — Upload files",
      "",
      "Using **File Station**, create a folder (e.g. `docker/globipos`) and upload",
      "the **entire contents** of this ZIP into it.",
      "",
      "### Step 3 — Edit the environment file",
      "",
      "In File Station, open `.env.template`, rename it to `.env`, and change:",
      "",
      "```",
      "DB_PASSWORD=globipos_CHANGE_ME        ← set a strong password",
      "SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX  ← random 64-char string",
      "APP_PORT=3000                          ← port to access the app on",
      "```",
      "",
      "To generate a SESSION_SECRET, open **Container Manager → Terminal** on any",
      "running container and run:",
      "```bash",
      "node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"",
      "```",
      "Or generate one at https://generate-secret.vercel.app/64",
      "",
      "### Step 4 — Create the project in Container Manager",
      "",
      "1. Open **Container Manager → Project → Create**",
      "2. Set **Project Name** to `" + slug + "`",
      "3. Set **Path** to the folder you uploaded the files to",
      "4. Click **Next** — Container Manager reads `docker-compose.yml` automatically",
      "5. Click **Next** → **Done**",
      "",
      "### Step 5 — Wait for first-start database import",
      "",
      "On first start the PostgreSQL container automatically imports `database.sql`.",
      "This takes about 30–60 seconds. Watch the container logs in Container Manager.",
      "Once both containers show **Running**, open:",
      "",
      "```",
      "http://YOUR-SYNOLOGY-IP:3000",
      "```",
      "",
      "---",
      "",
      "## Method 2 — SSH quick-start",
      "",
      "```bash",
      "# 1. SSH into your Synology",
      "ssh admin@YOUR-SYNOLOGY-IP",
      "",
      "# 2. Go to the folder you uploaded the files to",
      "cd /volume1/docker/globipos",
      "",
      "# 3. Make the script executable and run it",
      "chmod +x setup.sh",
      "./setup.sh",
      "",
      "# 4. Edit .env (it is created automatically on first run)",
      "nano .env",
      "",
      "# 5. Run again to start",
      "./setup.sh",
      "```",
      "",
      "---",
      "",
      "## Updating the app",
      "",
      "1. Download a new Synology package from Settings → Full System Export",
      "2. Replace the `dist/` folder and `Dockerfile` in your Synology folder",
      "3. In Container Manager → Project → `" + slug + "` → **Build**",
      "4. The database is NOT re-imported on updates (data is safe in the volume)",
      "",
      "---",
      "",
      "## Useful commands (SSH)",
      "",
      "```bash",
      "# View logs",
      "docker compose logs -f app",
      "",
      "# Stop",
      "docker compose down",
      "",
      "# Start",
      "docker compose up -d",
      "",
      "# Rebuild after update",
      "docker compose build && docker compose up -d",
      "",
      "# Open a shell inside the app container",
      "docker exec -it " + slug + "-app sh",
      "",
      "# Manual DB backup from container",
      "docker exec " + slug + "-db pg_dump -U globipos globipos > backup-$(date +%F).sql",
      "```",
      "",
      "---",
      "",
      "## Reverse proxy (optional — for a custom domain or HTTPS)",
      "",
      "In **Control Panel → Login Portal → Advanced → Reverse Proxy**, add:",
      "",
      "| Field | Value |",
      "|-------|-------|",
      "| Source Protocol | HTTPS |",
      "| Source Hostname | your-domain.com |",
      "| Destination Protocol | HTTP |",
      "| Destination Hostname | localhost |",
      "| Destination Port | 3000 |",
      "",
      "Synology's built-in Let's Encrypt integration handles the TLS certificate.",
      "",
      "---",
      "",
      "*Generated by " + companyName + " GlobiPOS ERP — " + date + "*",
    ].join("\n");

    archive = await createDeploymentPackageArchive("synology", {
      "database.sql": { source: databaseDump.path },
      "Dockerfile": dockerfile,
      "docker-compose.yml": dockerCompose,
      ".env.template": envFile,
      "setup.sh": setupSh,
      "README-SYNOLOGY.md": readme,
    }, [{ source: distPath, prefix: "dist" }], abortController.signal);
    if (abortController.signal.aborted) {
      await cleanupUnclaimedArchive();
      throw abortController.signal.reason;
    }
    await databaseDump.cleanup();
    databaseDump = undefined;
    downloadDeploymentPackage(res, archive, `${slug}-synology-${date}.zip`);
    archive = undefined;
  } catch (e: any) {
    const cleanupResults = await Promise.allSettled([
      databaseDump?.cleanup(),
      cleanupUnclaimedArchive(),
    ]);
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        console.error("Failed to clean deployment package resource:", result.reason);
      }
    }
    if (!res.headersSent) res.status(500).json({ message: e.message });
  }
});
}
