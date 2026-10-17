import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {appsFor, protectedRules, matchesOwnerPath, linkedIssues, scheduleAllowed,
  quality, releaseSummary, buildReport, collectAttempts} from "../project-monitoring.mjs";
import {healthTarget} from "../weekly-project-report.mjs";
import {checkPullRequest, SCOPES} from "../pr-guard.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/project-monitoring.json", import.meta.url), "utf8"));

test("all requested apps classify by paths; unknown/empty changes are docs/infra", () => {
  assert.deepEqual(appsFor(["artifacts/globipos/src/a", "artifacts/api-server/src/a", "lib/a"]),
    ["Back office", "API", "Shared lib"]);
  assert.deepEqual(appsFor(["pos-app/src/a", "artifacts/globipos-terminal/src/a", "pda-app/a",
    "artifacts/globipos-mobile/a", "customer-app/a", "docs/a"]),
  ["POS native", "POS terminal", "PDA", "Mobile/customer app", "Docs/infra"]);
  assert.deepEqual(appsFor([]), ["Docs/infra"]);
});
test("CODEOWNERS catch-all is not a special protected-area rule; root/glob/directory rules match", () => {
  assert.deepEqual(protectedRules("# header\n* @owner\n/lib/db/ @owner\n**/*payment* @owner\n"),
    ["/lib/db/", "**/*payment*"]);
  for (const [file, rule] of [["lib/db/src/schema/a.ts", "/lib/db/"],
    ["lib/foo/migrations/a.sql", "**/migrations/"], ["src/payment.ts", "**/*payment*"],
    [".github/workflows/a.yml", "/.github/"]]) assert.equal(matchesOwnerPath(file, rule), true);
  assert.equal(matchesOwnerPath("other/lib/db/a.ts", "/lib/db/"), false);
  assert.equal(matchesOwnerPath("lib/db-copy/a.ts", "/lib/db/"), false);
});
test("linked issue extraction covers local, cross-repo and full issue URLs without titles", () => {
  assert.deepEqual(linkedIssues("Closes #7, #8\nRefs example/other#2\nFixes https://github.com/a/b/issues/9", "a/b"),
    ["https://github.com/a/b/issues/7", "https://github.com/a/b/issues/8",
      "https://github.com/example/other/issues/2", "https://github.com/a/b/issues/9"]);
  assert.deepEqual(linkedIssues("No issue", "a/b"), []);
});
test("Friday schedule selects 07:00 Cyprus across DST, including delayed starts", () => {
  assert.equal(scheduleAllowed("schedule", "0 4 * * 5", "2026-10-23T06:00:00Z"), true);
  assert.equal(scheduleAllowed("schedule", "0 5 * * 5", "2026-10-23T05:00:00Z"), false);
  assert.equal(scheduleAllowed("schedule", "0 5 * * 5", "2026-10-30T05:00:00Z"), true);
  assert.equal(scheduleAllowed("schedule", "0 4 * * 5", "2026-10-30T04:00:00Z"), false);
  assert.equal(scheduleAllowed("workflow_dispatch", undefined, fixture.now), true);
});
test("quality counts runs separately from attempts and retains failed-main reruns", () => {
  const [first, empty] = quality(fixture.workflows, fixture.attempts);
  assert.equal(first.runs, 1);
  assert.equal(first.attempts.length, 2);
  assert.equal(first.reruns, 1);
  assert.equal(first.passRate, 0.5);
  assert.equal(first.redMain.length, 1);
  assert.equal(empty.passRate, null);
  assert.equal(quality([], [{...fixture.attempts[0], conclusion: "cancelled"}])[0].passRate, null);
});
test("old original runs rerun this week are included without any network", async () => {
  const run = {id: 102, workflow_id: 1, name: "Web CI", head_branch: "main", event: "push",
    html_url: "https://github.com/example/project/actions/runs/102", run_attempt: 2,
    created_at: "2026-09-01T10:00:00Z", updated_at: "2026-10-15T10:00:00Z",
    run_started_at: "2026-10-15T09:00:00Z", conclusion: "success"};
  let loads = 0;
  const attempts = await collectAttempts([run], async (_run, number) => {
    loads++;
    assert.equal(number, 1);
    return {...run, run_started_at: run.created_at, conclusion: "failure"};
  }, fixture.since, fixture.now);
  assert.equal(loads, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attempt, 2);
});
test("release counts use ancestry, recognise legacy native tags and flag old unreleased PRs", () => {
  const releases = releaseSummary(fixture.merged, fixture.tags, fixture.comparisons, fixture.now);
  const native = releases.find(r => r.name === "POS native");
  assert.equal(native.tag, "v1.0.19");
  assert.deepEqual(native.unreleased.map(p => p.number), [1, 4, 5]);
  assert.ok(native.oldestDays > 14);
  assert.equal(releases.find(r => r.name === "Back office").tag, null);
  assert.equal(releaseSummary(fixture.merged, fixture.tags, {}, fixture.now)
    .find(r => r.name === "POS native").verified, false);
});
test("report includes all sections, warnings and unavailable security without private payloads", () => {
  const report = buildReport(fixture);
  for (const expected of ["Changes merged", "Protected areas", "Work in flight", "Quality",
    "Releases", "Security", "HEALTH_URLS is unset", "merged without a linked issue",
    "older than 7 days", "red run on main", "below 90%", "merged-but-unreleased",
    "Dependabot: not available", "50.0%"]) assert.ok(report.includes(expected), expected);
  for (const privateValue of ["PRIVATE-TITLE-SENTINEL", "PRIVATE-BODY-SENTINEL", "PRIVATE-SECRET-SENTINEL"])
    assert.equal(report.includes(privateValue), false);
  assert.ok(report.includes("https://github.com/example/project/issues/7"));
});
test("health targets never carry credentials, query tokens, non-health paths or HTTP", () => {
  assert.equal(healthTarget("example.com").href, "https://example.com/api/healthz");
  for (const invalid of ["http://example.com", "https://user:pass@example.com",
    "https://example.com/?token=not-a-token", "https://example.com/private", "https://example.com/#fragment"])
    assert.throws(() => healthTarget(invalid));
});
test("PR guard enforces scopes/issues, only exempts Dependabot from issue rule", () => {
  for (const scope of SCOPES) assert.deepEqual(checkPullRequest({title: `fix(${scope}): x`, body: "Refs #1"}), []);
  assert.equal(checkPullRequest({title: "fix: missing scope", body: "Closes #1"}).length, 1);
  assert.equal(checkPullRequest({title: "fix(ci): missing issue", body: "Closes #N"}).length, 1);
  assert.deepEqual(checkPullRequest({title: "chore(deps): bump dependencies", user: {login: "dependabot[bot]"}}), []);
  assert.equal(checkPullRequest({title: "not conventional", user: {login: "dependabot[bot]"}}).length, 1);
  assert.equal(checkPullRequest({title: "chore(deps): update", user: {login: "dependabot"}}).length, 1);
});
