#!/usr/bin/env bash
# ── GlobiPOS → GitHub Sync ────────────────────────────────────────────────────
# Push the current Replit branch to github.com/chrlazarides/globipos
#
# Requires the GITHUB_PERSONAL_ACCESS_TOKEN secret to be set in Replit.
# Run manually: bash scripts/sync-github.sh
# Or trigger from the "Sync to GitHub" workflow in Replit.

set -euo pipefail

OWNER="chrlazarides"
REPO="globipos"
BRANCH="main"
CLEAN_URL="https://github.com/${OWNER}/${REPO}.git"

if [ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]; then
  echo "✗ GITHUB_PERSONAL_ACCESS_TOKEN secret is not set."
  echo "  Add it in Replit → Secrets and try again."
  exit 1
fi

AUTH_URL="https://${OWNER}:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/${OWNER}/${REPO}.git"

echo "→ Syncing to GitHub (${OWNER}/${REPO} @ ${BRANCH})..."

# Point remote at authenticated URL, push, then restore clean URL
git remote set-url origin "$AUTH_URL"
git push -u origin "$BRANCH" 2>&1 | sed "s|${GITHUB_PERSONAL_ACCESS_TOKEN}|***|g"
EXIT_CODE=${PIPESTATUS[0]}
git remote set-url origin "$CLEAN_URL"

if [ "$EXIT_CODE" -eq 0 ]; then
  echo ""
  echo "✓ GitHub synced successfully!"
  echo "  https://github.com/${OWNER}/${REPO}"
else
  echo ""
  echo "✗ Push failed (exit $EXIT_CODE). Check output above."
  exit "$EXIT_CODE"
fi
