#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GlobiPOS Terminal — publish a GitHub release
# This triggers GitHub Actions to build all platforms (Windows, macOS, Linux, Android)
# and upload the compiled binaries to a GitHub Release automatically.
#
# Prerequisites:
#   1. This project must be pushed to a GitHub repository
#   2. Run this script from the project root
#
# Usage:  ./scripts/publish-release.sh [version]
#   e.g.  ./scripts/publish-release.sh 1.0.1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:-}"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

RELEASE_ASKPASS=""
RELEASE_VERSION_BACKUP=""
RELEASE_VERSION_FILES=(
  pos-app/package.json
  pos-app/package-lock.json
  pos-app/src-tauri/Cargo.toml
  pos-app/src-tauri/Cargo.lock
  pos-app/src-tauri/tauri.conf.json
)
RELEASE_VERSION_MUTATED=0
cleanup_release_auth() {
  if [[ -n "$RELEASE_ASKPASS" ]]; then
    rm -f "$RELEASE_ASKPASS"
  fi
}

cleanup_release() {
  local status=$?
  if [[ "$status" -ne 0 && "$RELEASE_VERSION_MUTATED" -eq 1 && -n "$RELEASE_VERSION_BACKUP" ]]; then
    warn "Release preflight failed; restoring POS version files…"
    local file
    for file in "${RELEASE_VERSION_FILES[@]}"; do
      cp "$RELEASE_VERSION_BACKUP/$file" "$file"
    done
    success "Restored all POS version files"
  fi
  if [[ -n "$RELEASE_VERSION_BACKUP" ]]; then
    rm -rf "$RELEASE_VERSION_BACKUP"
  fi
  cleanup_release_auth
  return "$status"
}
trap cleanup_release EXIT

configure_github_auth() {
  if git ls-remote --exit-code "$GITHUB_REMOTE" HEAD >/dev/null 2>&1; then
    return
  fi
  [[ -n "${GLOBISYNC:-}" ]] || error \
    "Cannot authenticate to GitHub. Reconnect GitHub or configure the project-scoped GLOBISYNC secret."
  RELEASE_ASKPASS=$(mktemp)
  chmod 700 "$RELEASE_ASKPASS"
  cat >"$RELEASE_ASKPASS" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  *Username*) printf '%s\n' "x-access-token" ;;
  *) printf '%s\n' "$GLOBISYNC" ;;
esac
EOF
  export GIT_ASKPASS="$RELEASE_ASKPASS"
  export GIT_TERMINAL_PROMPT=0
  git ls-remote --exit-code "$GITHUB_REMOTE" HEAD >/dev/null \
    || error "Project-scoped GitHub authentication failed. Refresh GLOBISYNC before releasing."
}

github_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(
    --fail-with-body --silent --show-error
    --request "$method"
    --header "Accept: application/vnd.github+json"
    --header "Authorization: Bearer $GLOBISYNC"
    --header "X-GitHub-Api-Version: 2022-11-28"
  )
  if [[ -n "$data" ]]; then
    args+=(--header "Content-Type: application/json" --data "$data")
  fi
  curl "${args[@]}" "https://api.github.com/repos/${GITHUB_REPOSITORY}${path}"
}

