import assert from "node:assert/strict";
import test from "node:test";
import {
  createPosBuildsResolver,
  type PosBuildsSetting,
  type PosBuildsResponse,
} from "./pos-builds";

const repoA = "https://github.com/example/pos-a";
const repoB = "https://github.com/example/pos-b";

function settingsFor(repoUrl: string): PosBuildsSetting[] {
  return [{ key: "pos_github_repo", value: repoUrl }];
}

function githubRelease(repo: string, suffix: string) {
  return {
    tag_name: `v1.0.0-${suffix}`,
    name: `POS ${suffix}`,
    published_at: "2026-09-08T10:00:00Z",
    prerelease: false,
    draft: false,
    html_url: `${repo}/releases/tag/v1.0.0-${suffix}`,
    assets: [
      {
        name: `GlobiPOS-${suffix}.msi`,
        size: 1234,
        browser_download_url: `${repo}/releases/download/v1.0.0-${suffix}/GlobiPOS-${suffix}.msi`,
        download_count: 7,
      },
      {
        name: `GlobiPOS-${suffix}.msi.sig`,
        size: 99,
        browser_download_url: `${repo}/releases/download/v1.0.0-${suffix}/GlobiPOS-${suffix}.msi.sig`,
        download_count: 1,
      },
      {
        name: "latest.json",
        size: 100,
        browser_download_url: `${repo}/releases/latest/download/latest.json`,
        download_count: 1,
      },
    ],
  };
}

function createFakeFetch(
  responses: Array<{ ok: boolean; status: number; body?: unknown } | Error>,
) {
  let call = 0;
  const requests: string[] = [];
  const fetchFn = async (url: string) => {
    requests.push(url);
    const response = responses[Math.min(call++, responses.length - 1)];
    if (response instanceof Error) throw response;
    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    } as Response;
  };
  return { fetchFn, requests };
}

function releasesFrom(result: Awaited<ReturnType<ReturnType<typeof createPosBuildsResolver>>>): PosBuildsResponse {
  assert.equal(result.status, 200);
  return result.body as PosBuildsResponse;
}

test("returns verified release assets from the configured GitHub repository", async () => {
  const fake = createFakeFetch([
    { ok: true, status: 200, body: [githubRelease(repoA, "release")] },
  ]);
  const resolve = createPosBuildsResolver({
    getSettings: async () => settingsFor(repoA),
    fetchFn: fake.fetchFn,
  });

  const result = await resolve();

  assert.equal(result.status, 200);
  const body = releasesFrom(result);
  assert.equal(body.stale, false);
  assert.equal(body.releases[0].htmlUrl, `${repoA}/releases/tag/v1.0.0-release`);
  assert.deepEqual(body.releases[0].assets, [
    {
      name: "GlobiPOS-release.msi",
      size: 1234,
      downloadUrl: `${repoA}/releases/download/v1.0.0-release/GlobiPOS-release.msi`,
      downloads: 7,
    },
  ]);
  assert.deepEqual(fake.requests, [
    "https://api.github.com/repos/example/pos-a/releases?per_page=5",
  ]);
});

test("returns only the last-known-good assets during a temporary GitHub failure", async () => {
  let currentTime = 100;
  const fake = createFakeFetch([
    { ok: true, status: 200, body: [githubRelease(repoA, "verified")] },
    { ok: false, status: 503 },
  ]);
  const resolve = createPosBuildsResolver({
    getSettings: async () => settingsFor(repoA),
    fetchFn: fake.fetchFn,
    now: () => currentTime,
    cacheMs: 5 * 60 * 1000,
  });

  const first = releasesFrom(await resolve());
  currentTime += 5 * 60 * 1000;
  const failed = await resolve();

  assert.equal(failed.status, 200);
  const body = releasesFrom(failed);
  assert.equal(body.stale, true);
  assert.match(body.warning ?? "", /last successfully verified release links/);
  assert.deepEqual(body.releases, first.releases);
  assert.equal(body.releases[0].assets[0].downloadUrl.includes("verified"), true);
  assert.equal(fake.requests.length, 2);
});

