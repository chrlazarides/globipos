---
name: GitHub Action annotated tags
description: How to avoid pinning GitHub Actions to annotated tag objects instead of commits.
---

When resolving a GitHub Action version tag, use the peeled `refs/tags/<tag>^{}` value when the tag is annotated. The unpeeled tag object may be a 40-character hash and may download successfully, but it is not a commit SHA.

**Why:** Commit-based auditing and GitHub's commits API reject annotated tag object IDs, so checking only the hash length or the first `git ls-remote` result gives false confidence.

**How to apply:** After resolving action versions, verify every pinned hash through the repository's commits API or otherwise confirm its Git object type is `commit`.