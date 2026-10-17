import {readFile, appendFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {buildReport, protectedRules, linkedIssues, scheduleAllowed, localDate, releaseSummary, collectAttempts} from "./project-monitoring.mjs";

const API = "https://api.github.com";
export function healthTarget(raw) {
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !["/", "/api/healthz"].includes(url.pathname)) throw Error("Use an HTTPS origin without credentials or query parameters");
  url.pathname = "/api/healthz";
  return url;
}
async function main() {
  const now = new Date().toISOString();
  if (!scheduleAllowed(process.env.GITHUB_EVENT_NAME, process.env.EVENT_SCHEDULE, now)) {
    console.log("::notice::Not the 07:00 Europe/Nicosia invocation; DST counterpart skipped.");
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) throw Error("Missing or invalid GITHUB_REPOSITORY");
  if (!process.env.GITHUB_TOKEN) throw Error("GITHUB_TOKEN is required");
  const [owner, name] = repo.split("/");
  const since = new Date(Date.parse(now) - 7 * 86_400_000).toISOString();
  async function request(path, method = "GET", body) {
    const response = await fetch(`${API}${path}`, {
      method, headers: {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json", "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub API returned HTTP ${response.status}`);
      error.status = response.status;
      throw error; // Never log response bodies (security endpoints may contain secrets).
    }
    return response.status === 204 ? null : response.json().catch(() => {
      throw Error("GitHub API returned invalid JSON");
    });
  }
  async function pages(path, key) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const result = await request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const rows = key ? result[key] : result;
      if (!Array.isArray(rows)) throw Error("Unexpected GitHub pagination response");
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw Error("GitHub pagination exceeded 10,000 records; refusing an incomplete report");
  }
  async function graph(query, variables) {
    const result = await request("/graphql", "POST", {query, variables});
    if (result.errors?.length) throw Error("GitHub GraphQL returned errors");
    return result.data;
  }
  const root = `/repos/${repo}`;
  const repository = await request(root);
  const warnings = [];
  // Read all retained merged-main PRs so >14-day unreleased work is not missed.
  const closed = await pages(`${root}/pulls?state=closed&base=main&sort=updated&direction=desc`);
  const merged = [];
  for (const pr of closed.filter(p => p.merged_at)) {
    const files = await pages(`${root}/pulls/${pr.number}/files`);
    if (files.length >= 3000) warnings.push(`PR #${pr.number} reached GitHub's 3,000-file listing limit; app/protected-area classification may be incomplete.`);
    merged.push({number: pr.number, url: `https://github.com/${repo}/pull/${pr.number}`,
      mergedAt: pr.merged_at, mergeCommit: pr.merge_commit_sha,
      files: [...new Set(files.flatMap(f => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]))],
      linkedIssues: linkedIssues(pr.body, repo), nodeId: pr.node_id});
  }
  // Include linked closing issues from the Development sidebar, not only body text.
  for (let i = 0; i < merged.length; i += 50) {
    const batch = merged.slice(i, i + 50);
    const nodes = await graph(`query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{
      number closingIssuesReferences(first:100){nodes{url} pageInfo{hasNextPage}}}}}`, {ids: batch.map(p => p.nodeId)});
    for (const node of nodes.nodes) {
      if (!node) continue;
      const pr = batch.find(p => p.number === node.number);
      pr.linkedIssues = [...new Set([...pr.linkedIssues, ...node.closingIssuesReferences.nodes.map(i => i.url)])];
      if (node.closingIssuesReferences.pageInfo.hasNextPage) warnings.push(`PR #${pr.number} has more than 100 linked issues.`);
    }
  }
  const tags = [];
  let after = null;
  do {
    const data = await graph(`query($owner:String!,$name:String!,$after:String){
      repository(owner:$owner,name:$name){refs(refPrefix:"refs/tags/",first:100,after:$after,
        orderBy:{field:TAG_COMMIT_DATE,direction:DESC}){nodes{name target{
          ... on Commit{oid committedDate}
          ... on Tag{target{... on Commit{oid committedDate}}}
        }} pageInfo{hasNextPage endCursor}}}}`, {owner, name, after});
    const connection = data.repository.refs;
    for (const tag of connection.nodes) {
      const commit = tag.target.committedDate ? tag.target : tag.target.target;
      if (commit?.committedDate) tags.push({name: tag.name, date: commit.committedDate, sha: commit.oid});
      else warnings.push("A nested/non-commit tag could not be resolved.");
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  const comparisons = {};
  for (const release of releaseSummary(merged, tags, {}, now)) {
    if (!release.tag || comparisons[release.tag]) continue;
    try {
      const tag = tags.find(t => t.name === release.tag);
      const comparison = await request(`${root}/compare/${encodeURIComponent(release.tag)}...main?per_page=100`);
      const commits = [...comparison.commits];
      for (let page = 2; commits.length < comparison.total_commits; page++) {
        const next = await request(`${root}/compare/${encodeURIComponent(release.tag)}...main?per_page=100&page=${page}`);
        if (!next.commits.length) throw Error("Incomplete tag comparison");
        commits.push(...next.commits);
      }
      comparisons[release.tag] = {verified: comparison.merge_base_commit.sha === tag.sha,
        commits: commits.map(c => c.sha)};
    } catch { comparisons[release.tag] = {verified: false}; }
  }
  const openPrs = (await pages(`${root}/pulls?state=open`)).map(pr => ({
    number: pr.number, url: `https://github.com/${repo}/pull/${pr.number}`, createdAt: pr.created_at}));
  const inProgress = (await pages(`${root}/issues?state=open&labels=in-progress`)).filter(i => !i.pull_request).map(i => ({
    number: i.number, url: `https://github.com/${repo}/issues/${i.number}`, createdAt: i.created_at}));
  const workflows = (await pages(`${root}/actions/workflows`, "workflows")).map(w => ({id: w.id, name: w.name}));
  // Do not filter by original created_at: an old run may have been rerun this week.
  const runs = await pages(`${root}/actions/runs`, "workflow_runs");
  const attempts = await collectAttempts(runs,
    (run, number) => request(`${root}/actions/runs/${run.id}/attempts/${number}`), since, now);
  async function alerts(path, secret = false) {
    try {
      const rows = await pages(`${root}/${path}?state=open`);
      // Intentionally discard secrets, locations, package metadata and raw bodies.
      return {available: true, alerts: rows.map(a => ({number: a.number, url: a.html_url,
        ...(secret ? {} : {severity: a.security_advisory?.severity ?? "unknown"})}))};
    } catch { return {available: false, alerts: []}; }
  }
  const security = {dependabot: await alerts("dependabot/alerts"),
    secretScanning: await alerts("secret-scanning/alerts", true)};
  const health = process.env.HEALTH_URLS?.trim() ? [] : null;
  if (health) for (const [index, raw] of process.env.HEALTH_URLS.split(",").entries()) {
    if (!raw.trim()) continue;
    let url;
    try { url = healthTarget(raw.trim()); }
    catch { health.push({host: `Entry ${index + 1}`, status: "invalid HTTPS origin; credentials/query/path not allowed"}); continue; }
    try {
      const response = await fetch(url, {redirect: "error", signal: AbortSignal.timeout(8_000)});
      health.push({host: url.host, status: response.ok ? "OK" : `HTTP ${response.status}`});
      await response.body?.cancel().catch(() => {}); // Never parse or include application responses.
    } catch { health.push({host: url.host, status: "network error, redirect or timeout"}); }
  }
  const body = buildReport({repo, now, since, merged, openPrs, inProgress, workflows, attempts,
    tags, comparisons, security, health, warnings,
    protectedRules: protectedRules(await readFile(".github/CODEOWNERS", "utf8"))});
  if (body.length > 60_000) throw Error("Full report exceeds the issue body limit; refusing silent truncation");
  try { await request(`${root}/labels`, "POST", {name: "weekly-report", color: "1d76db",
    description: "Automated development-project monitoring report"}); }
  catch (error) { if (error.status !== 422) throw error; }
  const previous = await pages(`${root}/issues?state=open&labels=weekly-report`);
  const issue = await request(`${root}/issues`, "POST", {
    title: `Weekly project report — ${localDate(now)}`, body, labels: ["weekly-report"],
    ...(repository.owner.type === "User" ? {assignees: [repository.owner.login]} : {})});
  // Create first: a transient failure must never close the only existing report.
  for (const old of previous.filter(i => !i.pull_request &&
    i.user?.login === "github-actions[bot]" && i.title.startsWith("Weekly project report — ")))
    await request(`${root}/issues/${old.number}`, "PATCH", {state: "closed", state_reason: "completed"});
  console.log(`Weekly report posted as issue #${issue.number}.`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Weekly development report: ${issue.html_url}\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
