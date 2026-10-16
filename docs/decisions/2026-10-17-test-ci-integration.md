# Complete test/CI configuration without importing unfinished features

- **Date:** 17 October 2026 (Europe/Nicosia).
- **Status:** implemented; syntax/configuration validated only, execution not verified.
- **Issue:** https://github.com/chrlazarides/globipos/issues/9
- **Branch:** `chore/9-test-ci-integration`, dependent on the two engineering branches.
- **Direction:** Chris approved test/CI-only integration, then “dont stop lets finish it”.

## Decision

Finish the useful configuration rather than waiting for all application
branches to be merged. Keep application logic, schemas, existing tests and
protected financial/native/fiscal code unchanged.

### Unit and API tests already on main

Add `test:unit` for the back office and `test:api` for the API. The shared test
runner discovers every existing source test (4 and 32 files respectively),
including TSX; it does not select a convenient passing subset. Future files in
the source and tests directories are also discovered.

The already locked API esbuild dependency bundles the tests while leaving
third-party packages external and resolving them from their original package
scope. Raw source reads alongside test entries and legacy migration paths are
preserved. Back-office shared schema imports keep the browser-safe contract.
No dependency, lockfile, compiler option or existing test is changed.

API tests use a temporary PostgreSQL cluster with a private Unix socket and TCP
disabled. Generate schema DDL from this checkout into a temporary directory;
apply it and the existing auxiliary migration fixtures **only to that disposable
cluster**. Seed synthetic accounting prerequisites, then clone a separate test
database for every file. Never run DB push, inherit a live connection string or
start the real server/PDA/native application. Cleanup stops the cluster and
removes temporary files. No database is created or SQL executed during this
syntax-only configuration task.

A child receives a minimal test environment, not parent cloud/email/GitHub
credentials; `dotenv/config` is pointed at an empty temporary file.
Errors, timeouts, missing tests, failing assertions, skipped tests,
TODOs and cancelled tests all fail the runner. Known baseline failures are not
filtered out or converted to passes.

CI provisions PostgreSQL test binaries when unavailable. These are runner-local
tools, not a shared-database operation or a new application dependency.

### Three missing workflow definitions

Add the existing native-printer, PDA-scanner and retail-icons workflow bodies,
with their test/build step lists unchanged. Add a cheap applicability job:

| Checkout state | Result |
|---|---|
| Entire feature source absent | Explicit **NOT VERIFIED** summary; test job skipped |
| Source present, but required tests/root scripts/dependencies incomplete | Applicability job fails; no test pass |
| Source and inputs present | Run the original test steps without weakening assertions |
| Native workflow on a public repository | Preserve private-only guard; explicitly not verified |

The PDA and retail filters include their own workflow/readiness script and
relevant source/configuration paths. Existing manual/push/PR triggers remain.
Native printer builds remain **manual and private-only**, not automatic PR
builds. GitHub has no path filter for manual dispatch. Existing native release,
tag and signed-release workflows are not changed here.

Include the existing branding composite action as workflow configuration.
Its newer `scripts/pos-package-branding.py` helper is not imported into this
release base. The native applicability check refuses a partially installed
feature without that helper. No public-source access guard is removed.

These applicability jobs are **not testing substitutes** and must not be
required as evidence of feature acceptance. No product feature is declared
complete because its source is absent.

## Verification

- YAML/JSON/JavaScript/Bash syntax and configuration structure: checked.
- Existing three suite step lists: compared to the development workflow
  definitions to ensure test commands/assertions were not changed.
- Application source, existing tests, protected files, schema, dependencies and
  lockfile changes: none. Package manifests change test scripts only.
- Back-office/API test execution, database fixture execution, generated-client
  drift execution, browser suites, native builds and GitHub run results:
  **NOT VERIFIED / NOT RUN**, under the original syntax-only work limits.
- No merge, PR-triggered build, migration on a shared database, deployment,
  publishing, release or `.agents/memory/` edit performed.

## Remaining actions and rollback

Chris reviews the engineering branches in order, then configures the required
**Required Back office / API CI** status after observing it on a PR.
Actual GitHub CI execution is still needed to confirm test results; syntax is
not proof of a passing test suite.

PDA/Retail runtime coverage becomes applicable when Chris's reviewed source
branches bring those features and their original test helpers/scripts to main.
Native physical printer acceptance and private build execution remain separate.
No additional application scope was taken here.

Rollback: reviewed revert of the configuration/test-script commit; no data or
schema rollback is needed. Preserve or update any required-status setting
alongside a workflow revert so it does not refer to a removed status.
