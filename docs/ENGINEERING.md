# GlobiPOS Engineering & Release Handbook

## Golden rules

1. Nothing reaches `main` without a linked issue, pull request, green applicable CI and Chris's approval.
2. Every change starts from one issue, targets one app and uses a `type/issue-short-name` branch. Shared/cross-app exceptions require written issue approval.
3. Production runs only reviewed, immutable tagged versions. No production build from an untagged development branch.
4. Every release has a tested rollback to a known tagged version, including database compatibility and recovery of pending POS transactions.
5. Financial, fiscal and schema changes require Chris's review. CODEOWNERS covers pricing, payments, fiscal, loyalty, credit, vouchers and device trust as well as schemas/migrations.
6. Agents never merge, publish, deploy, release or migrate without Chris's explicit written approval in the issue. The same approval boundary applies to protected logic, local Rust/native compilation and exceptions to the one-day dependency release age.
7. Backups are restore-tested monthly in an isolated environment. Record the date, target, restore result and recovery time; possession of an export is not proof of recovery.
8. Never include secrets, till credentials, personal customer data or generated native/browser caches in commits or issue attachments.

## Change flow

**Issue → branch → PR → CI → Chris approves → merge → version tag → staging → production.**
Use pilot shops first. Verify the tag, configuration, backup and rollback before staging or production. Record pilot results and obtain production approval; a green build is not permission to release.
Use the issue templates and `.github/pull_request_template.md`. Each PR records scope, reasons, app, commands/results, risk, financial/fiscal/schema impact and rollback.
Run only the changed app's quick typecheck/unit checks locally; CI owns broader checks. Record unavailable tests as **not verified**, never as passes.

## Versions and commits

Each product has its own semantic version (`MAJOR.MINOR.PATCH`): breaking changes, compatible features, fixes respectively.

| Product | Intended tag |
|---|---|
| Back office | `backoffice-v1.2.3` |
| API | `api-v1.2.3` |
| POS web/PWA | `pos-web-v1.2.3` |
| POS native | `pos-native-v1.2.3` |
| PDA | `pda-v1.2.3` |

These are the handbook's target tag namespaces, **not newly enabled release triggers**.
The existing native release/verification workflows still require legacy `v*` tags. Do not create a `pos-native-v*` release until Chris approves a separate compatibility change to those workflows, version checks and updater routing. Existing tags stay immutable; never retag a shipped version.
The back office/API currently share their stable app version. Preserve that behaviour until an explicitly approved version split. Keep a clear version for each back-office upgrade, not for rebuilds, backups or restores.
Follow `.agents/skills/publish-pwa-tauri/SKILL.md` when integrated: web publishing and signed native updates are separate approval paths.

Use Conventional Commits, e.g. `fix(api): reject duplicate invoice retries`, `feat(backoffice): add stock filter`, `chore(ci): scope workflow inputs`, `docs(engineering): record release policy`. Include the issue in the PR (`Closes #123`); approvals must be on the issue, not inferred from a commit message.

## Run and quick checks

Install workspace dependencies with Node 24 / pnpm 10.26.1 and `pnpm install --frozen-lockfile`. The workspace already enforces `minimumReleaseAge: 1440`; do not change it. Native `pos-app` has its own npm lock and is not a pnpm member.

| Product | Development | Quick checks |
|---|---|---|
| Back office / eShop / PDA web | `pnpm --filter @workspace/globipos run dev` | `pnpm --filter @workspace/globipos run typecheck`; `pnpm --filter @workspace/globipos run test:unit` |
| API | `pnpm --filter @workspace/api-server run dev` | `pnpm --filter @workspace/api-server run typecheck`; `pnpm --filter @workspace/api-server run test:api` |
| POS PWA | `pnpm --filter @workspace/globipos-terminal run dev` | `pnpm --filter @workspace/globipos-terminal run typecheck` and `pnpm --filter @workspace/globipos-terminal run test` |
| Mockups | `pnpm --filter @workspace/mockup-sandbox run dev` | `pnpm --filter @workspace/mockup-sandbox run typecheck` |
| Native frontend only | `npm --prefix pos-app run dev` | `npm --prefix pos-app run typecheck`; existing focused TS tests if a runner is supplied |
| Shared libraries | No standalone server | `pnpm exec tsc --build lib/<package>/tsconfig.json`; existing unit script |
| Scripts | `pnpm --filter @workspace/scripts run hello` | `pnpm --filter @workspace/scripts run typecheck`; e.g. focused `node --test scripts/pos-version.test.mjs` when relevant |

