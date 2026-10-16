// Applicability metadata only; this is not a passing test result.
import fs from "node:fs";
import path from "node:path";

const configurations = {
  "pda-scanner": {
    anchors: ["artifacts/globipos/src/components/pda", "artifacts/globipos/src/pages/pda-workspace.tsx"],
    required: ["artifacts/globipos/tests/pda-workspace.browser.test.mjs"],
    scripts: ["test:pda-scanner:chromium", "test:pda-scanner:webkit"],
  },
  "retail-icons": {
    anchors: ["pos-app/src/retail"],
    required: [
      "pos-app/tests/multi-device/retail-icons.browser.mjs",
      "pos-app/tests/multi-device/retail-icons.fixture.tsx",
      "pos-app/src/retail/RetailZones.tsx",
      "pos-app/src/retail/retail-zones.css",
      "pos-app/src/assets/fonts/MaterialSymbolsRounded-Retail.ttf",
    ],
    scripts: ["test:retail-icons"],
  },
  "native-printer": {
    anchors: ["pos-app/src/simulation"],
    required: [
      "pos-app/src/simulation/samples.ts",
      ".github/actions/check-pos-package-branding/action.yml",
      "scripts/pos-package-branding.py",
    ],
    scripts: [],
  },
};
const name = process.argv[2];
const configuration = configurations[name];
if (!configuration || !process.env.GITHUB_OUTPUT) throw new Error("Invalid suite or missing GitHub output");
const result = (ready, reason) => {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${ready}\n`);
  console.log(ready ? reason : `::notice::NOT VERIFIED — ${reason}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### ${name}\n${ready ? "Applicable; test execution is required next." : "**NOT VERIFIED; test job skipped.**"} ${reason}\n`);
};
if (name === "native-printer" && process.env.REPOSITORY_PRIVATE !== "true") {
  result(false, "The existing native-printer workflow is private-repository-only; its access guard is preserved.");
} else if (!configuration.anchors.some(anchor => fs.existsSync(anchor))) {
  result(false, "This feature's application source is absent on this checkout. No application code is imported and no test pass is claimed.");
} else {
  const missing = configuration.required.filter(filename => !fs.existsSync(filename));
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const script of configuration.scripts)
    if (!manifest.scripts?.[script]) missing.push(`root package script ${script}`);
  if (name !== "native-printer" &&
      !manifest.devDependencies?.playwright && !manifest.dependencies?.playwright)
    missing.push("declared root playwright dependency");
  // Catch missing relative test helpers recursively, without importing or running tests.
  const visited = new Set();
  function checkImports(filename) {
    if (visited.has(filename) || !fs.existsSync(filename) || !/\.[cm]?[jt]sx?$/.test(filename)) return;
    visited.add(filename);
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*["'])(?:["']?)(\.[^"']+)["']/g)) {
      const dependency = path.resolve(path.dirname(filename), match[1]);
      const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
      const resolved = [dependency, ...extensions.map(extension => dependency + extension),
        ...extensions.map(extension => path.join(dependency, "index" + extension))]
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (!resolved) missing.push(path.relative(process.cwd(), dependency));
      else checkImports(resolved);
    }
  }
  for (const filename of configuration.required) checkImports(path.resolve(filename));
  if (missing.length) {
    console.error(`Feature source exists but ${name} inputs are incomplete:\n${[...new Set(missing)].join("\n")}`);
    // A partially installed feature is a failure, not a skipped/passing suite.
    process.exitCode = 1;
  } else result(true, "Application and declared test entry points exist. Assertions and test commands are unchanged.");
}
