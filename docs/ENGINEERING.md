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

Use Conventional Commits, e.g. `fix(api): reject duplicate invoice retries`, `feat(backoffice): add stock filter`, `chore(ci): scope workflow inputs`, `docs(docs): record release policy`. Include the issue in the PR (`Closes #123`); approvals must be on the issue, not inferred from a commit message.

## Run and quick checks

Install workspace dependencies with Node 24 / pnpm 10.26.1 and `pnpm install --frozen-lockfile`. The workspace already enforces `minimumReleaseAge: 1440`; do not change it. Native `pos-app` has its own npm lock and is not a pnpm member.

| Product | Development | Quick checks |
|---|---|---|
| Back office / eShop / PDA web | `pnpm --filter @workspace/globipos run dev` | `pnpm --filter @workspace/globipos run typecheck`; run its unit script when supplied |
| API | `pnpm --filter @workspace/api-server run dev` | `pnpm --filter @workspace/api-server run typecheck`; run unit/API scripts when supplied |
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

- **Back office/API:** `ci-web-api.yml` returns a required status on every PR; a cheap path check skips actual app work outside the relevant paths. The final gate fails if path detection or applicable checks fail/cancel. Relevant `main` pushes also run it. It installs with the frozen lock, caches pnpm, follows shared dependency/consumer paths, builds affected library declarations, checks affected apps, runs existing lint/unit/API scripts, builds affected apps and checks generated OpenAPI client/Zod drift (including new/deleted files). It never runs a DB push. Node 24 and the workspace's installed pnpm 10.26.1 are pinned for repeatability.
- **Current test-script gap:** on this base the back office and API have no unit/API `test` scripts and no lint scripts. CI explicitly reports these as **not verified**; it does not invent or import tests. When their existing development scripts are integrated, `test`, `test:unit`, `test:api`, `test:server`, `test:agoranomia` and `test:cashier-pin` are recognised. Browser/native suites are not run by this quick gate.
- **POS build:** PR paths cover native source, its shared POS libraries, release/branding helpers and its own workflow. Existing tag/manual release triggers and all jobs remain unchanged.
- **POS CI:** push/PR paths include native source, shared POS libraries and the branding helper used by its smoke build. Existing jobs, advisory checks and tests are unchanged.
- **Terminal browser scale:** adds scoped PR/`main` push paths; weekly schedule/manual triggers remain. Its test command is unchanged. Schedules cannot be path-filtered by GitHub.
- **Verify POS release:** manual-only on this base. `workflow_dispatch` does not support `paths`; it remains manual, with no unsolicited published-release checks.

Three requested workflows are **absent from GitHub main** and are not imported from unfinished application branches. Their filter changes are pending integration of their existing workflow + tested source together:

| Pending workflow | Required PR/push path scope, plus its own workflow path |
|---|---|
| `native-printer-tests.yml` | `pos-app/**`, `lib/pos-layout/**`, `lib/pos-terminal-core/**`, `scripts/pos-*`, `scripts/pos_*`, `.github/actions/check-pos-package-branding/**`; preserve its existing manual-only operation (no `paths` option for manual dispatch) |
| `pda-scanner-browser.yml` | `artifacts/globipos/src/components/barcode-scanner.tsx`, `artifacts/globipos/src/components/pda/**`, `artifacts/globipos/src/pages/pda-*.tsx`, `artifacts/globipos/tests/pda-*.mjs`, scanner imports/config, `lib/**`, root package/lock/workspace/tsconfig; preserve manual trigger |
| `retail-icons.yml` | `pos-app/src/retail/**`, `pos-app/src/assets/fonts/**`, `pos-app/tests/multi-device/retail-*`, `pos-app/package*.json`, `lib/pos-layout/**`, root package/lock/workspace/tsconfig; preserve push/PR branches and manual trigger |

This is a documented base mismatch, not three completed CI checks. Do not enable workflows that reference missing test scripts, and do not bring application changes into this branch just to satisfy their presence.

## GitHub settings Chris must configure

- Main branch rules: require PRs, required applicable green status checks, CODEOWNERS approval and resolved conversations; prevent force pushes/deletion and restrict bypasses.
- The new status name is **Back office / API quick gate**. Path-filtered workflows do not report on unrelated PRs: making one universally required can leave docs-only PRs waiting. Use an approved always-reporting aggregation gate before requiring these checks universally, or scope required rules to their applicable changes. No such aggregator is claimed to exist in this step.
- GitHub does not accept an author's own review as CODEOWNERS approval. If Chris authors the PR himself, agree a second trusted reviewer or use an authorised integration-authored PR; never silently bypass the rule.
- Create the GitHub Projects board (Backlog / Ready / In progress / Review / Done), labels `app:*` (POS, Back office, API, PDA, Native, eShop, Mobile), `type:bug|feature|chore`, `risk:financial|fiscal|schema|none` and `risk:low|medium|high`. Use `none` alone. Create a first milestone, **Engineering foundation**, and link issues/PRs. This setup request has no supplied issue number; Chris should link its tracking issue before review.
- Set release environment protections for staging/production, pilot acceptance and rollback evidence. These policy controls are not enabled merely by merging this document.

## Project monitoring

This monitors the **development project**, not production infrastructure.
Production monitoring remains in `docs/deployment-and-monitoring.md`; do not duplicate it here.

