import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

export const SCOPES = ["pos", "backoffice", "api", "pda", "native", "eshop",
  "mobile", "lib", "db", "ci", "docs", "deps"];
export function checkPullRequest(pr) {
  const errors = [];
  const title = new RegExp(`^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\\((${SCOPES.join("|")})\\)!?: \\S.*$`);
  if (!title.test(pr.title ?? "")) errors.push(
    `PR title must use Conventional Commits and an allowed scope: ${SCOPES.join(", ")}. Example: chore(ci): add project monitoring`);
  if (pr.user?.login !== "dependabot[bot]" &&
      !/\b(?:closes|fixes|refs)\s+#([1-9]\d*)\b/i.test(pr.body ?? ""))
    errors.push('PR body must link an issue with "Closes #N", "Fixes #N" or "Refs #N".');
  return errors;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const errors = checkPullRequest(event.pull_request ?? {});
  for (const error of errors) console.error(`::error::${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log("PR guard passed.");
}
