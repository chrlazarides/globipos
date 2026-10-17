import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
// esbuild is already a locked API-server devDependency; no new dependency.
const { build } = createRequire(path.join(root, "artifacts/api-server/package.json"))("esbuild");
const output = await mkdtemp(path.join(tmpdir(), "globipos-money-"));
const edge = path.join(root, "tests/money-paths/sync-edge.mjs");
const utils = path.join(root, "artifacts/globipos-terminal/src/lib/utils.ts");
const plugins = [{
  name: "money-test-isolation",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "money" }));
    b.onResolve({ filter: /^@tauri-apps\// }, () => ({ path: "native", namespace: "money" }));
    b.onResolve({ filter: /^\.\/db$/ }, args => {
      if (args.importer.endsWith("/pos-stock-in-service.ts")) return { path: "pool", namespace: "money" };
      if (args.importer.endsWith("/sync.ts")) return { path: "storage", namespace: "money" };
    });
    b.onResolve({ filter: /^\.\/(sync-state|utils)$/ }, args => {
      if (args.importer.endsWith("/sync.ts")) return {
        path: args.path === "./utils" ? "transport" : "storage", namespace: "money",
      };
    });
    b.onLoad({ filter: /.*/, namespace: "money" }, args => {
      const contents = {
        react: `export const useState=v=>[Array.isArray(v)?globalThis.__moneyPromotions:typeof v==="function"?v():v,()=>{}];
          export const useCallback=f=>f; export const useMemo=f=>f(); export const useEffect=()=>{};`,
        native: `export const invoke=()=>{throw new Error("Real native I/O forbidden in money tests")};`,
        pool: `export const pool={connect(){throw new Error("Real database forbidden; supply the fixture pool")}};`,
        storage: `export * from ${JSON.stringify(edge)};`,
        transport: `export {HttpError,normalizeServerUrl} from ${JSON.stringify(utils)};
          export {fetchOnce,fetchWithRetry} from ${JSON.stringify(edge)};`,
      }[args.path];
      if (!contents) throw new Error(`Unknown test edge: ${args.path}`);
      return { contents, loader: "js", resolveDir: root };
    });
    // Expose existing private pure functions in the temporary bundle only.
    // This never edits the hook or duplicates its promotion rules.
    b.onLoad({ filter: /\/hooks\/useMultiBuy\.ts$/ }, async args => ({
      loader: "ts",
      contents: await readFile(args.path, "utf8") +
        "\nexport { evalBuyNGetM, evalQtyThreshold, evalMixMatch, evalMealDeal };\n",
      resolveDir: path.dirname(args.path),
    }));
  },
}];

try {
  const bundles = {};
  for (const [name, entry] of Object.entries({
    production: "tests/money-paths/production.ts",
    sync: "artifacts/globipos-terminal/src/lib/sync.ts",
  })) {
    const outfile = path.join(output, `${name}.mjs`);
    const result = await build({
      absWorkingDir: root, entryPoints: [entry], outfile,
      bundle: true, platform: "node", format: "esm", target: "node24",
      plugins, metafile: true, logLevel: "warning",
    });
    // Prevent an isolated-worktree run from quietly testing another checkout.
    for (const input of Object.keys(result.metafile.inputs)) {
      if (input.startsWith("money:") || input.includes("node_modules")) continue;
      const absolute = path.resolve(root, input);
      if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`Wrong-checkout source: ${input}`);
    }
    bundles[name] = pathToFileURL(outfile).href;
  }
  const directory = path.join(root, "tests/money-paths");
  const tests = (await readdir(directory)).filter(f => f.endsWith(".test.mjs")).sort();
  if (!tests.length) throw new Error("Money-path test discovery returned no tests");
  const result = spawnSync(process.execPath, [
    "--test", "--test-concurrency=1", ...tests.map(f => path.join(directory, f)),
  ], {
    cwd: root, stdio: "inherit",
    env: { ...process.env, MONEY_PRODUCTION_MODULE: bundles.production, MONEY_SYNC_MODULE: bundles.sync },
    timeout: 90_000,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Money tests terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