- **Weekly project report:** Fridays at 07:00 Europe/Nicosia, or manually. Two UTC cron entries (04:00 DST / 05:00 winter) are offset-gated so only one posts. GitHub scheduling can be delayed; the gate checks the seasonal offset, not the actual start-hour.
- The last seven days' merged-main PRs are grouped by app, with linked issues and warnings for missing links. Explicit CODEOWNERS paths (not the catch-all default) identify protected changes, including renamed-from paths. Open PRs and `in-progress` issues warn after seven days.
- Quality counts retained GitHub run attempts started in the reporting period, including old runs rerun this week. It warns on any failed main attempt or pass rate below 90%. Neutral, skipped, cancelled and unfinished attempts are not classified as passes/failures.
- Releases show the latest product tag (including legacy native `v*`) and PRs whose merge commits are in tag→main history. Shared library/workspace changes count for each product. Unreleased work older than 14 days warns; diverged/unavailable comparisons are **not verified**, not zero.
- The report uses only `GITHUB_TOKEN` with contents/PR/actions read and issues write. Security alerts are optional: inaccessible Dependabot/secret-scanning data says **not available**, never zero. No secret values, PR/issue titles/bodies, customer data or health response bodies are posted. `HEALTH_URLS` accepts comma-separated HTTPS origins; credentials/query parameters are rejected, and only `/api/healthz` status is checked.
- It creates a `weekly-report` issue before closing previous bot-authored weekly reports. For a personally owned repository it assigns the owner, giving Chris an assignment notification. GitHub email delivery still depends on his notification settings.
- **PR guard:** every PR needs `Closes #N`, `Fixes #N` or `Refs #N` plus a Conventional Commit title with scope `pos`, `backoffice`, `api`, `pda`, `native`, `eshop`, `mobile`, `lib`, `db`, `ci`, `docs` or `deps`. Only Dependabot is exempt from the issue link. Guard policy comes from the base branch; fork/PR code is not executed by it.
- **Board automation:** new issues and PRs are added to Projects v2. Missing `PROJECT_TOKEN` or `PROJECT_URL` skips the add job with a notice. The token-bearing `pull_request_target` workflow never checks out or runs PR code; it invokes a pinned action only.
- **Dependabot:** grouped weekly workspace, Cargo and Actions updates, labelled `deps`, with a one-day version-update cooldown. Existing pnpm `minimumReleaseAge: 1440` and its allowlist stay unchanged. GitHub does **not** apply cooldown to security updates: those PRs must still wait until the one-day policy is satisfied, or have Chris's written exception. Nothing auto-merges.
- Offline fixture tests: `node --test scripts/tests/project-monitoring.test.mjs` (no network). The weekly workflow runs these before posting. Setup-task local validation is syntax-only; no application/browser/native suite is required.

### Manual setup for Chris

- [ ] Create the Projects v2 board with app/type/risk fields or labels and a first milestone; set repository variable `PROJECT_URL` to its URL.
- [ ] Create a fine-grained token for the correct project owner with **Projects read/write**, selected-repository **Issues read** and **Pull requests read**. Save it as repository secret `PROJECT_TOKEN`. Never paste it into an issue, file or chat. Owner/organization policy may require token approval.
- [ ] Create labels `deps` and `in-progress` (plus the app/type/risk labels); `weekly-report` is created automatically by the workflow.
- [ ] Set repository variable `HEALTH_URLS` to comma-separated HTTPS origins, or leave unset to skip health checks.
- [ ] Enable Dependabot alerts and secret scanning where the repository plan permits. `GITHUB_TOKEN` may still lack alert-read permissions: the report explicitly says **not available** rather than requesting broader credentials.
- [ ] After merging this configuration through review, add **PR guard** and **Back office / API quick gate** as required main-branch status checks. Require PRs and CODEOWNERS review, forbid force pushes, and retain Chris's approval requirement.
- [ ] Watch repository Issues and enable GitHub email notifications; run **Weekly project report** manually once after merge to confirm report/notification delivery.

## Money-path tests

Run `node scripts/test-money-paths.mjs` (Node 24, installed frozen workspace dependencies).
The **Money-path tests** job in the back-office/API workflow runs for relevant PR
changes to native/PWA POS, back office, API, shared libraries and the tests themselves.
Tests use production functions, sample-only fixtures, a fixed clock and blocked
network access. No Rust compilation, shared database, migration or browser is needed.

Coverage includes sale/discount/void totals, the golden basket, Cyprus included VAT,
explicit invoice net/included bases, existing levels/contracts/promotions, tender
and card-result validation, rewards/credit policy, receiving-service retry/rollback,
canonical bill replay validation and offline sync-controller restart/recovery.
The test fixtures and runner are CODEOWNERS-protected.

Known failures are **explicit skips, not passes**. Use
`MONEY_KNOWN_FAILURES=1 node scripts/test-money-paths.mjs` to execute their original
desired assertions. Chris decides fixes; re-enable each test when its fix is reviewed.
See [Money-path coverage and findings](../tests/money-paths/README.md) for the
quarantine list and gaps: real PostgreSQL transaction/concurrency checks for stock
and shared balances, actual IndexedDB crash recovery, and rendered receipt/A4/report
comparisons. This unit gate alone is **not** a live-store release certification.
After merging through review, Chris should add **Money-path tests** to required checks.

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