run_windows_preflight() {
  local head_sha="$1"
  local dispatched_at run_json run_id status conclusion

  [[ -n "${GLOBISYNC:-}" ]] || error \
    "The Windows release preflight requires the project-scoped GLOBISYNC secret."

  dispatched_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  info "Requesting Windows native build preflight for $head_sha…"
  github_api POST "/actions/workflows/build-pos.yml/dispatches" \
    "$(printf '{"ref":"main","inputs":{"tag":"%s","preflight_only":"true"}}' "$TAG")" >/dev/null \
    || error "Could not start the Windows release preflight."

  run_id=""
  for _ in {1..30}; do
    run_json=$(github_api GET "/actions/workflows/build-pos.yml/runs?event=workflow_dispatch&branch=main&per_page=20")
    run_id=$(node -e '
      const fs = require("fs");
      const expectedSha = process.argv[1];
      const dispatchedAt = Date.parse(process.argv[2]);
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      const run = data.workflow_runs.find((item) =>
        item.head_sha === expectedSha && Date.parse(item.created_at) >= dispatchedAt
      );
      if (run) process.stdout.write(String(run.id));
    ' "$head_sha" "$dispatched_at" <<<"$run_json")
    [[ -n "$run_id" ]] && break
    sleep 5
  done
  [[ -n "$run_id" ]] || error "Windows release preflight did not appear in GitHub Actions."

  info "Waiting for Windows release preflight run $run_id…"
  for _ in {1..240}; do
    run_json=$(github_api GET "/actions/runs/$run_id") \
      || error "Could not fetch the Windows release preflight status; no release tag was created."
    read -r status conclusion < <(node -e '
      const fs = require("fs");
      const run = JSON.parse(fs.readFileSync(0, "utf8"));
      process.stdout.write(`${run.status} ${run.conclusion || "-"}\n`);
    ' <<<"$run_json")
    [[ "$status" == "completed" ]] && break
    sleep 15
  done
  [[ "$status" == "completed" ]] || error \
    "Windows release preflight did not finish within 60 minutes. Inspect ${REPO_URL}/actions/runs/${run_id}; no release tag was created."

  [[ "$conclusion" == "success" ]] || error \
    "Windows release preflight failed. Inspect ${REPO_URL}/actions/runs/${run_id}; no release tag was created."
  success "Windows native POS build passed"
}

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║  GlobiPOS Terminal — Publish GitHub Release  ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""

# ── Confirm GitHub remote ─────────────────────────────────────────────────────
GITHUB_REMOTE=$(git remote -v 2>/dev/null | grep "github.com" | head -1 | awk '{print $1}' || echo "")
if [[ -z "$GITHUB_REMOTE" ]]; then
  error "No GitHub remote found. Add one with:
  git remote add origin https://github.com/YOUR_ORG/globipos.git
  git push -u origin main"
fi
REPO_URL=$(git remote get-url "$GITHUB_REMOTE" | sed 's/\.git$//' | sed 's|git@github.com:|https://github.com/|')
GITHUB_REPOSITORY="${REPO_URL#https://github.com/}"
success "GitHub remote: $REPO_URL"

# ── Prove repository safety before mutating version files ─────────────────────
CURRENT_BRANCH=$(git branch --show-current)
[[ "$CURRENT_BRANCH" == "main" ]] || error "Release from the main branch, not '$CURRENT_BRANCH'."

[[ -z "$(git status --porcelain)" ]] || error "Working tree is not clean. Commit or stash all changes before releasing."

info "Checking GitHub connectivity and remote branch alignment…"
configure_github_auth
git fetch --quiet "$GITHUB_REMOTE" main --tags \
  || error "Cannot fetch GitHub main and tags. Repair the GitHub connection before releasing."
REMOTE_MAIN="$GITHUB_REMOTE/main"
git show-ref --verify --quiet "refs/remotes/$REMOTE_MAIN" \
  || error "GitHub main was not fetched."
git merge-base --is-ancestor "$REMOTE_MAIN" HEAD \
  || error "Local main does not contain GitHub main. Reconcile the branches without force-pushing before releasing."
git push --dry-run "$GITHUB_REMOTE" HEAD:main >/dev/null \
  || error "GitHub rejected a dry-run push. Repair permissions or branch alignment before releasing."
success "GitHub connection and branch alignment verified"

# ── Get version ───────────────────────────────────────────────────────────────
if [[ -z "$VERSION" ]]; then
  CURRENT_VERSION=$(node -p "require('./pos-app/package.json').version")
  echo -e "  Current POS version: ${BLUE}${CURRENT_VERSION}${NC}"
  read -r -p "  Enter new version (or press Enter to use $CURRENT_VERSION): " INPUT_VERSION
  VERSION="${INPUT_VERSION:-$CURRENT_VERSION}"
fi

# Clean up version string
VERSION="${VERSION#v}"
TAG="v${VERSION}"

info "Publishing version: $TAG"
git rev-parse "$TAG" >/dev/null 2>&1 && error "Tag $TAG already exists."

# ── Confirm ───────────────────────────────────────────────────────────────────
echo ""
echo "  This will:"
echo "   1. Set package, Cargo, Tauri, and lockfile versions to $VERSION"
echo "   2. Push the version commit and require a Windows native build preflight"
echo "   3. Create and push git tag $TAG only after that check passes"
echo "   4. GitHub Actions will then build Windows (.msi), macOS (.dmg),"
echo "      Linux (.AppImage + .deb), and Android (.apk)"
echo "   5. Compiled files will appear in GitHub Releases"
echo ""
read -r -p "  Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES|Yes) ;;
  *) echo "Cancelled."; exit 0 ;;
esac

# ── Update and verify every compiled version source ───────────────────────────
info "Updating all POS version files…"
RELEASE_VERSION_BACKUP=$(mktemp -d)
for file in "${RELEASE_VERSION_FILES[@]}"; do
  mkdir -p "$RELEASE_VERSION_BACKUP/$(dirname "$file")"
  cp "$file" "$RELEASE_VERSION_BACKUP/$file"
done
RELEASE_VERSION_MUTATED=1
node scripts/pos-version.mjs --set "$VERSION"
node scripts/pos-version.mjs --check "$TAG"
success "Package, Cargo, Tauri, lockfile, and tag versions agree at $VERSION"

info "Running deterministic frontend and native preflight checks…"
info "Local checks intentionally avoid compiling Rust inside the Replit workspace."
(cd pos-app && npm ci && npm run typecheck && npm run build)
success "Local frontend checks passed; GitHub will perform the Linux and Windows native preflight"
RELEASE_VERSION_MUTATED=0

# ── Commit the version bump ───────────────────────────────────────────────────
info "Committing version bump…"
git add pos-app/package.json pos-app/package-lock.json pos-app/src-tauri/Cargo.toml pos-app/src-tauri/Cargo.lock pos-app/src-tauri/tauri.conf.json
git diff --cached --quiet || git commit -m "chore: bump terminal version to $VERSION" --no-verify

# Refuse to tag if the staged/committed files no longer match the requested tag.
node scripts/pos-version.mjs --check "$TAG"

# ── Push commit, require Windows preflight, then create tag ───────────────────
info "Pushing version commit to GitHub…"
git push "$GITHUB_REMOTE" main

run_windows_preflight "$(git rev-parse HEAD)"

info "Creating tag $TAG…"
git tag -a "$TAG" -m "GlobiPOS Terminal $TAG"

info "Pushing release tag to GitHub…"
git push "$GITHUB_REMOTE" "$TAG"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ══════════════════════════════════════════════"
success "Release $TAG pushed to GitHub!"
echo ""
echo "  GitHub Actions is now building:"
echo "   • Windows MSI + EXE"
echo "   • macOS DMG (Universal)"
echo "   • Linux AppImage + DEB"
echo "   • Android APK"
echo ""
echo "  Build takes about 15–20 minutes."
echo "  Watch progress at:"
echo "  ${REPO_URL}/actions"
echo ""
echo "  When done, compiled files will be at:"
echo "  ${REPO_URL}/releases/tag/${TAG}"
echo ""
echo "  Configure this repository once in GlobiPOS Settings:"
echo "    pos_github_repo  =  ${REPO_URL}"
echo "  Release versions and download links are discovered automatically."
echo "  ══════════════════════════════════════════════"
