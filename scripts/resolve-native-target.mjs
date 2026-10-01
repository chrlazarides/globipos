#!/usr/bin/env node

import path from "node:path";

const [requestedTarget, projectRoot] = process.argv.slice(2);
if (!requestedTarget || !projectRoot) {
  console.error("Usage: node scripts/resolve-native-target.mjs <target-dir> <project-root>");
  process.exit(2);
}

const resolvedTarget = path.resolve(requestedTarget);
const resolvedRoot = path.resolve(projectRoot);
const relative = path.relative(resolvedRoot, resolvedTarget);
if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
  console.error(`Refusing native target inside project workspace: ${resolvedTarget}`);
  process.exit(1);
}

process.stdout.write(resolvedTarget);