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

# ── Get version ───────────────────────────────────────────────────────────────
if [[ -z "$VERSION" ]]; then
  # Read from tauri.conf.json
  CONF_VERSION=$(grep '"version"' pos-app/src-tauri/tauri.conf.json | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  echo -e "  Current version in tauri.conf.json: ${BLUE}${CONF_VERSION}${NC}"
  read -r -p "  Enter new version (or press Enter to use $CONF_VERSION): " INPUT_VERSION
  VERSION="${INPUT_VERSION:-$CONF_VERSION}"
fi

# Clean up version string
VERSION="${VERSION#v}"
TAG="v${VERSION}"

info "Publishing version: $TAG"

# ── Confirm ───────────────────────────────────────────────────────────────────
echo ""
echo "  This will:"
echo "   1. Bump version to $VERSION in tauri.conf.json"
echo "   2. Create git tag $TAG"
echo "   3. Push tag to GitHub"
echo "   4. GitHub Actions will build Windows (.msi), macOS (.dmg),"
echo "      Linux (.AppImage + .deb), and Android (.apk)"
echo "   5. Compiled files will appear in GitHub Releases"
echo ""
read -r -p "  Continue? [y/N] " CONFIRM
[[ "${CONFIRM,,}" == "y" || "${CONFIRM,,}" == "yes" ]] || { echo "Cancelled."; exit 0; }

# ── Update version in tauri.conf.json ────────────────────────────────────────
info "Updating version in tauri.conf.json…"
if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" pos-app/src-tauri/tauri.conf.json
else
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" pos-app/src-tauri/tauri.conf.json
fi
success "Version set to $VERSION"

# ── Commit the version bump ───────────────────────────────────────────────────
info "Committing version bump…"
git add pos-app/src-tauri/tauri.conf.json
git commit -m "chore: bump terminal version to $VERSION" --no-verify 2>/dev/null || true

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
echo "  Copy that URL to GlobiPOS Settings:"
echo "    pos_github_repo  =  ${REPO_URL}"
echo "    pos_app_version  =  ${TAG}"
echo "  ══════════════════════════════════════════════"
