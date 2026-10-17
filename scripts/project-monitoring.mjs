// Pure report logic. Inputs are GitHub development metadata, never app data.
const DAY = 86_400_000;
export const APPS = ["Back office", "API", "POS terminal", "POS native", "PDA",
  "Mobile/customer app", "Shared lib", "Docs/infra"];
export const PRODUCTS = [
  {name: "Back office", prefixes: ["backoffice-v"], app: "Back office"},
  {name: "API", prefixes: ["api-v"], app: "API"},
  {name: "POS web", prefixes: ["pos-web-v"], app: "POS terminal"},
  {name: "POS native", prefixes: ["pos-native-v", "v"], app: "POS native"},
  {name: "PDA", prefixes: ["pda-v"], app: "PDA"},
];
const paths = [
  ["artifacts/globipos/", "Back office"], ["artifacts/api-server/", "API"],
  ["artifacts/globipos-terminal/", "POS terminal"], ["pos-app/", "POS native"],
  ["pda-app/", "PDA"], ["artifacts/globipos-mobile/", "Mobile/customer app"],
  ["customer-app/", "Mobile/customer app"], ["lib/", "Shared lib"],
];
export function appsFor(files) {
  const result = [...new Set(files.map(file => paths.find(([prefix]) => file.startsWith(prefix))?.[1] ?? "Docs/infra"))];
  return result.length ? result : ["Docs/infra"];
}
export function linkedIssues(body, repo) {
  const result = new Set();
  for (const match of (body ?? "").matchAll(/\b(?:closes|fixes|refs)\s*:?\s+([^\r\n]+)/gi)) {
    for (const reference of match[1].matchAll(/(?:(\w[\w.-]*\/[\w.-]+))?#([1-9]\d*)\b/g))
      result.add(`https://github.com/${reference[1] ?? repo}/issues/${reference[2]}`);
    for (const reference of match[1].matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)\b/g))
      result.add(`https://github.com/${reference[1]}/issues/${reference[2]}`);
  }
  return [...result];
}
export function protectedRules(codeowners) {
  // The catch-all owner is a review default, not a special financial-area rule.
  return codeowners.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .filter(parts => parts[0] && !parts[0].startsWith("#") && parts[0] !== "*" &&
      parts.slice(1).some(owner => owner.startsWith("@"))).map(parts => parts[0]);
}
export function matchesOwnerPath(file, pattern) {
  const anchored = pattern.startsWith("/") || pattern.includes("/");
  const glob = pattern.replace(/^\//, "").replace(/\/$/, "");
  let expression = "";
  for (let i = 0; i < glob.length; i++) {
    if (glob.slice(i, i + 3) === "**/") { expression += "(?:.*/)?"; i += 2; }
    else if (glob.slice(i, i + 2) === "**") { expression += ".*"; i++; }
    else if (glob[i] === "*") expression += "[^/]*";
    else if (glob[i] === "?") expression += "[^/]";
    else expression += glob[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${anchored ? "^" : "(?:^|/)"}${expression}(?:/.*)?$`).test(file);
}
export function scheduleAllowed(event, cron, now) {
  if (event !== "schedule") return true;
  const offset = new Intl.DateTimeFormat("en", {timeZone: "Europe/Nicosia",
    timeZoneName: "shortOffset"}).formatToParts(new Date(now)).find(p => p.type === "timeZoneName")?.value;
  // Select by UTC offset, not runner start-hour, so delayed jobs still run.
  return cron === (offset === "GMT+3" ? "0 4 * * 5" : "0 5 * * 5");
}
export const ageDays = (now, date) => Math.max(0, (Date.parse(now) - Date.parse(date)) / DAY);
export function localDate(now) {
  return new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Nicosia",
    year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date(now));
}
const red = new Set(["failure", "timed_out", "startup_failure", "action_required"]);
export function quality(workflows, attempts) {
  const groups = new Map(workflows.map(w => [w.id, {...w, attempts: []}]));
  for (const attempt of attempts) {
    if (!groups.has(attempt.workflowId)) groups.set(attempt.workflowId,
      {id: attempt.workflowId, name: attempt.name, attempts: []});
    groups.get(attempt.workflowId).attempts.push(attempt);
  }
  return [...groups.values()].map(group => {
    const evaluated = group.attempts.filter(a => a.conclusion === "success" || red.has(a.conclusion));
    return {...group, runs: new Set(group.attempts.map(a => a.id)).size,
      reruns: group.attempts.filter(a => a.attempt > 1).length,
      passRate: evaluated.length ? evaluated.filter(a => a.conclusion === "success").length / evaluated.length : null,
      redMain: group.attempts.filter(a => red.has(a.conclusion) && a.branch === "main" &&
        !["pull_request", "pull_request_target"].includes(a.event))};
  });
}
export async function collectAttempts(runs, loadAttempt, since, now) {
  const attempts = [];
  for (const run of runs.filter(r => Date.parse(r.updated_at) >= Date.parse(since))) {
    for (let number = 1; number <= (run.run_attempt ?? 1); number++) {
      const attempt = number === (run.run_attempt ?? 1) ? run : await loadAttempt(run, number);
      const started = Date.parse(attempt.run_started_at ?? attempt.created_at);
      if (!Number.isFinite(started) || started < Date.parse(since) || started > Date.parse(now)) continue;
      attempts.push({id: run.id, workflowId: run.workflow_id, name: run.name,
        url: `${run.html_url}/attempts/${number}`,
        attempt: number, branch: run.head_branch, event: run.event, conclusion: attempt.conclusion});
    }
  }
  return attempts;
}
export function releaseSummary(merged, tags, comparisons, now) {
  return PRODUCTS.map(product => {
    const matching = tags.filter(tag => product.prefixes.some(prefix =>
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+\\.\\d+\\.\\d+(?:[-+].*)?$`).test(tag.name)))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const tag = matching[0];
    const comparison = tag ? comparisons[tag.name] : null;
    // Shared libraries/root workspace changes can affect every product.
    const relevant = merged.filter(pr => appsFor(pr.files).includes(product.app) ||
      pr.files.some(f => f.startsWith("lib/") || /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(f)));
    const verified = !tag || comparison?.verified === true;
    const commits = new Set(comparison?.commits ?? []);
    const unreleased = verified ? relevant.filter(pr => !tag || commits.has(pr.mergeCommit)) : [];
    return {name: product.name, tag: tag?.name ?? null, verified, unreleased,
      oldestDays: unreleased.length ? Math.max(...unreleased.map(pr => ageDays(now, pr.mergedAt))) : 0,
      reason: comparison?.reason};
  });
}
function text(value) {
  return String(value).replace(/(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/[\x00-\x1f\x7f\\`*_[\]<>|]/g, "").slice(0, 160);
}
const item = entry => `[#${entry.number}](${entry.url})`;
const stamp = date => new Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Nicosia",
  dateStyle: "medium", timeStyle: "short"}).format(new Date(date));
export function buildReport(data) {
  const lines = [`# Weekly project report — ${localDate(data.now)}`,
    "", `Period: ${stamp(data.since)} → ${stamp(data.now)} (Europe/Nicosia).`,
    "Development metadata only. Follow PR/issue links for details; titles, bodies, secret values and health response bodies are deliberately omitted.", "",
    "## Changes merged"];
  const thisWeek = data.merged.filter(pr => Date.parse(pr.mergedAt) >= Date.parse(data.since) &&
    Date.parse(pr.mergedAt) <= Date.parse(data.now));
  for (const app of APPS) {
    const prs = thisWeek.filter(pr => appsFor(pr.files).includes(app));
    lines.push(`### ${app}`, ...(prs.length ? prs.map(pr =>
      `- ${item(pr)} — ${pr.linkedIssues.length ? pr.linkedIssues.map((url) =>
        `[#${url.split("/").at(-1)}](${url})`).join(", ") : "**WARNING: merged without a linked issue**"}`) : ["- None."]));
  }
  lines.push("", "## Protected areas");
  const protectedPrs = thisWeek.map(pr => ({pr, rules: data.protectedRules.filter(rule =>
    pr.files.some(file => matchesOwnerPath(file, rule)))})).filter(p => p.rules.length);
  lines.push(...(protectedPrs.length ? protectedPrs.map(({pr, rules}) =>
    `- ${item(pr)} — ${rules.map(rule => `\`${rule}\``).join(", ")}`) : ["- None."]));
  lines.push("", "## Work in flight");
  for (const [heading, entries] of [["Open PRs", data.openPrs], ["Open issues labelled in-progress", data.inProgress]]) {
    lines.push(`### ${heading}`, ...(entries.length ? entries.map(entry =>
      `- ${item(entry)} — ${ageDays(data.now, entry.createdAt).toFixed(1)} days old${ageDays(data.now, entry.createdAt) > 7 ? " — **WARNING: older than 7 days**" : ""}`) : ["- None."]));
  }
  lines.push("", "## Quality",
    "Attempts started in this period; reruns count separately. Pass rate excludes cancelled, skipped, neutral and unfinished attempts.",
    "| Workflow | Runs | Attempts | Pass rate | Reruns |", "|---|---:|---:|---:|---:|");
  const metrics = quality(data.workflows, data.attempts);
  for (const group of metrics)
    lines.push(`| ${text(group.name)} | ${group.runs} | ${group.attempts.length} | ${group.passRate === null ? "not available" : `${(group.passRate * 100).toFixed(1)}%`} | ${group.reruns} |`);
  for (const group of metrics) {
    if (group.passRate !== null && group.passRate < 0.9)
      lines.push(`\n**WARNING: ${text(group.name)} pass rate is below 90%.**\n`);
    for (const run of group.redMain)
      lines.push(`\n**WARNING: red run on main** — [run ${run.id}, attempt ${run.attempt}](${run.url}) (${text(run.conclusion)}).\n`);
  }
  lines.push("", "## Releases",
    "Counts use tag→main commit ancestry, not tag names or dates alone. Includes shared-library/workspace changes; missing tags count all merged history.");
  for (const release of releaseSummary(data.merged, data.tags, data.comparisons, data.now)) {
    lines.push(`- **${release.name}** — latest tag: ${release.tag ? `\`${text(release.tag)}\`` : "none"}; ${release.verified ? `${release.unreleased.length} merged PR(s) not released` : "**not verified** (tag comparison unavailable or tag not an ancestor of main)"}.`);
    if (release.oldestDays > 14)
      lines.push(`  - **WARNING: merged-but-unreleased work is ${release.oldestDays.toFixed(1)} days old.**`);
  }
  lines.push("", "## Security");
  for (const [name, result] of [["Dependabot", data.security.dependabot], ["Secret scanning", data.security.secretScanning]]) {
    lines.push(`- ${name}: ${result.available ? `${result.alerts.length} open${result.alerts.length ? " — " + result.alerts.map(a =>
      `[#${a.number}](${a.url})${a.severity ? ` (${text(a.severity)})` : ""}`).join(", ") : ""}` : "not available (permission, repository feature or API access unavailable)"}.`);
  }
  if (data.health !== null) lines.push("", "## Live health", ...data.health.map(h => `- ${text(h.host)} — ${text(h.status)}`));
  else lines.push("", "Live health skipped: HEALTH_URLS is unset.");
  if (data.warnings.length) lines.push("", "## Coverage warnings", ...data.warnings.map(w => `- **WARNING:** ${text(w)}`));
  return lines.join("\n") + "\n";
}
