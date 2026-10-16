# Initial test/CI dependency review — superseded continuation

**Update, 17 October 2026:** Chris asked “dont stop lets finish it”. The source
findings below remain accurate for the release base, but the initial decision
to stop all configuration work is superseded by
[the test/CI continuation](2026-10-17-test-ci-integration.md).
That continuation adds unit/API runners for the tests already on main and
applicability-gated workflow definitions; it does not import the missing
application features or claim unrun suites passed. The following is the
historical review before those changes.

- **Date:** 17 October 2026 (Europe/Nicosia).
- **Status:** blocked at the approved application-source boundary; not completed.
- **Issue:** https://github.com/chrlazarides/globipos/issues/9
- **Approval:** Chris chose “Approve test/CI-only integration (recommended)”.
- **Branch:** `chore/9-test-ci-integration`, based on
  `chore/8-required-web-api-gate`, itself based on `chore/engineering-step-1`.
- **Release base inspected:** GitHub main `9e1d485da1ac9e8f4c4f17592f148199a5ef4df4`.

## Scope and decision

Prepare test/workflow configuration only. Do not import unfinished application
history, change application logic, weaken existing tests or run native/browser
builds. Stop if the integration requires application-source changes.

Inspection found that the missing workflow files cannot all be enabled safely
on the selected base. **No incomplete workflow or test script is added by this
follow-up.** This branch records the evidence and the dependency order.
It does not claim that test coverage or CI execution has been restored.

## Dependency findings

| Workstream | Evidence | Status |
|---|---|---|
| Native printer workflow | The development workflow bundles `pos-app/src/simulation/samples.ts` and uses `.github/actions/check-pos-package-branding`. Neither exists on main. It is also guarded by `github.event.repository.private`, while this repository is public. | Blocked: copying the YAML alone leaves missing dependencies and would not execute its private-only job here. Preserve that privacy boundary; do not remove the guard. |
| Retail icons | `pos-app/src/retail/` and `pos-app/tests/multi-device/retail-icons.browser.mjs` do not exist on main. The development workflow calls a root `test:retail-icons` script also absent there. | Blocked: the actual layout/application source must be reviewed first. Do not add a passing placeholder or copy only the test entry point. |
| PDA scanner browser | The development workflow calls `test:pda-scanner:chromium` and `test:pda-scanner:webkit`; main has neither script nor `artifacts/globipos/tests/pda-workspace.browser.test.mjs`. That harness imports further test helpers. | Not integrated. The complete helper/application compatibility review was not finished after the source-boundary stop. This is not proof that PDA requires an application-code change. |
| API server tests | Main has 32 existing `src/**/*.test.ts` files but no test script. The development `tests/run-server.mjs` directly loads `scripts/backoffice-version.mjs`, starts the PDA fixture through `src/pda-workspace/schema.ts` and assumes newer shared-library paths; those targets are absent on main. | The development runner cannot be copied unchanged. A runner adapted to main is possible test-infrastructure work, but was not built or verified in this stopped integration. No tests are silently excluded. |
| Back-office tests | Main has four existing test files, including a TSX rendering test with a source-file-relative read. No unit-test script exists. | A source-layout-preserving runner is still needed. A naive relocated bundle would not be adequate. Existing assertions remain unchanged. |

The missing application dependencies were checked with Git tree queries against
the release base, not inferred from absent `node_modules`. No dependency install
can supply repository application files that are missing from that tree.

## Safe continuation order

1. Chris reviews the application branches that contain the missing native
   simulation and Retail Standard source. Merge only through the approved
   issue/PR/release process, or approve a separate, bounded source-integration
   issue. This CI-only approval does not authorise those source changes.
2. Decide where the private-only native printer build belongs. Preserve its
   existing test body and access guard; do not make private-source test builds
   public merely to obtain a green status.
3. On the resulting agreed base, integrate each workflow with all its required
   existing test helpers and entry-point scripts. Apply the path scopes in
   `docs/ENGINEERING.md`; preserve manual/tag/release triggers and assertions.
4. Adapt the API/Back-office runners to that base. Database tests must use
   disposable isolated fixtures with no inherited live credentials, not shared
   schema push. Retain all existing tests; report baseline failures rather than
   omitting them.
5. Obtain approval for runtime verification. The current task still permits
   syntax/configuration validation only, not local browser/native runs.

The API and Back-office runner work is not inherently dependent on merging all
application branches; it can be separately scoped on main if Chris prefers.
It remains unfinished here, rather than being labelled an application defect.

## Verification and rollback

- Read-only dependency/manifest inspection: completed.
- Application code, schema, financial logic and existing tests changed: **none**.
- New runnable test/workflow configuration added in this follow-up: **none**.
- API/Back-office tests, browser suites, Rust/native builds and CI execution:
  **not run**, as required; no pass is claimed.
- Shared database changes, migrations, releases, publishing and merges: **none**.
- `.agents/memory/` files: untouched.

Rollback is a reviewed revert of this documentation-only commit; no data or
schema rollback is needed. This branch is for reviewing the integration blocker,
not a release candidate or a completed test integration.
