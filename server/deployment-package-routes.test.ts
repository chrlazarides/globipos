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

const expectedDate = () => new Date().toISOString().split("T")[0];

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

function superuserHeaders() {
  const token = signToken({
    id: crypto.randomUUID(),
    username: "deployment-route-test",
    email: null,
    role: "superuser",
    permissions: [],
  });
  return { authorization: `Bearer ${token}` };
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

    if (kind === "cpanel") {
      const entries = unzipSync(archive);
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

      const setupScript = strFromU8(entries["setup.sh"]);
      const installCommand = setupScript.match(/^npm install(?<flags>.*)$/m);
      assert.ok(installCommand?.groups);
      assert.match(setupScript, /\nnpm run build\n/);
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
      assert.match(strFromU8(entries["ecosystem.config.js"]), /dist\/index\.cjs/);
      assert.match(strFromU8(entries["README-DEPLOY.md"]), /dist\/index\.cjs/);
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
