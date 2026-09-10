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
success "GitHub remote: $REPO_URL"

# ── Prove repository safety before mutating version files ─────────────────────
CURRENT_BRANCH=$(git branch --show-current)
[[ "$CURRENT_BRANCH" == "main" ]] || error "Release from the main branch, not '$CURRENT_BRANCH'."

[[ -z "$(git status --porcelain)" ]] || error "Working tree is not clean. Commit or stash all changes before releasing."

info "Checking GitHub connectivity and remote branch alignment…"
git ls-remote --exit-code "$GITHUB_REMOTE" HEAD >/dev/null \
  || error "Cannot read the GitHub repository. Repair the GitHub connection before releasing."
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
echo "   2. Create git tag $TAG"
echo "   3. Push tag to GitHub"
echo "   4. GitHub Actions will build Windows (.msi), macOS (.dmg),"
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
node scripts/pos-version.mjs --set "$VERSION"
node scripts/pos-version.mjs --check "$TAG"
success "Package, Cargo, Tauri, lockfile, and tag versions agree at $VERSION"

info "Running deterministic frontend and native preflight checks…"
(cd pos-app && npm ci && npm run build)
(cd pos-app/src-tauri && cargo check --locked)
success "Frontend and native POS checks passed"

# ── Commit the version bump ───────────────────────────────────────────────────
info "Committing version bump…"
git add pos-app/package.json pos-app/package-lock.json pos-app/src-tauri/Cargo.toml pos-app/src-tauri/Cargo.lock pos-app/src-tauri/tauri.conf.json
git diff --cached --quiet || git commit -m "chore: bump terminal version to $VERSION" --no-verify

# Refuse to tag if the staged/committed files no longer match the requested tag.
node scripts/pos-version.mjs --check "$TAG"

# ── Tag and push ──────────────────────────────────────────────────────────────
info "Creating tag $TAG…"
git tag -a "$TAG" -m "GlobiPOS Terminal $TAG"

info "Pushing to GitHub…"
git push "$GITHUB_REMOTE" main
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
