# Money-path test audit

**Date:** 17 October 2026, Europe/Nicosia  
**Decision at audit:** Audit and reuse existing coverage before proposing additional tests; wait for Chris's approval.  
**Scope:** Source inspection only. No tests, builds, migrations or application changes were performed for this audit.

**Approved follow-up:** Chris subsequently approved tests only for demonstrated
gaps, with no application fixes. The original audit below remains a source review;
execution results for the approved additions are recorded at the end.

## Sources and branch boundaries

The existing suites are spread across branches. A test absent from the engineering branch is not necessarily missing from GlobiPOS.

| Reference inspected | Commit | Meaning |
|---|---|---|
| `chore/engineering-step-1` | `eacb6e5` | Base of the new money-path branch; lacks several later feature tests. |
| `feat/item-uom` | `1eb5331` | Current main workspace; primary source for the existing assertions below. |
| `feat/multi-device` | `b54f582` | Separate Phase 6 worktree, including additional settlement, refund and session-report tests. |
| `hotfix/promo-mix-match-sets` | `47ac051` | Separate promotion hotfix worktree with its own regression tests. |

Paths below are relative to the repository root **on the branch containing the file**. Branch labels indicate observed availability, not identical file contents or passing results:

- **E:** Present on the engineering base as well as the current workspace.
- **F:** Present in the current feature workspace; do not assume available on the engineering base.
- **P6:** Additional coverage inspected specifically in the Phase 6 worktree.
- **H:** Separate promotion hotfix branch.

The newly added `tests/money-paths/` suite is **not counted as pre-existing coverage**. It is already on an unmerged review branch; this audit neither removes it nor approves it. Its overlap is addressed below.

## Coverage map

