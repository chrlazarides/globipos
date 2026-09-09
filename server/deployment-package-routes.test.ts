import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { strFromU8, unzipSync } from "fflate";
import { requireAuth, signToken } from "./auth";
import {
  cpanelDeploymentSourceDirectories,
  cpanelDeploymentSourceFiles,
} from "./deployment-package-archive";
import {
  registerDeploymentPackageRoutes,
  runDeploymentPgDump,
  setDeploymentPackageRouteDependenciesForTests,
} from "./deployment-package-routes";
import {
  buildDeploymentEnvironmentTemplate,
  buildDeploymentPm2Config,
} from "./deployment-package-templates";

const expectedDate = () => new Date().toISOString().split("T")[0];

function archiveText(entries: ReturnType<typeof unzipSync>, name: string) {
  const entry = entries[name];
  assert.ok(entry, `expected deployment archive to contain ${name}`);
  return strFromU8(entry);
}

function assertSharedEnvironmentTemplate(contents: string) {
  assert.match(contents, /^DATABASE_URL=postgresql:\/\/DB_USER:DB_PASSWORD@localhost:5432\/DB_NAME$/m);
  assert.match(contents, /^SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX$/m);
  assert.match(contents, /^NODE_ENV=production$/m);
  assert.match(contents, /^PORT=3000$/m);
  assert.match(contents, /randomBytes\(64\)\.toString\('hex'\)/);
}