Shared library declarations must be built before consuming-app checks. Limit the project list to that app's dependency closure. Do not use a whole-workspace gate as the default local quick check.
Dedicated mobile source/package and modern native browser harnesses exist on development branches, not this release base. `pda-app` / `customer-app` are not independently runnable source packages here; do not create replacement apps for them.

## CI scope and gaps on the chosen base

This configuration branch starts at GitHub `main` (`9e1d485`), not an unfinished feature branch.
Only configuration/documentation is added. No application/test source or dependency manifests are imported.

- **Back office/API:** `ci-web-api.yml` always reports on PRs and `main` pushes. A small dependency-free detection job checks the relevant paths first. Only applicable changes install with the frozen lock, cache pnpm, follow shared dependency/consumer paths, build affected library declarations, check affected apps, run existing lint/unit/API scripts, build affected apps and check generated OpenAPI client/Zod drift (including new/deleted files). Unrelated changes skip all that work. It never runs a DB push. Node 24 and the workspace's installed pnpm 10.26.1 are pinned for repeatability.
- **Existing unit/API tests wired:** the back office now has `test:unit` and the API has `test:api`, both using `.github/scripts/run-workspace-tests.mjs`. All 4 back-office and 32 API source test files on this base are discovered automatically; no assertions or source tests are changed. Future test files are also discovered. API tests get one disposable Unix-socket-only PostgreSQL database per file, copied from a synthetic fixture; no shared database credentials are inherited. Source-relative reads are preserved, package dependencies are resolved from their owning workspace, and failed/timed-out/empty/skipped/TODO test files fail the gate. No lint script exists: lint remains explicitly **not verified**, not a pass. Actual test results remain **not verified** until CI is run.
- **POS build:** PR paths cover native source, its shared POS libraries, release/branding helpers and its own workflow. Existing tag/manual release triggers and all jobs remain unchanged.
- **POS CI:** push/PR paths include native source, shared POS libraries and the branding helper used by its smoke build. Existing jobs, advisory checks and tests are unchanged.
- **Terminal browser scale:** adds scoped PR/`main` push paths; weekly schedule/manual triggers remain. Its test command is unchanged. Schedules cannot be path-filtered by GitHub.
- **Verify POS release:** manual-only on this base. `workflow_dispatch` does not support `paths`; it remains manual, with no unsolicited published-release checks.

Three requested workflow definitions are now included without importing unfinished application source. Each has an explicit applicability job: absent feature source means **NOT VERIFIED; test job skipped**, never “tests passed”. If feature source is present but a required test/script/dependency is missing, applicability **fails**, rather than quietly skipping it. The existing test job steps are preserved unchanged.

| Workflow | PR/push path scope and current execution boundary |
|---|---|
| `native-printer-tests.yml` | Existing manual/private-only operation preserved; `paths` cannot apply to manual dispatch. On this public repository its native test job remains skipped/not verified. In a private checkout, simulation source and the existing packaging helper must be present before the unmodified build steps run. |
| `pda-scanner-browser.yml` | Scanner/PDA components/pages/test helpers, shared UI hooks/lib/router/styles, artifact configuration, generated API libraries and root package/lock/workspace/tsconfig, its own workflow/readiness helper; manual trigger preserved. The newer PDA workspace source is absent on this base, so the browser job is skipped/not verified. |
| `retail-icons.yml` | Retail source, local fonts, retail tests, native manifests, shared layout library, root package/lock/workspace/tsconfig, its own workflow/readiness helper; existing push/PR branches and manual trigger preserved. Retail source is absent on this base, so the browser job is skipped/not verified. |