| Area | Existing tests and what their assertions cover | Gaps / reuse decision |
|---|---|---|
| Sales totals and quantities | **E:** `artifacts/globipos-terminal/src/lib/pos-calculations.test.ts`: configured level, quantity-driven totals/VAT, cash validation. `pos-app/tests/department-grocery.test.ts`: cents entry, department amounts, VAT inheritance, mixed/discounted lines, scale quantities. `pos-app/tests/grocery-bill-sync.test.ts`: reconciliation with the actual upload validator. **F:** `pos-app/tests/multi-device/golden-sale.test.ts`: golden basket, fractional quantity, VAT flags and milk-only discount. | Reuse these, rather than create another golden-sale or elementary quantity suite. Golden-sale contains an explicit conditional `todo` when amounts differ: its existence is not proof the gate passed. Establish the target branch and runner before extending coverage. |
| Line/bill discounts, overrides and rounding | **E:** `pos-app/tests/grocery-bill-sync.test.ts` explicitly checks native discounts, override prices, voids, surcharges and penny VAT. `pos-app/tests/department-grocery.test.ts` checks discounted/mixed VAT. **F:** `pos-app/tests/multi-device/promotion-cents.test.ts` checks proportional cent allocation, remaining units, order-discount reversals and deterministic return/rounding cases. | Do not duplicate pure discount arithmetic. A complete role/permission and UI entry-point matrix is not established by these arithmetic tests alone; compare with the existing register parity harness before proposing missing cases. |
| Refunds, exchanges and voids | **F:** `artifacts/api-server/src/native-promotion-returns.test.ts`: mixed VAT, tampering, over-return prevention, identical retry acknowledgements, cross-path return history and final charged cents. `pos-app/tests/multi-device/promotion-cents.test.ts`: frozen-price partial returns, duplicates, fractions and order-discount reversal. **P6:** `pos-app/tests/multi-device/refund-paid-amount.test.ts`: successive weighed partial refunds and discounted/overridden amounts. `return-credit-settlement.test.ts`: store-credit/exchange issuance and replacement redemption exactly once, including outbox effects. | Reuse the real native/server return fixtures. Do not substitute a fresh negative-line-only unit test for persistence and cumulative-refund coverage. Full end-to-end combinations remain subject to the Phase 6 parity gate, not assumed complete here. |
| VAT and historical records | **E:** `artifacts/globipos-terminal/src/lib/pos-calculations.test.ts`, `pos-app/tests/department-grocery.test.ts`, `pos-app/tests/grocery-bill-sync.test.ts`. **F:** `artifacts/api-server/src/terminal-bill.test.ts`: per-line VAT and arithmetic rejection. `pos-app/tests/historical-vat-audit.py` and `historical-vat-audit.browser.mjs`: read-only historical fixtures, recall preserving stored inputs/amounts, sequence/outbox invariance and recovery. `docs/historical-native-vat-audit.md` records the limits of historical-data discovery. | Reuse existing historical fixtures and golden basket. Synthetic historical coverage does not certify actual historical customer records. Category/item VAT-source and mixed-basis cases must be checked against the approved policy, not replaced by a blanket “every stored level is gross” assumption. |
| Receipt/A4 invoice consistency and output safety | **E:** `artifacts/globipos-terminal/src/lib/customer-invoice.test.ts`: cash/card/account guards, response validation, persistent recovery, unit/variant transport. **F:** `artifacts/globipos/tests/invoice-document-consistency.test.mjs`: unit-price precision, VAT allocation/reconciliation and captured POS invoice inputs. `artifacts/api-server/tests/invoice-html.test.mjs`: HTML escaping and safe logos/URLs. `artifacts/globipos-terminal/src/lib/invoice-print.test.ts`: independent A4 preference, repeatable frame printing and aligned A4 CSS. | Invoice HTML/security and print-routing tests already exist; do not recreate them. HTML escaping is not a monetary parity check. A complete same-transaction receipt/A4/report matrix, including returns and mixed bases, was not established by this audit; first extend the existing consistency fixtures only where demonstrably absent. |
| Price levels, wholesale and contracts | **E:** `artifacts/api-server/src/pos-invoice.test.ts`: wholesale/customer-level versus retained retail prices, fixed contracts, pack quantities and credit rules. Terminal calculation tests cover configured level selection. **F:** `artifacts/api-server/src/pos-invoice-stage1.test.ts`: explicit level basis, contract inheritance, kg/l/pc/pack precision and retail fallback. `artifacts/api-server/tests/price-level-policy.test.mjs`: reserved Trade identities, validation, audited metadata, replay/stale edits and rollback. | Existing contract/level assertions substantially overlap the new suite. Preserve the distinction between customer role, price basis and payment/credit eligibility. Presence on a feature branch is not evidence the release base contains these fixes. |
| Formula pricing and cent-property checks | **F:** `pos-app/tests/multi-device/pricing-reference.test.mjs`, `pricing-reference-oracle.mjs`, `pricing-application.test.mjs`; `artifacts/globipos/tests/pricing-calculator-validation.test.mjs`. Reference checks include 100,000 seeded baskets; validation covers loops, blank overrides and unchanged inputs. | Do not build another calculator oracle. The reference runner explicitly says its standalone HTML checks do not themselves prove application parity. Reuse application/reference comparisons and identify any missing production-resolver case before adding it. |
| Promotions, bundles and start/end dates | **F:** `pos-app/src/simulation/promotions.test.ts`: complete legacy result parity. `pos-app/tests/multi-device/promotion-cents.test.ts`: complete sets/leftovers, stable remainder allocation, ordered deals, no reused units, dates, trade/exclusion defaults, returns and paid-amount loyalty. **H:** `pos-app/tests/promotion-sets.test.ts`, `promotion-native-dates.test.mjs`, `promotion-golden.test.ts`. | Leftover-unit/start-date regression tests already exist on other branches. Review the hotfix and intended integration first; adding a second evaluator/fixture does not deliver the fix. Keep compatibility parity separate from asserting that legacy behaviour is financially correct. |
| Daily prices, shelf prices and Agoranomia | **E:** `pos-app/tests/daily-prices.test.ts`, `daily-prices-sql.test.py`, `daily-prices-browser.test.mjs`: selective edits, units/Cyprus date, actual checkout-scale reading, refreshed prices, failed print retry without repeated save. **F:** `artifacts/api-server/tests/agoranomia-audit.test.mjs`, `agoranomia-print-batch.test.mjs`: confirmed price evidence, stale/missing evidence and preflight without writes. `artifacts/globipos/tests/shelf-price-vat-paths.test.mjs` and `shelf-price-vat.browser.test.mjs` inspect price/VAT paths. | Retain these focused suites. Shelf-label evidence and price changes are related to the money path but do not alone prove settlement correctness. No new duplicate daily-price or label-evidence tests are proposed. |
| Payments, split tender and change | **E:** `pos-app/tests/split-tender.browser.test.mjs`: actual payment/order hooks, saved cash/card portions, card overpayment blocked before gateway calls, locked controls and failed-save retry without a second charge. `artifacts/globipos-terminal/src/lib/customer-invoice.test.ts`: tender coverage, card reference/confirmation and ambiguous reply recovery. **F:** `pos-app/tests/cashier-payment.browser.test.mjs`: completed-sale receipt failure, blocked exits/logout, duplicate queue protection and recovery. `artifacts/api-server/src/payment-tenders.test.ts`: individual references/allocations, cash-funded change, cents, duplicates, unapproved/invalid tenders and legacy compatibility. | Reuse these fixtures and validators; basic split/change validation is not missing. Exhaustive card outcome/manager-recovery and cancelled-payment persistence coverage must be checked against Phase 6 before suggesting only the missing scenarios. Physical card-provider acceptance is not proved by mocks. |
| Loyalty, cashback and credit | **E:** `artifacts/api-server/src/loyalty-policy.test.ts`: reservation caps, configured accrual, redemption minima/multiples/balance checks, one full refund and negative cashback liability after spent earnings. `artifacts/api-server/src/pos-invoice.test.ts`: posted debt/payment/credit-note balances, approval/status/limit checks and **two tills racing for remaining credit**. **F:** `artifacts/globipos/tests/online-order-rewards.test.mjs`: earning and full reversal. `artifacts/api-server/src/pos-voucher-service.test.ts` also contains concurrent double-spend/idempotency assertions for vouchers. | Credit concurrency is already covered: do not propose it as entirely new. The current cashback test intentionally permits refund liability below zero; a universal nonnegative-wallet assertion conflicts with that rule and needs Chris's decision. Distinguish this from refusing overdraft on redemption. A full shared-points offline/double-spend matrix across all clients was not established here. |
| Stock sales, receiving, transfers and adjustments | **E:** `artifacts/api-server/src/pos-invoice.test.ts`: invoice/stock/journal posting once and same-key retry. **F:** `artifacts/api-server/src/inventory-transfers.test.ts`: database transaction tests for reservation safety, variants, global neutrality and retries. `artifacts/api-server/src/pda-workspace/documents.test.ts`: actual transactional receiving replay, changed stock-count revision rejection, short transfers, GRV posting and losses/returns reconciliation. `artifacts/api-server/src/pos-stock-in-service.test.ts`: fingerprints, reserved availability and invalid input rejection. `pos-app/tests/stock-availability-browser.test.mjs`: offline acknowledgement/checkout guards. | Receiving/transfers/counts already have stronger database fixtures than a new SQL-mock-only test. Reuse them. General adjustment, sale/refund and UOM conversion coverage must be mapped to the exact posting path/version; this audit does not certify every path or migration. Do not run stock conversions or change stock handling as part of testing. |
| Native stock, outbox and acknowledgement | **F:** `pos-app/tests/native-stock-harness/src/lib.rs` imports the real native models, migrations, DB, orders, tender and sync modules. `src/stock_tests.rs` checks paid-sale conflict persistence through restart/network failure until acknowledgement and preflight distinctions for blocked/unknown/denied/non-stock items. Harness integration files include `tests/stock_conflicts.rs` and `tests/promotion_cents.rs`. | The native harness is existing coverage, not a missing implementation. Reuse its real SQLite/outbox paths rather than duplicating them with an in-memory counter. Rust compilation and actual harness results were not checked in this document-only step. |
| Offline sync, restart and duplicate uploads | **E:** `artifacts/globipos-terminal/tests/browser-sync-scale.test.mjs`: 130,000-product catalogue across browser restarts, Chromium killed during an IndexedDB write, committed cursor recovery and atomic first-page replacement. `artifacts/globipos-terminal/src/lib/terminal-contract.test.ts`: upload mapping. **F:** `artifacts/api-server/src/terminal-bill.test.ts`: exact duplicates versus altered payloads. Native harness above covers real outbox/conflict persistence. **P6:** settlement tests check duplicate outbox/credit effects. | Catalogue crash recovery already exists and must not be rebuilt. It is **not the same as bill-queue durability**. Map browser bill enqueue/send/ack crash windows, lost replies and concurrent flushes onto the existing browser harness/native outbox tests; add only uncovered bill-specific steps after approval. A fresh file-backed queue fixture alone cannot prove IndexedDB crash durability or actual API posting exactly once. |
| Simulation isolation, parity and X/Z cash | **F:** `pos-app/tests/multi-device/simulation.test.ts`: scenario catalogue, guarded persistent channels, reset/disposal and missing-scale refusal. `register-parity.browser.mjs` compares real handlers and simulator; its report explicitly calls it an **initial probe, not the complete session gate**. **P6:** `session-reports.test.ts`: shared X-query cash/card/prepaid/refund amounts, posted counters, Z/blind close and isolated reopen/reset. | Reuse the existing scenario runner, settlement fixtures and shared report tests. Do not equate a scenario count or screenshot with complete real-versus-simulator financial parity. A finished full parity gate remains separate work and is not claimed by this audit. |

