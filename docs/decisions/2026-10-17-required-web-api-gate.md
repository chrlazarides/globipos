# Always-reporting Back office/API required status

- **Date:** 17 October 2026 (Europe/Nicosia).
- **Status:** accepted for implementation after Chris's “go on” and “OK”; GitHub execution and branch-protection configuration still need review.
- **Issue:** https://github.com/chrlazarides/globipos/issues/8
- **Branch:** `chore/8-required-web-api-gate`, based on the unmerged `chore/engineering-step-1`.

## Decision and why

Run a cheap change detector on every PR and main push, then conditionally run
the existing web/API quick gate. Always run a final, stable
**Required Back office / API CI** status.

Trigger-level path filters suppress a workflow entirely on documentation-only
changes. If such a workflow is universally required, GitHub can leave the PR
waiting. Move this workflow's path selection inside the workflow instead.
Do not install dependencies or run application checks for unrelated changes.

## Result rules

| Detection | Applicable? | Quick gate | Required status |
|---|---|---|---|
| success | yes | success | success |
| success | yes | failure, cancelled or skipped | failure |
| success | no | skipped | success (not applicable) |
| success | no | any other result | failure |
| failed, cancelled or skipped | unknown | any | failure |
| success | missing/invalid output | any | failure |

A cancelled workflow cannot be used as evidence of a green check.
Detection compares all changed Git paths, includes both sides of renames, and
fails on invalid references or Git errors. A first push requires all web/API
checks. Changes to either CI script or the workflow also require all these checks.

## Alternatives

- Keep a path-filtered workflow universally required: rejected because unrelated
  PRs can wait indefinitely.
- Run all application checks for all PRs: rejected as unnecessarily costly.
- Poll other workflows through GitHub's API: unnecessary complexity for this
  scoped follow-up; direct job dependencies give the required outcomes.

## Scope, verification and rollback

Configuration/documentation only. The existing lint/test/build/codegen commands
are unchanged. No app code, existing tests, database/schema, financial/fiscal
logic, native workflow, release trigger or memory file is changed.
Only YAML/JavaScript/Bash syntax and configuration structure are validated
locally. Actual GitHub routing, docs-only execution and failure propagation are
**not verified** until reviewed on GitHub; no native/browser/app check is run here.

Chris selects the new required status after it has appeared on a PR.
Until Step 1 is merged, compare this branch against `chore/engineering-step-1`,
not main, to review just this follow-up. No agent merge or release.
Rollback: a reviewed revert of this follow-up; remove/replace the required
status in GitHub settings at the same time to avoid requiring a nonexistent check.