This completes workflow configuration, **not runtime verification** or integration of the missing features. The new suite jobs cannot start with missing inputs; applicability jobs perform no builds, tests or device operations. Do not remove these checks, supply placeholder tests, or claim the skipped suites are green test results. The native branding composite action is configuration only; its newer validation helper is still required from the approved source branch before a private native run.

## GitHub settings Chris must configure

- Main branch rules: require PRs, required applicable green status checks, CODEOWNERS approval and resolved conversations; prevent force pushes/deletion and restrict bypasses.
- Require **Required Back office / API CI**, the always-reporting aggregate, rather than the conditional **Back office / API quick gate**. It passes only when detection succeeds and either the applicable quick gate succeeds or the quick gate is legitimately skipped for unrelated paths. Detection errors and failed, cancelled or unexpectedly skipped applicable jobs do not pass. Wait for this status to appear on a GitHub PR before selecting it in the main ruleset.
- Other POS/browser workflows remain trigger-path-filtered: do not require them universally without their own always-reporting gates or appropriately scoped rules. This follow-up fixes the web/API required status only; it does not claim that POS gates are aggregated.
- GitHub does not accept an author's own review as CODEOWNERS approval. If Chris authors the PR himself, agree a second trusted reviewer or use an authorised integration-authored PR; never silently bypass the rule.
- Create the GitHub Projects board (Backlog / Ready / In progress / Review / Done), labels `app:*` (POS, Back office, API, PDA, Native, eShop, Mobile), `type:bug|feature|chore`, `risk:financial|fiscal|schema|none` and `risk:low|medium|high`. Use `none` alone. Create a first milestone, **Engineering foundation**, and link issues/PRs. This setup request has no supplied issue number; Chris should link its tracking issue before review.
- Set release environment protections for staging/production, pilot acceptance and rollback evidence. These policy controls are not enabled merely by merging this document.

## Database and rollback

Production schema changes use reviewed, versioned migrations, never ad-hoc schema push.
Use **expand then contract**: add compatible structures first, deploy compatible readers/writers, verify/backfill only with approval, then remove old structures in a later release after old versions are retired.
Take and verify a backup before **every** migration. Rehearse migration and rollback on isolated restored data, record checks and loss risks, and confirm the rollback version can read the resulting schema.
Agents do not run migrations or `db push` against shared databases. A generated migration or a green CI run is not execution approval. Never reinterpret an approval to prepare migration files as permission to apply them.

## Records

Use [decisions/](decisions/) for accepted decisions and alternatives, and [incidents/](incidents/) for incidents and prevention. Record dates/times in Europe/Nicosia when presenting local operations.
The [memory consolidation proposal](decisions/memory-consolidation-proposal.md) is review-only: no `.agents/memory/` files are edited or removed.

## Step 1 verification and rollback

Only YAML/config/JavaScript syntax and configuration structure are checked in this step. No application typechecks/tests/builds, browser suites, Rust/native builds, migrations, release or deploy is run. CI runtime success and generated-client cleanliness remain **not verified** until the relevant GitHub PR workflow runs.
Rollback is a normal reviewed revert of this configuration commit; no data or schema rollback is necessary.

The required-status follow-up is tracked in [GitHub issue #8](https://github.com/chrlazarides/globipos/issues/8) and [the CI decision](decisions/2026-10-17-required-web-api-gate.md). Its branch depends on `chore/engineering-step-1`; review its incremental diff against that branch until Chris merges Step 1.

The approved test/CI-only integration is [GitHub issue #9](https://github.com/chrlazarides/globipos/issues/9). The [initial dependency report](decisions/2026-10-17-test-ci-integration-blocker.md) records the source mismatch; the [continuation decision](decisions/2026-10-17-test-ci-integration.md) records the completed configuration and its explicit verification limits.
