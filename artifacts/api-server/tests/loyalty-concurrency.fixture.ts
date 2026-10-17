// Test-only PostgreSQL fixture. Never reads DATABASE_URL or imports app startup.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { customers, customerLoyaltyPoints, customerCashbackLedger } from "../../../lib/db/src/schema/schema";
import { validateRedemption, type LoyaltyPolicyValues } from "../src/loyalty-policy";

type Redemption = { pointsRedeemed: number; discountEuros: number; newBalance: number; replayed: boolean };
type PointsFixture = {
  pool: Pool;
  redeem: (customer: string, points: number, key: string, policy: LoyaltyPolicyValues) => Promise<Redemption>;
  seed: (customer: string, points: number) => Promise<void>;
  state: (customer: string) => Promise<unknown[]>;
};

export async function withPointsDatabase(run: (fixture: PointsFixture) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "globipos-points-gap-"));
  const configured = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  const installed = spawnSync("which", ["initdb"], { encoding: "utf8" });
  const bin = configured.status === 0 ? configured.stdout.trim() : path.dirname(installed.stdout?.trim() || "");
  assert.ok(existsSync(path.join(bin, "initdb")) && existsSync(path.join(bin, "pg_ctl")),
    "PostgreSQL fixture tools required; this is not a passing/skip result");
  const command = (name: string, args: string[]) => {
    const result = spawnSync(path.join(bin, name), args, { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout || result.error}`);
  };
  let started = false;
  let pool: Pool | undefined;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network forbidden in shared-points fixture"); };
  try {
    command("initdb", ["-D", path.join(directory, "data"), "-U", "points_fixture", "-A", "trust", "--no-locale"]);
    command("pg_ctl", ["-D", path.join(directory, "data"), "-l", path.join(directory, "postgres.log"),
      "-o", `-F -k ${directory} -p 55491 -c listen_addresses='' -c statement_timeout=5000`, "-w", "start"]);
    started = true;
    pool = new Pool({ host: directory, port: 55491, user: "points_fixture", database: "postgres", max: 4 });
    // Minimal private fixture tables, not migrations or application schema edits.
    // Fixed timestamps and sequence IDs make assertions deterministic.
    await pool.query(`
      CREATE SEQUENCE fixture_ids;
      CREATE TABLE customers(id varchar PRIMARY KEY, cashback_balance numeric(12,2) DEFAULT 0);
      CREATE TABLE customer_loyalty_points(
        id varchar PRIMARY KEY DEFAULT ('fixture-' || nextval('fixture_ids')), customer_id varchar NOT NULL,
        points integer NOT NULL, type text NOT NULL DEFAULT 'earn', reason text, source_type text, source_id varchar,
        created_at timestamp NOT NULL DEFAULT '2026-10-17 09:00:00');
      CREATE UNIQUE INDEX points_source ON customer_loyalty_points(source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
      CREATE TABLE customer_cashback_ledger(
        id varchar PRIMARY KEY DEFAULT ('fixture-' || nextval('fixture_ids')), customer_id varchar NOT NULL REFERENCES customers(id),
        amount numeric(12,2) NOT NULL, type text NOT NULL, reason text, source_type text, source_id varchar,
        created_at timestamp NOT NULL DEFAULT '2026-10-17 09:00:00');
      CREATE UNIQUE INDEX cashback_source ON customer_cashback_ledger(source_type, source_id)
        WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
    `);
    let root = process.cwd();
    while (!existsSync(path.join(root, "pnpm-workspace.yaml"))) {
      const parent = path.dirname(root);
      assert.notEqual(parent, root, "Run from this checkout");
      root = parent;
    }
    const filename = path.join(root, "artifacts/api-server/src/storage.ts");
    const file = ts.createSourceFile(filename, await readFile(filename, "utf8"), ts.ScriptTarget.Latest, true);
    const matches: ts.MethodDeclaration[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isMethodDeclaration(node) && node.name.getText(file) === "redeemCustomerPointsAtomic") matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.equal(matches.length, 1, "Must execute exactly the original storage method");
    // Extract the actual method, including its SQL and transaction/row lock.
    // No redemption or locking algorithm is reproduced in this fixture.
    const expression = `(${matches[0].getText(file).replace(/^async /, "async function ")})`;
    const compiled = ts.transpileModule(expression, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length, 0);
    const original = new Function("db", "customers", "customerLoyaltyPoints", "customerCashbackLedger",
      "and", "eq", "sql", "validateRedemption", `return ${compiled.outputText}`)(
      drizzle(pool), customers, customerLoyaltyPoints, customerCashbackLedger, and, eq, sql, validateRedemption,
    ) as PointsFixture["redeem"];
    const connection = pool;
    await run({
      pool: connection, redeem: original,
      async seed(customer, points) {
        await connection.query("INSERT INTO customers(id) VALUES ($1)", [customer]);
        await connection.query("INSERT INTO customer_loyalty_points(customer_id,points,type) VALUES ($1,$2,'earn')", [customer, points]);
      },
      async state(customer) {
        return (await connection.query(`SELECT
          (SELECT cashback_balance FROM customers WHERE id=$1) AS wallet,
          (SELECT coalesce(sum(points),0)::int FROM customer_loyalty_points WHERE customer_id=$1) AS points,
          (SELECT count(*)::int FROM customer_loyalty_points WHERE customer_id=$1 AND type='redeem') AS debits,
          (SELECT count(*)::int FROM customer_cashback_ledger WHERE customer_id=$1) AS credits`, [customer])).rows;
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    await pool?.end();
    if (started) command("pg_ctl", ["-D", path.join(directory, "data"), "-m", "immediate", "-w", "stop"]);
    await rm(directory, { recursive: true, force: true });
  }
}