## Existing runners and execution limits

- API `package.json` already provides `test:server`, `test:agoranomia` and `test:cashier-pin`. `artifacts/api-server/tests/run-server.mjs` discovers recursive `src/**/*.test.ts` and `tests/*.test.mjs`, using a disposable PostgreSQL fixture. It explicitly rejects files with skipped/todo/cancelled cases. Do not weaken that gate or point its fixtures at a shared database.
- Terminal `package.json` already provides a unit `test` command, `test:browser-sync-scale` and `test:browser-sync-atomicity`.
- Native POS `package.json` has a typecheck but no general test script. Standalone browser, Python, multi-device and bounded Rust harness commands therefore need explicit runner/CI mapping. Existing files are not automatically included in every CI job.
- Production PostgreSQL integration, browser IndexedDB, native SQLite and pure-validator tests prove different boundaries. Do not replace one with another and claim equal coverage.
- Archived `.migration-backup` copies and generated `.local-tests` bundles were excluded as independent suites.
- No existing test was executed, skipped, weakened or regenerated for this audit. **Current gate results are not verified by this source review.**

## Overlap with the previously added money-path suite

| New suite already on the unmerged branch | Existing coverage to prefer / compare before approval |
|---|---|
| `tests/money-paths/sales-vat.test.mjs` | Existing golden sale, department/grocery arithmetic, VAT history and bill-sync tests. Review whether any genuinely missing production-engine property case belongs in those files. |
| `tests/money-paths/pricing-payments.test.mjs` | Existing level/contract/invoice policy, promotion hotfix, split-tender browser, tender-validator and invoice-recovery tests. Do not treat a feature-branch fix absent from the engineering base as a new untested defect. |
| `tests/money-paths/loyalty-credit-stock.test.mjs` | Existing loyalty policy, invoice credit/stock concurrency, voucher transactions, PDA receiving and stock-count/transfer integration. The blanket cashback nonnegative expectation conflicts with an existing explicit policy test. |
| `tests/money-paths/offline-sync.test.mjs` | Compare controller-level lost-reply cases with existing native outbox and browser IndexedDB coverage. Preserve only demonstrably missing controller/bill crash cases; do not duplicate catalogue-restart testing. |

