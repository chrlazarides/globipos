export interface PosBuildsSetting {
  key: string;
  value: string;
}

export interface PosReleaseAsset {
  name: string;
  size: number;
  downloadUrl: string;
  downloads: number;
}

export interface PosRelease {
  tag: string;
  name: string;
  publishedAt: string | null;
  prerelease: boolean;
  htmlUrl: string;
  assets: PosReleaseAsset[];
}

export interface PosBuildsResponse {
  releases: PosRelease[];
  stale: boolean;
  warning?: string;
}

interface CachedBuilds {
  repoUrl: string;
  releases: PosRelease[];
  fetchedAt: number;
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  download_count: number;
}

interface GitHubRelease {
  draft?: boolean;
  tag_name: string;
  name: string;
  published_at: string | null;
  prerelease?: boolean;
  html_url: string;
  assets?: GitHubAsset[];
}

export type PosBuildsResult =
  | { status: 200; body: PosBuildsResponse }
  | { status: 400 | 500 | 502; body: { message: string } };

export interface PosBuildsResolverOptions {
  getSettings: () => Promise<PosBuildsSetting[]>;
  fetchFn?: typeof fetch;
  getGithubToken?: () => string | undefined;
  getDefaultRepo?: () => string | undefined;
  now?: () => number;
  cacheMs?: number;
}

const DEFAULT_REPO_URL = "https://github.com/chrlazarides/globipos";
const GITHUB_RELEASES_PER_PAGE = 5;
const CACHE_MS = 5 * 60 * 1000;
const TEMPORARY_FAILURE_WARNING =
  "GitHub is temporarily unavailable. Showing the last successfully verified release links.";

export function createPosBuildsResolver({
  getSettings,
  fetchFn = globalThis.fetch,
  getGithubToken = () => undefined,
  getDefaultRepo = () => undefined,
  now = Date.now,
  cacheMs = CACHE_MS,
}: PosBuildsResolverOptions): () => Promise<PosBuildsResult> {
  let cache: CachedBuilds | null = null;

  return async function resolvePosBuilds(): Promise<PosBuildsResult> {
    let requestedRepoUrl: string | null = null;

    try {
      const settings = await getSettings();
      const repoUrl =
        settings.find((setting) => setting.key === "pos_github_repo")?.value ||
        getDefaultRepo() ||
        DEFAULT_REPO_URL;
      requestedRepoUrl = repoUrl;

      if (cache && cache.repoUrl === repoUrl && now() - cache.fetchedAt < cacheMs) {
        return {
          status: 200,
          body: { releases: cache.releases, stale: false },
        };
      }

      const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!match) {
        return {
          status: 400,
          body: { message: "pos_github_repo setting is not a valid GitHub URL" },
        };
      }

      const [, owner, repo] = match;
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "GlobiPOS",
      };
      const githubToken = getGithubToken();
      if (githubToken) headers.Authorization = `token ${githubToken}`;

      const githubResponse = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${GITHUB_RELEASES_PER_PAGE}`,
        { headers },
      );

      if (!githubResponse.ok) {
        if (cache?.repoUrl === repoUrl) {
          return {
            status: 200,
            body: {
              releases: cache.releases,
              stale: true,
              warning: TEMPORARY_FAILURE_WARNING,
            },
          };
        }
        return {
          status: 502,
          body: {
            message: `GitHub API error: ${githubResponse.status}. No verified release links are cached yet.`,
          },
        };
      }

      const githubReleases = (await githubResponse.json()) as GitHubRelease[];
      const releases = githubReleases
        .filter((release) => !release.draft)
        .map((release) => ({
          tag: release.tag_name,
          name: release.name,
          publishedAt: release.published_at,
          prerelease: Boolean(release.prerelease),
          htmlUrl: release.html_url,
          assets: (release.assets ?? [])
            .filter((asset) => !asset.name.endsWith(".sig") && asset.name !== "latest.json")
            .map((asset) => ({
              name: asset.name,
              size: asset.size,
              downloadUrl: asset.browser_download_url,
              downloads: asset.download_count,
            })),
        }));

      cache = { repoUrl, releases, fetchedAt: now() };
      return { status: 200, body: { releases, stale: false } };
    } catch (error: any) {
      if (requestedRepoUrl && cache?.repoUrl === requestedRepoUrl) {
        return {
          status: 200,
          body: {
            releases: cache.releases,
            stale: true,
            warning: TEMPORARY_FAILURE_WARNING,
          },
        };
      }
      return {
        status: 500,
        body: { message: error?.message ?? "Unable to load POS builds" },
      };
    }
  };
}