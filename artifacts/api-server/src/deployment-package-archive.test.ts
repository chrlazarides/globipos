import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import {
  cpanelDeploymentSourceDirectories,
  cpanelDeploymentSourceFiles,
  createDeploymentPackageArchive,
  requiredDeploymentPackageFiles,
  type DeploymentPackageKind,
} from "./deployment-package-archive";

const packageKinds: DeploymentPackageKind[] = ["cpanel", "compiled", "synology"];

function supportFiles(kind: DeploymentPackageKind) {
  return Object.fromEntries(
    requiredDeploymentPackageFiles[kind]
      .map((name) => [
        name.endsWith("/") ? `${name}fixture.txt` : name,
        `fixture:${name}`,
      ]),
  );
}

test("all deployment package types produce valid archives with required files", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-package-"));
  try {
    fs.mkdirSync(path.join(temp, "assets"));
    fs.writeFileSync(path.join(temp, "index.cjs"), "server");
    fs.writeFileSync(path.join(temp, "assets", "app.js"), "client");
    fs.symlinkSync(path.join(temp, "index.cjs"), path.join(temp, "unsafe-link"));

    for (const kind of packageKinds) {
      const needsDist = kind !== "cpanel";
      const archive = await createDeploymentPackageArchive(
        kind,
        supportFiles(kind),
        needsDist ? [{ source: temp, prefix: "dist" }] : [],
      );
      const archiveBytes = fs.readFileSync(archive.path);
      assert.deepEqual([...archiveBytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

      const entries = unzipSync(archiveBytes);
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
      await archive.cleanup();
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("cPanel archives contain build prerequisites and exclude secrets, local data, and symlinks", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cpanel-package-"));
  try {
    for (const name of cpanelDeploymentSourceFiles) {
      fs.writeFileSync(path.join(temp, name), `fixture:${name}`);
    }
    for (const name of cpanelDeploymentSourceDirectories) {
      fs.mkdirSync(path.join(temp, name));
      fs.writeFileSync(path.join(temp, name, "deployment-source.txt"), name);
    }
    fs.writeFileSync(path.join(temp, ".env"), "SESSION_SECRET=do-not-package");
    fs.writeFileSync(path.join(temp, "local.sqlite"), "local data");
    fs.mkdirSync(path.join(temp, "node_modules"));
    fs.writeFileSync(path.join(temp, "node_modules", "dependency.js"), "local dependency");
    fs.symlinkSync(
      path.join(temp, "package.json"),
      path.join(temp, "server", "unsafe-package-link"),
    );

    const files = {
      ...supportFiles("cpanel"),
      ...Object.fromEntries(
        cpanelDeploymentSourceFiles.map((name) => [
          name,
          { source: path.join(temp, name) },
        ]),
      ),
    };
    const archive = await createDeploymentPackageArchive(
      "cpanel",
      files,
      cpanelDeploymentSourceDirectories.map((name) => ({
        source: path.join(temp, name),
        prefix: name,
      })),
    );
    const entries = unzipSync(fs.readFileSync(archive.path));

    for (const name of cpanelDeploymentSourceFiles) {
      assert.equal(strFromU8(entries[name]), `fixture:${name}`);
    }
    for (const name of cpanelDeploymentSourceDirectories) {
      assert.equal(strFromU8(entries[`${name}/deployment-source.txt`]), name);
    }
    assert.equal(entries[".env"], undefined);
    assert.equal(entries["local.sqlite"], undefined);
    assert.equal(entries["node_modules/dependency.js"], undefined);
    assert.equal(entries["server/unsafe-package-link"], undefined);
    await archive.cleanup();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("package creation fails explicitly when a required file is missing", async () => {
  const files = supportFiles("cpanel");
  delete files["database.sql"];
  await assert.rejects(
    createDeploymentPackageArchive("cpanel", files),
    /missing required entry: database\.sql/,
  );
});

test("large database and dist fixtures are streamed from disk", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-package-large-"));
  try {
    const databasePath = path.join(temp, "database.sql");
    const distPath = path.join(temp, "dist");
    fs.mkdirSync(distPath);
    fs.closeSync(fs.openSync(databasePath, "w"));
    fs.closeSync(fs.openSync(path.join(distPath, "app.cjs"), "w"));
    const fixtureSize = 64 * 1024 * 1024;
    fs.truncateSync(databasePath, fixtureSize);
    fs.truncateSync(path.join(distPath, "app.cjs"), fixtureSize);

    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (file === databasePath || file === path.join(distPath, "app.cjs")) {
        throw new Error("large fixtures must not be read into one buffer");
      }
      return (originalReadFileSync as any)(file, ...args);
    }) as typeof fs.readFileSync;
    let archive;
    try {
      archive = await createDeploymentPackageArchive(
        "compiled",
        {
          ...supportFiles("compiled"),
          "database.sql": { source: databasePath },
        },
        [{ source: distPath, prefix: "dist" }],
      );
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
    const stats = fs.statSync(archive.path);
    assert.ok(stats.size > 0, "streamed ZIP should be written to disk");
    await archive.cleanup();
    assert.equal(fs.existsSync(archive.path), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("archive generation failures clean temporary output", async () => {
  const before = new Set(
    fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("deployment-package-")),
  );
  await assert.rejects(
    createDeploymentPackageArchive("cpanel", {
      ...supportFiles("cpanel"),
      "database.sql": { source: path.join(os.tmpdir(), "missing-deployment-database.sql") },
    }),
    /ENOENT/,
  );
  const after = fs.readdirSync(os.tmpdir()).filter(
    (name) => name.startsWith("deployment-package-") && !before.has(name),
  );
  assert.deepEqual(after, []);
});