The earlier six known failures were observed on the **engineering-base-derived branch**. They are not a fresh diagnosis that all current feature branches or a deployed till still have those defects. The separate VAT, invoice/UOM and promotion work must be reconciled before deciding which assertions remain necessary.

## Recommendation for Chris

1. **Do not add another broad money-path suite now.** Existing coverage is substantial, including database credit races, vouchers, stock transfers/receiving, historical VAT and real browser/native persistence boundaries.
2. Approve a branch-aware runner/CI inventory next: identify which approved suites should run for each changed area, retain their existing assertions and avoid duplicate execution.
3. Then approve only specific missing cases in the existing owning suites: bill-specific crash/ack windows; any untested shared-points/cloud concurrency path; and any missing frozen-transaction receipt/A4/report or real-handler parity combinations.
4. Review the previously added test branch for overlap and the cashback policy conflict **before** keeping, moving or removing its tests. No such changes are made in this step.

**Original stopping point:** The audit stopped for approval without application,
test, CI, schema, data, migration or release changes. Approval was subsequently
received; the narrow follow-up is below.

## Approved gap-only follow-up — 17 October 2026

Branch: `test/money-paths`, stacked on the engineering branch. No existing
application behavior, schema, protected financial code or dependencies changed.
No existing assertions were removed or relaxed.

