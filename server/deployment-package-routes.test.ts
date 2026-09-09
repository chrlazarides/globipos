import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { requireAuth, signToken } from "./auth";
import {
  registerRoutes,
  setDeploymentPackageRouteDependenciesForTests,
} from "./routes";

const expectedDate = () => new Date().toISOString().split("T")[0];

async function startTestApp(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(requireAuth);
  const server = createServer(app);
  await registerRoutes(server, app, { skipBackgroundJobs: true });
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

test("superusers can download all deployment package types with usable ZIP headers", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-route-"));
  fs.mkdirSync(path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "dist", "index.cjs"), "compiled server");
  const dumpedUrls: string[] = [];
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test.invalid/deployment";
  setDeploymentPackageRouteDependenciesForTests({
    getCompanyName: async () => "Route Test & Co",
    workingDirectory: () => root,
    compiledBuildExists: () => true,
    dumpDatabase: databaseUrl => {
      dumpedUrls.push(databaseUrl);
      return Buffer.from("-- controlled pg_dump output");
    },
  });
  const { server, baseUrl } = await startTestApp();
  t.after(async () => {
    await closeServer(server);
    setDeploymentPackageRouteDependenciesForTests();
    fs.rmSync(root, { recursive: true, force: true });
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
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="route-test-co-${kind}-${expectedDate()}.zip"`,
    );
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)],
      [0x50, 0x4b, 0x03, 0x04],
    );
  }
  assert.deepEqual(dumpedUrls, Array(3).fill(process.env.DATABASE_URL));
});

test("compiled deployment routes explain when build output is missing", async t => {
  process.env.DATABASE_URL ||= "postgresql://test.invalid/deployment";
  setDeploymentPackageRouteDependenciesForTests({
    getCompanyName: async () => "Test Company",
    compiledBuildExists: () => false,
    dumpDatabase: () => {
      throw new Error("pg_dump should not run without a build");
    },
  });
  const { server, baseUrl } = await startTestApp();
  t.after(async () => {
    await closeServer(server);
    setDeploymentPackageRouteDependenciesForTests();
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
    dumpDatabase: () => {
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