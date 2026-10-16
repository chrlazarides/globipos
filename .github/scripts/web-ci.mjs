// CI orchestration only. Never starts an app, native compiler or schema push.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });
const roots = ["artifacts/globipos", "artifacts/api-server"];
const directories = [...roots, ...fs.readdirSync("lib", { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => `lib/${entry.name}`)];
// Includes nested shared integration packages if this checkout has any.
if (fs.existsSync("lib/integrations"))
  directories.push(...fs.readdirSync("lib/integrations", { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => `lib/integrations/${entry.name}`));
const packages = new Map();
for (const dir of directories) {
  const filename = path.join(dir, "package.json");
  if (!fs.existsSync(filename)) continue;
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  packages.set(manifest.name, { dir, ...manifest });
}
const base = process.env.DIFF_BASE;
const head = process.env.DIFF_HEAD;
if (!/^[a-f0-9]{40}$/.test(head ?? "")) throw new Error("Missing valid CI head commit");
const firstPush = !base || /^0+$/.test(base);
if (!firstPush && !/^[a-f0-9]{40}$/.test(base)) throw new Error("Invalid CI base commit");
const changed = firstPush ? [] : execFileSync("git",
  ["diff", "--name-only", "--no-renames", "-z", base, head], { encoding: "utf8" }).split("\0").filter(Boolean);
const globalChange = firstPush || changed.some(file =>
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|tsconfig[^/]*\.json)$/.test(file) ||
  file === ".github/workflows/ci-web-api.yml" || file === ".github/scripts/web-ci.mjs" ||
  file === ".github/scripts/web-ci-scope.mjs" ||
  file === ".github/scripts/run-workspace-tests.mjs");
const dependencies = pkg => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
  .filter(name => packages.has(name));
const affected = new Set([...packages].filter(([, pkg]) =>
  globalChange || changed.some(file => file.startsWith(`${pkg.dir}/`))).map(([name]) => name));
// Follow shared-library changes to their consumers, never to unrelated apps.
let previous;
do {
  previous = affected.size;
  for (const [name, pkg] of packages)
    if (dependencies(pkg).some(dep => affected.has(dep))) affected.add(name);
} while (previous !== affected.size);
const checked = new Set(affected);
function addDependencies(name) {
  for (const dependency of dependencies(packages.get(name))) {
    if (checked.has(dependency)) continue;
    checked.add(dependency);
    addDependencies(dependency);
  }
}
for (const name of affected) addDependencies(name);
console.log("Affected packages:", [...affected].join(", ") || "(none)");
console.log("Required dependency packages:", [...checked].filter(name => !affected.has(name)).join(", ") || "(none)");
const libraryProjects = [...checked].map(name => packages.get(name))
  .filter(pkg => pkg.dir.startsWith("lib/") && fs.existsSync(`${pkg.dir}/tsconfig.json`))
  .map(pkg => `${pkg.dir}/tsconfig.json`);
if (libraryProjects.length) run("pnpm", ["exec", "tsc", "--build", ...libraryProjects]);
for (const name of checked) {
  const pkg = packages.get(name);
  if (roots.includes(pkg.dir)) run("pnpm", ["--filter", name, "run", "typecheck"]);
}
for (const name of affected) {
  const pkg = packages.get(name);
  const scripts = pkg.scripts ?? {};
  if (scripts.lint) run("pnpm", ["--filter", name, "run", "lint"]);
  else console.log(`${name}: no lint script; not verified by lint`);
  const tests = Object.keys(scripts).filter(script =>
    /^test(?::(?:unit|api|server|agoranomia|cashier-pin))?$/.test(script));
  if (!tests.length) console.log(`${name}: no unit/API test script; not verified by unit/API tests`);
  for (const script of tests) run("pnpm", ["--filter", name, "run", script]);
  if (scripts.build) run("pnpm", ["--filter", name, "run", "build"]);
}
