import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import {
  createDeploymentPackageArchive,
  requiredDeploymentPackageFiles,
  type DeploymentPackageKind,
} from "./deployment-package-archive";

const packageKinds: DeploymentPackageKind[] = ["cpanel", "compiled", "synology"];

function supportFiles(kind: DeploymentPackageKind) {
  return Object.fromEntries(
    requiredDeploymentPackageFiles[kind]
      .filter((name) => !name.endsWith("/"))
      .map((name) => [name, `fixture:${name}`]),
  );
}

test("all deployment package types produce valid archives with required files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-package-"));
  try {
    fs.mkdirSync(path.join(temp, "assets"));
    fs.writeFileSync(path.join(temp, "index.cjs"), "server");
    fs.writeFileSync(path.join(temp, "assets", "app.js"), "client");
    fs.symlinkSync(path.join(temp, "index.cjs"), path.join(temp, "unsafe-link"));

    for (const kind of packageKinds) {
      const needsDist = kind !== "cpanel";
      const archive = createDeploymentPackageArchive(
        kind,
        supportFiles(kind),
        needsDist ? [{ source: temp, prefix: "dist" }] : [],
      );
      assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

      const entries = unzipSync(archive);
      for (const required of requiredDeploymentPackageFiles[kind]) {
        if (required.endsWith("/")) {
          assert.ok(Object.keys(entries).some((name) => name.startsWith(required)));
        } else {
          assert.equal(strFromU8(entries[required]), `fixture:${required}`);
        }
      }
      if (needsDist) {
        assert.equal(strFromU8(entries["dist/index.cjs"]), "server");
        assert.equal(strFromU8(entries["dist/assets/app.js"]), "client");
        assert.equal(entries["dist/unsafe-link"], undefined);
      }
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("package creation fails explicitly when a required file is missing", () => {
  const files = supportFiles("cpanel");
  delete files["database.sql"];
  assert.throws(
    () => createDeploymentPackageArchive("cpanel", files),
    /missing required entry: database\.sql/,
  );
});