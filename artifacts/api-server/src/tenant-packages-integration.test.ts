import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Pool } from "pg";

test("real tenant databases cannot export each other's packaged backup", async t => {
  if (!process.env.DATABASE_URL) return t.skip("PostgreSQL is required for this integration test");

  const originalUrl = process.env.DATABASE_URL;
  const sourceUrl = new URL(originalUrl);
  const names = ["alpha", "beta"].map(label => `tenant_isolation_${label}_${crypto.randomBytes(5).toString("hex")}`);
  const urls = names.map(name => {
    const url = new URL(sourceUrl);
    url.pathname = `/${name}`;
    return url.toString();
  });
  const admin = new Pool({ connectionString: originalUrl });
  const created: string[] = [];
  let server: ReturnType<typeof createServer> | undefined;
  let tenantPools: Pool[] = [];
  try {
    for (const name of names) {
      // Only these randomly named, test-owned databases are ever removed.
      await admin.query(`CREATE DATABASE "${name}"`);
      created.push(name);
    }
    for (const [i, url] of urls.entries()) {
      const tenantPool = new Pool({ connectionString: url });
      tenantPools.push(tenantPool);
      await tenantPool.query("CREATE TABLE users (id text PRIMARY KEY)");
      await tenantPool.query("CREATE TABLE items (id text PRIMARY KEY)");
      await tenantPool.query("CREATE TABLE item_image_objects (object_name text PRIMARY KEY, bytes bytea NOT NULL)");
      await tenantPool.query("INSERT INTO items (id) VALUES ($1)", [`private-${i}`]);
    }

    // The first disposable database stands in for the existing installation:
    // its image objects still have unprefixed legacy keys.
    process.env.DATABASE_URL = urls[0];
    process.env.TENANT_DATABASES = JSON.stringify({ alpha: "$DATABASE_URL", beta: urls[1] });
    process.env.TENANT_HOSTS = JSON.stringify({ "alpha.example.test": "alpha", "beta.example.test": "beta" });
    process.env.SESSION_SECRET ||= "test-only-tenant-isolation";
    const [{ default: app }, { runWithTenant, pool, verifyTenantDatabases }, { signToken },
      { registerDeploymentPackageRoutes }] = await Promise.all([
      import("./app"), import("./db"), import("./auth"), import("./deployment-package-routes"),
    ]);
    await verifyTenantDatabases();
    assert.deepEqual((await runWithTenant("alpha", () => pool.query("SELECT id FROM items"))).rows,
      [{ id: "private-0" }]);
    assert.deepEqual((await runWithTenant("beta", () => pool.query("SELECT id FROM items"))).rows,
      [{ id: "private-1" }]);

    const { downloadItemImage, deleteItemImageSet } = await import("./item-images");
    const itemId = `legacy-${crypto.randomBytes(8).toString("hex")}`;
    const legacyKey = `item-images/${itemId}/v1/card.webp`;
    const betaKey = `tenants/beta/item-images/${itemId}/v1/card.webp`;
    await tenantPools[0].query("INSERT INTO item_image_objects (object_name, bytes) VALUES ($1, $2)",
      [legacyKey, Buffer.from("alpha-legacy-image")]);
    assert.deepEqual(await runWithTenant("alpha", () => downloadItemImage(itemId, "v1", "card")),
      Buffer.from("alpha-legacy-image"));
    assert.equal(await runWithTenant("beta", () => downloadItemImage(itemId, "v1", "card")), null);
    await tenantPools[1].query("INSERT INTO item_image_objects (object_name, bytes) VALUES ($1, $2)",
      [betaKey, Buffer.from("beta-image")]);
    assert.deepEqual(await runWithTenant("beta", () => downloadItemImage(itemId, "v1", "card")),
      Buffer.from("beta-image"));
    await runWithTenant("beta", () => deleteItemImageSet(itemId, "v1"));
    assert.deepEqual(await runWithTenant("alpha", () => downloadItemImage(itemId, "v1", "card")),
      Buffer.from("alpha-legacy-image"));

    registerDeploymentPackageRoutes(app);
    server = createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    for (const tenantId of ["alpha", "beta"]) {
      const token = runWithTenant(tenantId, () => signToken({
        id: `owner-${tenantId}`, username: "owner", email: null,
        role: "superuser", permissions: [],
      }));
      for (const kind of ["cpanel-package", "compiled-package", "synology-package"]) {
        const status = await new Promise<number>((resolve, reject) => {
          const req = httpRequest({
            hostname: "127.0.0.1", port, path: `/api/backup/${kind}`,
            headers: { Host: `${tenantId}.example.test`, Authorization: `Bearer ${token}` },
          }, response => {
            response.resume();
            response.on("end", () => resolve(response.statusCode ?? 0));
          });
          req.on("error", reject);
          req.end();
        });
        assert.equal(status, 404, `${kind} must not dump the original database for ${tenantId}`);
      }
    }
    for (const tenantId of ["alpha", "beta"]) {
      await runWithTenant(tenantId, () => pool.end());
    }
  } finally {
    process.env.DATABASE_URL = originalUrl;
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await Promise.all(tenantPools.map(p => p.end()));
    for (const name of created.reverse()) {
      await admin.query(`DROP DATABASE "${name}"`);
    }
    await admin.end();
  }
});