test("does not reuse a cached release when the configured repository changes", async () => {
  let configuredRepo = repoA;
  const fake = createFakeFetch([
    { ok: true, status: 200, body: [githubRelease(repoA, "repo-a")] },
    { ok: false, status: 503 },
  ]);
  const resolve = createPosBuildsResolver({
    getSettings: async () => settingsFor(configuredRepo),
    fetchFn: fake.fetchFn,
    now: () => 1000,
    cacheMs: 0,
  });

  await resolve();
  configuredRepo = repoB;
  const changedRepoFailure = await resolve();

  assert.equal(changedRepoFailure.status, 502);
  assert.match(
    changedRepoFailure.body.message,
    /No verified release links are cached yet/,
  );
  assert.equal("releases" in changedRepoFailure.body, false);
  assert.equal(changedRepoFailure.body.message.includes("repo-a"), false);
  assert.equal(fake.requests[1], "https://api.github.com/repos/example/pos-b/releases?per_page=5");
});

test("reloads repository-scoped verified releases after a restart during a GitHub outage", async () => {
  const persisted = new Map<string, { releases: PosBuildsResponse["releases"]; verifiedAt: Date }>([
    [
      repoA,
      {
        releases: [{
          tag: "v1.0.0-persisted",
          name: "POS persisted",
          publishedAt: "2026-09-08T10:00:00.000Z",
          prerelease: false,
          htmlUrl: `${repoA}/releases/tag/v1.0.0-persisted`,
          assets: [{
            name: "GlobiPOS-persisted.msi",
            size: 1234,
            downloadUrl: `${repoA}/releases/download/v1.0.0-persisted/GlobiPOS-persisted.msi`,
            downloads: 7,
          }],
        }],
        verifiedAt: new Date("2026-09-08T10:00:00.000Z"),
      },
    ],
  ]);
  const fake = createFakeFetch([
    { ok: false, status: 503 },
    { ok: false, status: 503 },
  ]);
  let configuredRepo = repoA;
  const resolveAfterRestart = createPosBuildsResolver({
    getSettings: async () => settingsFor(configuredRepo),
    fetchFn: fake.fetchFn,
    getPersistedCache: async (repoUrl) => persisted.get(repoUrl),
  });

  const recovered = await resolveAfterRestart();

  assert.equal(recovered.status, 200);
  const recoveredBody = releasesFrom(recovered);
  assert.equal(recoveredBody.stale, true);
  assert.equal(recoveredBody.verifiedAt, "2026-09-08T10:00:00.000Z");
  assert.deepEqual(recoveredBody.releases, persisted.get(repoA)?.releases);
  assert.deepEqual(recoveredBody.releases[0].assets, [{
    name: "GlobiPOS-persisted.msi",
    size: 1234,
    downloadUrl: `${repoA}/releases/download/v1.0.0-persisted/GlobiPOS-persisted.msi`,
    downloads: 7,
  }]);
  assert.match(recoveredBody.warning ?? "", /last successfully verified release links/);

  configuredRepo = repoB;
  const otherRepository = await resolveAfterRestart();

  assert.equal(otherRepository.status, 502);
  assert.match(otherRepository.body.message, /No verified release links are cached yet/);
  assert.equal("releases" in otherRepository.body, false);
  assert.equal(otherRepository.body.message.includes("persisted"), false);
  assert.deepEqual(fake.requests, [
    "https://api.github.com/repos/example/pos-a/releases?per_page=5",
    "https://api.github.com/repos/example/pos-b/releases?per_page=5",
  ]);
});

test("returns no direct download links when GitHub is unavailable without a cache", async () => {
  const fake = createFakeFetch([{ ok: false, status: 503 }]);
  const resolve = createPosBuildsResolver({
    getSettings: async () => settingsFor(repoB),
    fetchFn: fake.fetchFn,
  });

  const result = await resolve();

  assert.equal(result.status, 502);
  assert.match(result.body.message, /No verified release links are cached yet/);
  assert.equal("releases" in result.body, false);
  assert.equal(result.body.message.includes("download"), false);
});