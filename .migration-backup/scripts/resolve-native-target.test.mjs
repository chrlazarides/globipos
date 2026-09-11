import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const resolver = fileURLToPath(new URL("./resolve-native-target.mjs", import.meta.url));

test("accepts a native target outside the project", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "native-target-test-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const target = path.join(base, "cargo-target");
  const { stdout } = await execFileAsync(process.execPath, [resolver, target, root]);
  assert.equal(stdout, path.resolve(target));
});

for (const relativeTarget of [".", "pos-app/src-tauri/target", "nested/cache"]) {
  test(`rejects an in-project native target: ${relativeTarget}`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "native-target-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = path.resolve(root, relativeTarget);
    await assert.rejects(
      execFileAsync(process.execPath, [resolver, target, root]),
      (error) => error.code === 1 && /inside project workspace/.test(error.stderr),
    );
  });
}