// Run the existing loyalty suite with its new actual-storage/PG gap cases.
import { createRequire, isBuiltin } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { build } = require("esbuild");
const output = await mkdtemp(path.join(tmpdir(), "globipos-money-gap-runner-"));
try {
  const outfile = path.join(output, "loyalty.test.cjs");
  await build({
    absWorkingDir: root, entryPoints: ["artifacts/api-server/src/loyalty-policy.test.ts"],
    outfile, bundle: true, platform: "node", format: "cjs", target: "node24",
    plugins: [{
      name: "installed-test-dependencies",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, args => {
          if (isBuiltin(args.path)) return { path: args.path, external: true };
          if (args.path.startsWith("@workspace/")) throw new Error("Unexpected app initialization in gap fixture");
          // Worktrees can share installed dependencies; never redirect app source.
          const candidates = [args.importer, path.join(root, "package.json"),
            ...["artifacts/api-server", "lib/db"].map(p => path.resolve(root, "../..", p, "package.json"))];
          for (const candidate of candidates) {
            try { return { path: createRequire(candidate).resolve(args.path), external: true }; } catch {}
          }
          throw new Error(`Missing locked test dependency ${args.path}`);
        });
      },
    }],
  });
  const result = spawnSync(process.execPath, ["--test", outfile], {
    cwd: root, stdio: "inherit", timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Gap tests terminated: ${result.signal}`);
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
