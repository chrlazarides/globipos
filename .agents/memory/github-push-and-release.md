---
name: GitHub push & POS release mechanics
description: How to push commits and cut a POS release build from the Replit sandbox
---

# GitHub push & POS release

Keep release versions aligned across every package and native manifest before
tagging. Ensure lockfiles committed for external CI use a registry URL reachable
outside Replit.

**Why:** Tag-triggered builds package the versions and dependency URLs already
committed at that tag; mismatches produce incorrectly versioned or unbuildable
release artifacts.

**How to apply:** Before creating any POS release tag, compare all version
manifests, inspect lockfile registry URLs, and verify the resulting CI run.
Treat a multi-file version bump as a recoverable transaction: keep the original
contents until post-write validation succeeds, and retain recovery data if a
rollback is incomplete. For manually dispatched CI, checkout and verify the
actual tag commit rather than merely using the supplied tag as an artifact label.
When a server protocol change requires a newer terminal, have the client declare
the supported protocol version and make the server reject older clients with an
explicit minimum-version response. Never let an old client appear connected with
an incomplete local catalog.

## GitHub connection preflight

Validate both Git transport and API access before mutating release versions.
Treat read-only repository access as insufficient proof that a release can be
pushed, and require remote `main` to be an ancestor of local `main`.

**Why:** A healthy OAuth API connection can coexist with invalid Git push
credentials, while workflow-file writes may be unavailable through the API
proxy. Diverged branches then turn an otherwise routine release into a manual
overlay.

**How to apply:** Before a release, fetch GitHub `main`, run a dry-run push, and
fail before version changes if either check fails. Keep native compilation,
portable-lockfile checks, signing-secret preflights, and published-asset
verification in the GitHub workflow itself.

## Android APK signing
Release APKs are signed in CI: `apksigner` + `zipalign` from the newest
build-tools, using a PKCS12 keystore (alias `globipos`) stored base64 in repo
secrets. **Why:** unsigned release APKs cannot be installed normally, and future
versions must use the same signing identity or devices require reinstalling.
Never regenerate the keystore casually.
Signed assets are named `app-{abi}-release-signed.apk`.

## Release download cache

Treat persisted GitHub release metadata as an optional resilience layer, not a
dependency of the live release lookup.

**Why:** Production schema drift can leave the cache table unavailable even
while GitHub releases and their signed installer assets are healthy. Failing the
whole request on cache read/write hides valid downloads from administrators.

**How to apply:** Isolate cache read and write failures from the verified GitHub
request. Continue with live verification when cache reads fail, and return a
successful verified response even when persisting it fails.
