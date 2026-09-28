import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

// This test uses distinct, deliberately unreachable databases. It checks that
// every data entry point selects the correct pool without requiring live
// customer databases or touching production data.
process.env.DATABASE_URL = "postgresql://isolation@localhost/legacy_test";
process.env.SESSION_SECRET = "tenant-isolation-test-secret";
process.env.TENANT_DATABASES = JSON.stringify({
  alpha: "postgresql://isolation@localhost/alpha_test",
  beta: "postgresql://isolation@localhost/beta_test",
});
process.env.TENANT_HOSTS = JSON.stringify({
  "alpha.example.test": "alpha",
  "beta.example.test": "beta",
});

const { default: app } = await import("./app");
const { getTenantId, pool, db, runWithTenant, verifyTenantDatabases } = await import("./db");
const { signToken, signTempToken, verifyTempToken, sign2faRecoveryToken, verify2faRecoveryToken } = await import("./auth");
const { itemImageObjectName } = await import("./item-images");
const { registerDeploymentPackageRoutes } = await import("./deployment-package-routes");

const alphaToken = runWithTenant("alpha", () => signToken({
  id: "same-id", username: "owner", email: null, role: "superuser", permissions: [],
}));
const betaToken = runWithTenant("beta", () => signToken({
  id: "same-id", username: "owner", email: null, role: "superuser", permissions: [],
}));

// Register the real package endpoints, not simulated handlers. In shared mode
// none may be reachable, even by a superuser of either customer database.
registerDeploymentPackageRoutes(app);

// Representative direct-ID, export, attachment, and native sync entry points:
// all draw the database from the host-bound request, not a supplied record ID,
// a session claim, or a terminal-provided header.
const records: Record<string, Record<string, string>> = {
  alpha: { "shared-id": "alpha-private", "alpha-only": "alpha-private" },
  beta: { "shared-id": "beta-private", "beta-only": "beta-private" },
};
app.get("/api/tenant-test/records/:id", (req, res) => {
  const record = records[getTenantId()][String(req.params.id)];
  if (!record) return res.status(404).end();
  res.json({ record, database: pool.options.connectionString?.split("/").at(-1) });
});
app.get("/api/tenant-test/export", (_req, res) => {
  res.json({ values: records[getTenantId()], database: pool.options.connectionString?.split("/").at(-1) });
});
app.get("/api/tenant-test/attachment", (_req, res) => {
  res.json({ key: itemImageObjectName("shared-id", "v1", "card") });
});
app.get("/api/pos/sync/catalog", (req, res) => {
  // Same terminal code in both installations must not select the other pool.
  if (req.headers["x-terminal-code"] !== "terminal-one") return res.status(403).end();
  res.json({ database: pool.options.connectionString?.split("/").at(-1) });
});

test("request isolation: roles, direct IDs, exports, attachments and POS sync", async t => {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const request = (host: string, path: string, token?: string, terminalCode?: string) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1", port, path,
        headers: { Host: host, ...(token && { Authorization: `Bearer ${token}` }),
          ...(terminalCode && { "X-Terminal-Code": terminalCode }) },
      }, response => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode })));
      });
      req.on("error", reject);
      req.end();
    });

  const wrongTenant = await request("alpha.example.test", "/api/tenant-test/records/alpha-only", betaToken);
  assert.equal(wrongTenant.status, 401, await wrongTenant.text());
  assert.equal((await request("beta.example.test", "/api/tenant-test/records/alpha-only", alphaToken)).status, 401);
  assert.equal((await request("beta.example.test", "/api/tenant-test/records/alpha-only", betaToken)).status, 404);
  const beta = await request("beta.example.test", "/api/tenant-test/records/shared-id", betaToken);
  assert.deepEqual(await beta.json(), { record: "beta-private", database: "beta_test" });
  const exported = await request("beta.example.test", "/api/tenant-test/export", betaToken);
  assert.deepEqual(await exported.json(), {
    values: records.beta, database: "beta_test",
  });
  const attachment = await request("beta.example.test", "/api/tenant-test/attachment", betaToken);
  assert.deepEqual(await attachment.json(), { key: "tenants/beta/item-images/shared-id/v1/card.webp" });
  assert.equal((await request("unknown.example.test", "/api/pos/sync/catalog", undefined, "terminal-one")).status, 403);
  assert.equal((await request("beta.example.test", "/api/pos/sync/catalog", undefined, "terminal-one")).status, 200);
  assert.deepEqual(await (await request("alpha.example.test", "/api/pos/sync/catalog", undefined, "terminal-one")).json(),
    { database: "alpha_test" });
  assert.equal((await request("beta.example.test", "/api/tenant-test/export", alphaToken)).status, 401);
  for (const packageName of ["cpanel-package", "compiled-package", "synology-package"]) {
    const route = `/api/backup/${packageName}`;
    assert.equal((await request("alpha.example.test", route, betaToken)).status, 401);
    assert.equal((await request("beta.example.test", route, betaToken)).status, 404,
      `${packageName} must not dump the original installation from another tenant`);
    assert.equal((await request("alpha.example.test", route, alphaToken)).status, 404,
      `${packageName} must not offer a process-wide database dump in shared mode`);
  }
});

test("database context refuses unbound calls and remains isolated through concurrent awaits", async () => {
  assert.throws(() => pool.query("SELECT 1"), /Tenant context required/);
  assert.throws(() => db.select(), /Tenant context required/);
  assert.throws(() => runWithTenant("unknown", () => pool), /Unknown tenant/);
  const result = await Promise.all(["alpha", "beta"].map(id => runWithTenant(id, async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    return [getTenantId(), pool.options.connectionString?.split("/").at(-1)];
  })));
  assert.deepEqual(result, [["alpha", "alpha_test"], ["beta", "beta_test"]]);
});

test("2FA challenges cannot cross a tenant even when user IDs match", () => {
  const temp = runWithTenant("alpha", () => signTempToken("same-id", "2fa-login"));
  const recovery = runWithTenant("alpha", () => sign2faRecoveryToken("same-id", "challenge"));
  assert.equal(runWithTenant("beta", () => verifyTempToken(temp, "2fa-login")), null);
  assert.equal(runWithTenant("beta", () => verify2faRecoveryToken(recovery)), null);
});

test("shared merchant credentials block multi-tenant startup before any database is queried", async () => {
  const previous = process.env.WHATSAPP_TOKEN;
  process.env.WHATSAPP_TOKEN = "test-only-placeholder";
  try {
    await assert.rejects(verifyTenantDatabases(), /Shared payment or WhatsApp credentials/);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_TOKEN;
    else process.env.WHATSAPP_TOKEN = previous;
  }
});