function assertPm2Config(contents: string) {
  assert.match(contents, /name: "route-test-co"/);
  assert.match(contents, /script: "dist\/index\.cjs"/);
  assert.match(contents, /NODE_ENV: "production"/);
  assert.match(contents, /PORT: 3000/);
  assert.match(contents, /autorestart: true/);
  assert.match(contents, /max_memory_restart: "512M"/);
  assert.match(contents, /error_file: "logs\/err\.log"/);
  assert.match(contents, /out_file: "logs\/out\.log"/);
  execFileSync(process.execPath, ["--check", "-"], {
    input: contents,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function assertShellSyntax(contents: string) {
  execFileSync("bash", ["-n", "-"], {
    input: contents,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function assertDockerfileSyntax(contents: string) {
  const instructions = contents
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
  assert.deepEqual(
    instructions.map(line => line.match(/^([A-Z]+)(?:\s+|$)/)?.[1]),
    ["FROM", "WORKDIR", "COPY", "EXPOSE", "CMD"],
    "Dockerfile must contain only the expected, well-formed instructions",
  );
  const cmd = instructions.at(-1)?.replace(/^CMD\s+/, "");
  assert.ok(cmd, "Dockerfile must end with CMD");
  assert.deepEqual(JSON.parse(cmd), ["node", "dist/index.cjs"]);
}

function assertComposeSyntax(contents: string) {
  assert.doesNotMatch(contents, /\t/, "Compose YAML must use spaces, not tabs");
  assert.match(contents, /^services:\n  app:\n/m);
  assert.match(contents, /^  db:\n/m);
  assert.match(contents, /^volumes:\n  postgres_data:\s*$/m);
  assert.match(contents, /^networks:\n  globipos-net:\s*$/m);
  assert.match(contents, /^\s+- "\$\{APP_PORT:-3000\}:3000"$/m);

  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
  } catch {
    return;
  }

  execFileSync("docker", ["compose", "--ansi", "never", "-f", "-", "config", "--quiet"], {
    input: contents,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      APP_PORT: "3000",
      DB_PASSWORD: "deployment-test-password",
      SESSION_SECRET: "deployment-test-session-secret",
    },
  });
}

async function startTestApp(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(requireAuth);
  const server = createServer(app);
  registerDeploymentPackageRoutes(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function roleHeaders(role: "superuser" | "admin" | "staff") {
  const token = signToken({
    id: crypto.randomUUID(),
    username: "deployment-route-test",
    email: null,
    role,
    permissions: [],
  });
  return { authorization: `Bearer ${token}` };
}

function superuserHeaders() {
  return roleHeaders("superuser");
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()),
  );
}

test("deployment pg_dump passes unusual database URLs as one literal argument", () => {
  const databaseUrl = `postgresql://admin:p a's"s$word;$(touch /tmp/nope)&|<>@database.internal:5432/production`;
  const calls: Array<{
    file: string;
    args: readonly string[];
    options: { maxBuffer?: number };
  }> = [];

  const output = runDeploymentPgDump(databaseUrl, ((file, args, options) => {
    calls.push({
      file,
      args: args ?? [],
      options: options ?? {},
    });
    return Buffer.from("-- safe dump");
  }) as typeof import("node:child_process").execFileSync);

  assert.equal(output.toString(), "-- safe dump");
  assert.deepEqual(calls, [{
    file: "pg_dump",
    args: [
      databaseUrl,
      "--no-password",
      "--format=plain",
      "--no-owner",
      "--no-acl",
      "--quote-all-identifiers",
    ],
    options: { maxBuffer: 200 * 1024 * 1024 },
  }]);
});

test("deployment package downloads reject lower-privilege users without running pg_dump", async t => {
  let dumpCalls = 0;
  setDeploymentPackageRouteDependenciesForTests({
    dumpDatabase: async () => {
      dumpCalls += 1;
      throw new Error("pg_dump must not run for rejected requests");
    },
  });
  const { server, baseUrl } = await startTestApp();
  t.after(async () => {
    await closeServer(server);
    setDeploymentPackageRouteDependenciesForTests();
  });

  const routes = ["cpanel-package", "compiled-package", "synology-package"];
  const callers = [
    { name: "admin", headers: roleHeaders("admin"), expectedStatus: 403 },
    { name: "staff", headers: roleHeaders("staff"), expectedStatus: 403 },
    { name: "unauthenticated", headers: undefined, expectedStatus: 401 },
  ] as const;

  for (const route of routes) {
    for (const caller of callers) {
      const response = await fetch(`${baseUrl}/api/backup/${route}`, {
        headers: caller.headers,
      });
      assert.equal(
        response.status,
        caller.expectedStatus,
        `${caller.name} request to ${route} should be rejected`,
      );
    }
  }

  assert.equal(dumpCalls, 0);
});

test("superusers can download all deployment package types with usable ZIP headers", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-route-"));
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist", "index.cjs"), "compiled server");
  for (const name of cpanelDeploymentSourceFiles) {
    fs.writeFileSync(path.join(root, name), `route fixture:${name}`);
  }
  for (const name of cpanelDeploymentSourceDirectories) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, "source.txt"), `route fixture:${name}`);
  }
  fs.writeFileSync(path.join(root, ".env"), "SESSION_SECRET=must-not-leak");
  fs.writeFileSync(path.join(root, "local.sqlite"), "must-not-leak");
  fs.symlinkSync(path.join(root, "package.json"), path.join(root, "server", "unsafe-link"));

  const dumpedUrls: string[] = [];
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test.invalid/deployment";
  setDeploymentPackageRouteDependenciesForTests({
    getCompanyName: async () => "Route Test & Co",
    workingDirectory: () => root,
    compiledBuildExists: () => true,
    dumpDatabase: async databaseUrl => {
      dumpedUrls.push(databaseUrl);
      const dumpPath = path.join(root, `database-${dumpedUrls.length}.sql`);
      fs.writeFileSync(dumpPath, "-- controlled pg_dump output");
      return {
        path: dumpPath,
        cleanup: () => fs.promises.rm(dumpPath, { force: true }),
      };
    },
  });
  const { server, baseUrl } = await startTestApp();
  t.after(async () => {
    await closeServer(server);
    setDeploymentPackageRouteDependenciesForTests();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  for (const [route, kind] of [
    ["cpanel-package", "cpanel"],
    ["compiled-package", "compiled"],
    ["synology-package", "synology"],
  ] as const) {
    const response = await fetch(`${baseUrl}/api/backup/${route}`, {
      headers: superuserHeaders(),
    });
    const archive = new Uint8Array(await response.arrayBuffer());

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="route-test-co-${kind}-${expectedDate()}.zip"`,
    );
    assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const entries = unzipSync(archive);

    if (kind === "cpanel") {
      for (const name of cpanelDeploymentSourceFiles) {
        assert.equal(strFromU8(entries[name]), `route fixture:${name}`);
      }
      for (const name of cpanelDeploymentSourceDirectories) {
        assert.equal(
          strFromU8(entries[`${name}/source.txt`]),
          `route fixture:${name}`,
        );
      }
      assert.equal(entries[".env"], undefined);
      assert.equal(entries["local.sqlite"], undefined);
      assert.equal(entries["server/unsafe-link"], undefined);

      const envExample = archiveText(entries, ".env.example");
      assertSharedEnvironmentTemplate(envExample);
      assert.equal(envExample, buildDeploymentEnvironmentTemplate());

      const setupScript = archiveText(entries, "setup.sh");
      assertShellSyntax(setupScript);
      const installCommand = setupScript.match(/^npm install(?<flags>.*)$/m);
      assert.ok(installCommand?.groups);
      assert.match(setupScript, /cp \.env\.example \.env/);
      assert.match(setupScript, /psql "\$DATABASE_URL" < database\.sql/);
      assert.match(setupScript, /\nnpm run build\n/);
      assert.match(setupScript, /\nnpm run db:push\n/);
      assert.match(setupScript, /pm2 start ecosystem\.config\.js/);
      assert.match(setupScript, /pm2 save/);
      const npmCli = process.env.npm_execpath;
      assert.ok(npmCli, "npm_execpath must be available when tests run through npm");
      const effectiveOmit = execFileSync(
        process.execPath,
        [
          npmCli,
          "config",
          "get",
          "omit",
          ...installCommand.groups.flags.trim().split(/\s+/).filter(Boolean),
        ],
        {
          encoding: "utf8",
          env: { ...process.env, NODE_ENV: "production" },
        },
      ).trim();
      assert.equal(effectiveOmit, "", "setup must install build tools in production mode");
      const pm2Config = archiveText(entries, "ecosystem.config.js");
      assertPm2Config(pm2Config);
      assert.equal(pm2Config, buildDeploymentPm2Config("route-test-co"));

      const caddyfile = archiveText(entries, "Caddyfile");
      assert.match(caddyfile, /yourdomain\.com \{/);
      assert.match(caddyfile, /reverse_proxy localhost:3000/);

      const readme = archiveText(entries, "README-DEPLOY.md");
      assert.match(readme, /cPanel \/ VPS Deployment Guide/);
      assert.match(readme, /cPanel > PostgreSQL Databases/);
      assert.match(readme, /npm install --include=dev/);
      assert.match(readme, /npm run build/);
      assert.match(readme, /npm run db:push/);
      assert.match(readme, /Application startup file: `dist\/index\.cjs`/);
      assert.match(readme, /pm2 start ecosystem\.config\.js/);
    } else if (kind === "compiled") {
      const envExample = archiveText(entries, ".env.example");
      assertSharedEnvironmentTemplate(envExample);
      assert.equal(envExample, buildDeploymentEnvironmentTemplate());
      const pm2Config = archiveText(entries, "ecosystem.config.js");
      assertPm2Config(pm2Config);
      assert.equal(pm2Config, buildDeploymentPm2Config("route-test-co"));

      const startScript = archiveText(entries, "start.sh");
      assertShellSyntax(startScript);
      assert.match(startScript, /No npm install or build step required/);
      assert.doesNotMatch(startScript, /^npm install/m);
      assert.doesNotMatch(startScript, /^npm run build/m);
      assert.match(startScript, /cp \.env\.example \.env/);
      assert.match(startScript, /psql "\$DATABASE_URL" < database\.sql/);
      assert.match(startScript, /pm2 start ecosystem\.config\.js/);
      assert.match(startScript, /node dist\/index\.cjs/);

      const readme = archiveText(entries, "README-DEPLOY.md");
      assert.match(readme, /Pre-Compiled Deployment Package/);
      assert.match(readme, /No `npm install` or `npm run build` step is required/);
      assert.match(readme, /unzip route-test-co-compiled-/);
      assert.match(readme, /psql "\$DATABASE_URL" < database\.sql/);
      assert.match(readme, /pm2 start ecosystem\.config\.js/);
      assert.match(readme, /node dist\/index\.cjs/);
      assert.match(archiveText(entries, "Caddyfile"), /reverse_proxy localhost:3000/);
    } else {
      const dockerfile = archiveText(entries, "Dockerfile");
      assertDockerfileSyntax(dockerfile);
      assert.match(dockerfile, /^FROM node:20-alpine$/m);
      assert.match(dockerfile, /^COPY dist\/ \.\/dist\/$/m);
      assert.match(dockerfile, /^EXPOSE 3000$/m);
      assert.match(dockerfile, /^CMD \["node", "dist\/index\.cjs"\]$/m);

      const compose = archiveText(entries, "docker-compose.yml");
      assertComposeSyntax(compose);
      assert.match(compose, /DATABASE_URL=postgresql:\/\/globipos:\$\{DB_PASSWORD:-globipos\}@db:5432\/globipos/);
      assert.match(compose, /SESSION_SECRET=\$\{SESSION_SECRET\}/);
      assert.match(compose, /condition: service_healthy/);
      assert.match(compose, /image: postgres:16-alpine/);
      assert.match(compose, /\.\/database\.sql:\/docker-entrypoint-initdb\.d\/01-init\.sql/);
      assert.match(compose, /postgres_data:\/var\/lib\/postgresql\/data/);
      assert.match(compose, /restart: unless-stopped/);

      const envTemplate = archiveText(entries, ".env.template");
      assert.match(envTemplate, /^APP_PORT=3000$/m);
      assert.match(envTemplate, /^DB_PASSWORD=globipos_CHANGE_ME$/m);
      assert.match(envTemplate, /^SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_HEX$/m);

      const setupScript = archiveText(entries, "setup.sh");
      assertShellSyntax(setupScript);
      assert.match(setupScript, /Install Container Manager from Synology Package Center/);
      assert.match(setupScript, /cp \.env\.template \.env/);
      assert.match(setupScript, /DC="docker compose"/);
      assert.match(setupScript, /\$DC build/);
      assert.match(setupScript, /\$DC up -d/);

      const readme = archiveText(entries, "README-SYNOLOGY.md");
      assert.match(readme, /Synology NAS Deployment Guide/);
      assert.match(readme, /Container Manager UI/);
      assert.match(readme, /docker-compose\.yml/);
      assert.match(readme, /docker compose logs -f app/);
      assert.match(readme, /docker compose build && docker compose up -d/);
      assert.match(readme, /database is NOT re-imported on updates/);
      assert.match(readme, /Control Panel → Login Portal → Advanced → Reverse Proxy/);
    }
  }
  assert.deepEqual(dumpedUrls, Array(3).fill(process.env.DATABASE_URL));
});

test("compiled deployment routes explain when build output is missing", async t => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test.invalid/deployment";
  setDeploymentPackageRouteDependenciesForTests({
    getCompanyName: async () => "Test Company",
    compiledBuildExists: () => false,
    dumpDatabase: async () => {
      throw new Error("pg_dump should not run without a build");
    },
  });
  const { server, baseUrl } = await startTestApp();
  t.after(async () => {
    await closeServer(server);
    setDeploymentPackageRouteDependenciesForTests();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  for (const route of ["compiled-package", "synology-package"]) {
    const response = await fetch(`${baseUrl}/api/backup/${route}`, {
      headers: superuserHeaders(),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "Compiled build not found. Run 'npm run build' first.",
    });
  }
});

test("deployment routes sanitize credential-bearing pg_dump failures", async t => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const credentialBearingUrl = "postgresql://admin:super-secret-password@database.internal:5432/production";
  process.env.DATABASE_URL = credentialBearingUrl;
  setDeploymentPackageRouteDependenciesForTests({
    getCompanyName: async () => "Test Company",
    compiledBuildExists: () => true,
    dumpDatabase: async () => {
      throw new Error(
        `Command failed: pg_dump "${credentialBearingUrl}" --no-password --format=plain`,
      );
    },
  });
  const { server, baseUrl } = await startTestApp();
  t.after(async () => {
    await closeServer(server);
    setDeploymentPackageRouteDependenciesForTests();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  for (const route of ["cpanel-package", "compiled-package", "synology-package"]) {
    const response = await fetch(`${baseUrl}/api/backup/${route}`, {
      headers: superuserHeaders(),
    });
    assert.equal(response.status, 500);
    const responseBody = await response.text();
    assert.deepEqual(JSON.parse(responseBody), {
      message: "Database export failed. Check the database connection and try again.",
    });
    assert.equal(responseBody.includes(credentialBearingUrl), false);
    assert.equal(responseBody.includes("super-secret-password"), false);
    assert.equal(responseBody.includes("--no-password"), false);
  }
});
