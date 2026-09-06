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

## Android APK signing
Release APKs are signed in CI: `apksigner` + `zipalign` from the newest
build-tools, using a PKCS12 keystore (alias `globipos`) stored base64 in repo
secrets. **Why:** unsigned release APKs cannot be installed normally, and future
versions must use the same signing identity or devices require reinstalling.
Never regenerate the keystore casually.
Signed assets are named `app-{abi}-release-signed.apk`.