| Gap filled | Existing suite extended | New assertion |
|---|---|---|
| Real bill storage survives process death | `artifacts/globipos-terminal/tests/browser-sync-scale.test.mjs` | Commit an actual IndexedDB order, lines and outbox; SIGKILL Chromium; reopen the same profile; recover identical persisted records and acknowledge without deleting the local sale. |
| Server accepted but reply lost | Same browser suite | Kill while the fixture holds the acknowledgement; restart; resend the identical persisted payload, including sale identity; clear the queue only after acknowledgement. |
| Atomic client acknowledgement | Same browser suite | Abort the real multi-store acknowledgement transaction; retain the queued bill and zero confirmed count/null successful-sync timestamp; retry commits the deletion and successful snapshot together. |
| Atomic enqueue failure | Same browser suite | Abort the real order/lines/outbox save; all three stores remain empty and checkout receives a rejection rather than hanging. |
| Concurrent points double-spend | `artifacts/api-server/src/loyalty-policy.test.ts` | Hold the real customer row lock until both requests reach it, then release: exactly one distinct 200-point request succeeds against 300 points, leaving 100 points and one €2 wallet credit. |
| Points replay after concurrent retry/lost reply | Same loyalty suite | Same-key concurrent requests create one debit/credit; replay leaves balances unchanged; reuse with a changed amount is refused without writing. |
| Partial points/wallet failure | Same loyalty suite | Force a real PostgreSQL constraint failure between debit and wallet credit; all effects roll back; retry after fixture recovery succeeds once. |

### Execution results

| Check | Result |
|---|---|
| `node scripts/test-money-gaps.mjs` | **PASS:** 9 Node test entries, including the 5 pre-existing policy tests, 3 new transaction subtests and their parent; zero failures/skips. |
| `node --test --test-name-pattern='bill queue' artifacts/globipos-terminal/tests/browser-sync-scale.test.mjs` | **PASS:** 4 new browser cases; zero failures/skips. The catalogue stress cases were not rerun locally because their assertions and implementation were not changed. |
| Existing `node scripts/test-money-paths.mjs` | **66 PASS / 6 existing known SKIP / 0 FAIL**; golden sale remains 22.77 − 0.28 = 22.49, VAT 0.93 / 0.48. No new quarantine added. |
| Hosted GitHub CI | **Not verified locally.** Workflow paths/job wiring added; GitHub execution requires the PR run. |

No new application bugs were found by the additions. Initial fixture/tooling
corrections did not require changes to application code.

### Isolation and limits

- The SQL tests extract and execute the **unchanged original storage method** and
  import the actual table definitions and redemption validator. Only the database
  connection is supplied by a private, disposable PostgreSQL cluster over Unix
  sockets. Scratch tables are fixture setup, not migrations; no shared database,
  environment credentials or application startup is used. Fetch is forbidden.
- Browser tests use the **actual IndexedDB implementation and sync controller**,
  fresh profiles, a local static fixture host and synthetic acknowledgements.
  Unexpected application API requests fail; no real cloud/shop service or app
  service worker is used. Client crash/ack safety is proved here, **not** real API
  stock posting exactly once; the existing server/native transaction tests remain
  responsible for that.
- No new receipt/pricing/payment arithmetic suites were created. Existing
  receipt, invoice, historical VAT, settlement, report and promotion suites listed
  above must be reused. A complete same-transaction receipt/A4/report matrix,
  full real-handler/simulator parity and the client live-cloud redemption gate
  are **not claimed as verified** by these additions.
- The prior broad review suite is retained unchanged for Chris's overlap/policy
  review, not expanded. Its engineering-base quarantines do not diagnose the
  newer feature branches.

### CI and ownership

The existing terminal-browser workflow already runs the extended browser file
for terminal/shared-core changes. `Money-path tests` now also runs the existing
loyalty suite with its new SQL cases for relevant API/POS/library/test changes.
Both new fixture families, the extended suites and the gap runner are explicitly
CODEOWNERS-protected. No new dependencies, migration, Rust build, merge, publish,
deployment or release was performed.
