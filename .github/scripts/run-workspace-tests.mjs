// CI/test infrastructure only. Existing tests and application sources are not edited.
import { createRequire, isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = process.argv[2];
if (!["api", "backoffice"].includes(target)) throw new Error("Expected api or backoffice");
const artifact = path.join(root, "artifacts", target === "api" ? "api-server" : "globipos");
// Reuse the API's already locked esbuild; do not add a dependency or use npx.
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { build } = require("esbuild");
const output = await fs.mkdtemp(path.join(os.tmpdir(), `globipos-${target}-ci-`));
const sources = path.join(artifact, "src");
const bundles = path.join(output, "src");
// No live DATABASE_URL, cloud/email/API credentials or GitHub token is inherited.
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8",
  NODE_ENV: "test", TZ: "UTC",
  SESSION_SECRET: "isolated-ci-session-not-an-installation-credential",
  DOTENV_CONFIG_PATH: path.join(output, "empty.env"),
};
function command(binary, args, cwd = artifact, extra = {}) {
  const result = spawnSync(binary, args, {
    cwd, env: { ...env, ...extra }, encoding: "utf8",
    timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`${path.basename(binary)} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
async function discover(directory, prefix = "") {
  return (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(entry =>
    entry.isDirectory() ? discover(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : /\.test\.(ts|tsx|mjs)$/.test(entry.name) ? [`${prefix}${entry.name}`] : []))).flat().sort();
}
let postgres, cluster, socket, started = false;
const pg = (name, args) => command(path.join(postgres, name), args);
const sql = (database, text) => pg("psql", [
  "-h", socket, "-p", "5432", "-U", "ci_test", "-d", database,
  "-v", "ON_ERROR_STOP=1", "-c", text,
]);
const databaseUrl = database =>
  `postgresql://ci_test@localhost/${database}?host=${encodeURIComponent(socket)}&port=5432`;
try {
  // Prevent dotenv/config from restoring installation credentials from a file.
  await fs.writeFile(env.DOTENV_CONFIG_PATH, "");
  const tests = (await discover(sources)).map(name => ({ name, source: path.join(sources, name), relative: `src/${name}` }));
  const extraTests = path.join(artifact, "tests");
  try {
    for (const name of await discover(extraTests))
      tests.push({ name: `tests/${name}`, source: path.join(extraTests, name), relative: `tests/${name}` });
    await fs.cp(extraTests, path.join(output, "tests"), { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!tests.length) throw new Error("No tests discovered; refusing an empty pass");
  console.log(`Running all ${tests.length} ${target} test files; no selection/skip list.`);
  // Preserve raw source reads beside relocated test entries.
  await fs.cp(sources, bundles, { recursive: true });
  if (target === "api") {
    await fs.copyFile(path.join(sources, "routes/routes.ts"), path.join(bundles, "routes.ts"));
    await fs.cp(path.join(root, ".migration-backup/migrations"), path.join(output, "migrations"), { recursive: true });
    const detected = process.env.SERVER_TEST_POSTGRES_BIN;
    postgres = detected || command("pg_config", ["--bindir"]).trim();
    if (!postgres) throw new Error("PostgreSQL test binaries are not available");
    cluster = await fs.mkdtemp(path.join(os.tmpdir(), "globipos-ci-postgres-"));
    socket = path.join(cluster, "socket");
    await fs.mkdir(socket);
    pg("initdb", ["-D", path.join(cluster, "data"), "-A", "trust", "-U", "ci_test", "--no-locale", "--encoding=UTF8"]);
    // Private Unix socket only; cannot connect to an installation's TCP server.
    pg("pg_ctl", ["-D", path.join(cluster, "data"), "-l", path.join(cluster, "postgres.log"),
      "-o", `-F -k ${socket} -p 5432 -c listen_addresses=''`, "-w", "start"]);
    started = true;
    const ddl = path.join(output, "schema");
    const drizzle = path.join(path.dirname(require.resolve("drizzle-kit", {
      paths: [path.join(root, "lib/db")],
    })), "bin.cjs");
    // Generate schema DDL into the temporary directory; never use drizzle push.
    command(process.execPath, [drizzle, "generate", "--dialect=postgresql",
      `--schema=${path.join(root, "lib/db/src/schema/index.ts")}`, `--out=${ddl}`],
    path.join(root, "lib/db"));
    const migrations = (await fs.readdir(ddl)).filter(name => name.endsWith(".sql")).sort();
    if (!migrations.length) throw new Error("No disposable test schema was generated");
    sql("postgres", "CREATE DATABASE ci_fixture");
    for (const migration of migrations)
      sql("ci_fixture", await fs.readFile(path.join(ddl, migration), "utf8"));
    // Existing auxiliary structures omitted from declarations, in this fixture only.
    for (const migration of ["0010_deployment_domain_notification_delivery.sql", "0021_deployment_eshop_domain.sql"])
      sql("ci_fixture", await fs.readFile(path.join(root, ".migration-backup/migrations", migration), "utf8"));
    sql("ci_fixture", `INSERT INTO eshop_config(id,config) VALUES(1,'{"enabled":false}') ON CONFLICT DO NOTHING`);
    // Synthetic installation accounts required by the real invoice posting tests.
    sql("ci_fixture", `INSERT INTO accounts(code,name,type) VALUES
      ('1000','CI cash','asset'),('1010','CI bank','asset'),
      ('1100','CI receivables','asset'),('1200','CI inventory','asset'),
      ('2100','CI VAT payable','liability'),('4000','CI sales','revenue'),
      ('5000','CI cost of sales','expense')`);
  }
  await build({
    entryPoints: tests.map(test => test.source),
    outbase: artifact, outdir: output, outExtension: { ".js": ".mjs" },
    bundle: true, platform: "node", format: "esm", jsx: "automatic",
    loader: { ".ttf": "file", ".woff": "file", ".woff2": "file", ".svg": "file", ".png": "file" },
    alias: {
      "@": sources,
      "@shared": path.join(root, "artifacts/globipos/src/legacy-shared"),
      "@shared/schema": target === "api" ? path.join(root, "lib/db/src/schema/index.ts")
        : path.join(sources, "legacy-shared/schema.ts"),
      "@shared/erp-provider-binding": path.join(root, "artifacts/api-server/src/erp-provider-binding.ts"),
      "@workspace/db": path.join(root, "lib/db/src/index.ts"),
      "@workspace/api-zod": path.join(root, "lib/api-zod/src/index.ts"),
      "@workspace/api-client-react": path.join(root, "lib/api-client-react/src/index.ts"),
    },
    banner: { js: `import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);` },
    plugins: [{
      name: "preserve-package-resolution",
      setup(builder) {
        builder.onResolve({ filter: /(?:^|\/)shared\/(?:schema|catalog-import-report)$/ }, args => ({
          path: args.path.endsWith("/catalog-import-report")
            ? path.join(root, "artifacts/globipos/src/legacy-shared/catalog-import-report.ts")
            : target === "api" ? path.join(root, "lib/db/src/schema/index.ts")
              : path.join(sources, "legacy-shared/schema.ts"),
        }));
        builder.onResolve({ filter: /^[^./]/ }, async args => {
          if (args.pluginData?.ciExternal || isBuiltin(args.path) ||
              args.path.startsWith("@workspace/") || args.path.startsWith("@shared/") || args.path.startsWith("@/")) return;
          const resolved = await builder.resolve(args.path, {
            resolveDir: args.resolveDir, kind: args.kind, pluginData: { ciExternal: true },
          });
          if (resolved.errors.length) return { errors: resolved.errors };
          return { path: resolved.path, external: true };
        });
      },
    }],
    logLevel: "warning",
  });
  let failed = 0;
  const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const [index, test] of tests.entries()) {
    const database = `ci_test_${index}`;
    if (target === "api") sql("postgres", `CREATE DATABASE ${database} TEMPLATE ci_fixture`);
    console.log(`\n=== ${test.name} ===`);
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap",
      path.join(output, test.relative.replace(/\.(tsx?|mjs)$/, ".mjs"))], {
      cwd: artifact, env: { ...env, ...(target === "api" ? { DATABASE_URL: databaseUrl(database) } : {}) },
      encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const counts = Object.fromEntries([...(result.stdout ?? "").matchAll(
      /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    for (const key of Object.keys(totals)) totals[key] += counts[key] ?? 0;
    if (result.status !== 0 || !counts.tests || counts.fail || counts.skipped || counts.todo || counts.cancelled) {
      failed++;
      console.error(result.error?.message ?? "This file did not produce a complete, unskipped passing TAP result.");
    }
    if (target === "api") sql("postgres", `DROP DATABASE ${database} WITH (FORCE)`);
  }
  console.log(`${target}: ${tests.length} files, ${failed} failing files. ${JSON.stringify(totals)}`);
  process.exitCode = failed ? 1 : 0;
} finally {
  try {
    if (started) pg("pg_ctl", ["-D", path.join(cluster, "data"), "-m", "immediate", "-w", "stop"]);
  } finally {
    if (cluster) await fs.rm(cluster, { recursive: true, force: true });
    await fs.rm(output, { recursive: true, force: true });
  }
}
