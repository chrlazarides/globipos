# Money-path safety net

Branch: `test/money-paths`, based on completed engineering/project-monitoring
branch `chore/engineering-step-1` at `eacb6e5`. That base is deliberately separate
from the VAT/promotion hotfix, Stage 1, UOM and Phase 6 branches. Findings below
describe **this source base**, not a verified diagnosis of a published shop.

## Run

```sh
node scripts/test-money-paths.mjs
# Diagnostic: execute desired assertions for the six explicitly known failures.
# Expected nonzero exit until those issues/policy conflict are resolved.
MONEY_KNOWN_FAILURES=1 node scripts/test-money-paths.mjs
```

Node 24 and the existing frozen workspace dependencies are sufficient. No new
dependency, application/package script or compiler setting was added.

The runner bundles the production functions from **this checkout**, verifies
bundle input provenance, runs Node tests and deletes its temporary bundles.
Test workers block actual fetch/HTTP/socket connections, native commands and
default database access. Sample identities, deterministic UUIDs and a clock fixed
at `2026-10-12T09:00:00Z` are used. Files used by the queue fixture live only in
temporary directories, which are removed afterward.

## Verified results

Normal run: **72 tests: 66 passed, 0 failed, 6 explicitly skipped**.
The diagnostic run before the final two threshold/coupon additions executed
**70 tests: 64 passed, the same 6 failed, 0 skipped**.
The failures below were actually executed; they are not hypothetical TODOs.
YAML syntax/job structure and JavaScript syntax checks pass.

| Area | Passed / known skips | Coverage added |
|---|---:|---|
| Sales | 9 / 0 | Golden basket; quantities including weighed sales; percent then fixed discount; override; over-discount clamp; bill discounts; void; negative adjustment reversing gross/VAT |
| VAT | 8 / 2 | Cyprus 0/3/5/9/19%; native/PWA/inclusive-invoice helper agreement; 1,000 deterministic integer-cent cases; per-line rounding; accepted net-level receipt/invoice cent difference |
| Pricing | 13 / 3 | All five stored levels; native Retail fallback; fixed contract precedence/isolation; category/minimum-quantity eligibility; existing best-price discount behaviour; exact bundles; cheapest free; quantity threshold; cached coupon eligibility; inactive/expired offers |
| Payments | 19 / 0 | Card approved/declined/cancelled/uncertain/malformed results; partial/split payment; cash change; duplicate/invalid/non-finite tenders; no cashless change; invoice approval/reference/confirmation and reply identity; verification lock |
| Loyalty / credit | 7 / 1 | Earned points; redemption precision and insufficient balance; cashback reservation caps; refund reversal; approval/limit refusal; statements/ageing helpers; Cyprus dates/terms |
| Stock | 4 / 0 | Pack/variant quantities; reservation availability; actual receiving service retry, mismatched idempotency reuse and transaction rollback; invalid quantities rejected before connection |
| Offline / bill replay | 5 / 0 | Actual sync-controller offline retention, restart, accepted-but-lost reply recovery, rejection retention and coalesced flush; actual canonical server bill validation/duplicate matcher |
| Isolation | 1 / 0 | Network and implicit database access fail closed |

The golden basket remains **€22.77 before line discount, €0.28 discount, €22.49
paid; included VAT €0.93 at 5% and €0.48 at 19%**. The native totals helper's
`subtotal` is a net subtotal, so the gross-before-discount amount is checked
separately rather than confusing the two meanings.

### Known failures / decision required

The desired assertions remain intact. Only these six newly added tests are
explicitly skipped by default; existing assertions/tests are not changed.

| Reference | Reproduction on this base | Expected / decision |
|---|---|---|
| VAT-1 | Native `pricing.createLine` omits inclusive basis. Reproduced L1 €3.20 at 5% → €3.36, VAT €0.16. Desired assertion covers L1–L5 shelf fixtures; strict run stops at L1. | €3.20, VAT €0.15. Existing separate VAT hotfix needs review/integration, not a fix in this task. |
| UNIT-1 | POS invoice `priceInvoiceLine` rejects 1.240 kg with `INVALID_QUANTITY` / whole-unit stock error. | Accept and price €3.09, included VAT €0.15. Stage 1/UOM work is separate; no stock change imported here. |
| PROMO-1 | `evalMixMatch`: dairy basket €10.83, any 3 for €6, saving €4.83. | Saving €2.25; leftovers charged normally. |
| PROMO-2 | `evalMealDeal` has the same complete-set/leftover defect, saving €4.83. | Saving €2.25. Both cases belong to the separate promotion hotfix. |
| PROMO-3 | Hook `evaluate` applies a December promotion at the fixed October sale date, saving €3.60. | No promotion before `valid_from`. |
| POLICY-1 | Refunding already-spent earned cashback returns a balance of −€2. | Conflicts with the requested blanket “balances never go negative” rule. The existing agreed refund-liability policy deliberately permits this debt; Chris must decide. This is a policy conflict, not automatically classified as a new bug. |

No application behaviour was repaired or changed. After Chris reviews each fix,
replace its `known(...)` registration with a normal `test(...)` and retain the
desired assertion. Do not treat skips as passes or these results as release approval.

### What the fixture boundaries prove—and do not prove

- `stock-pool.mjs` executes the **actual** `receivePosStock` service against a
  narrow SQL-boundary fixture. Unknown SQL fails, and fixture transactions roll
  back both balances and audits. It proves service branching, retry handling and
  rollback intent, **not PostgreSQL constraints, advisory locks or concurrent races**.
- Offline tests execute the **actual** PWA `sync.ts`, its payload mapper and the
  **actual** API bill validator/duplicate matcher. The storage boundary is a
  file-backed queue; the fake server stores a single canonical bill. The “posts”
  count is a fixture count, **not proof of the actual HTTP route's stock posting**.
- Restart reloads the sync module with retained fixture storage. It is **not** an
  IndexedDB/browser process crash test.
- Promotion tests use the existing private pure helper bodies, exported only in
  temporary test bundles. Hook date filtering uses a minimal state shim, not a
  rendered React register. No second promotion engine is implemented.
- Invoice tests call the existing pure pricer with an explicit included/net basis.
  They do not prove that every invoice-service entry point supplies that basis.
  Existing contract discounts compare against Retail before choosing the cheaper
  level; the future customer-level formula policy is not implemented by these tests.

## Remaining coverage gaps

1. **Atomic stock and shared balances:** actual server sale/refund/transfer/
   adjustment posting, concurrent duplicate uploads, atomic loyalty/voucher/credit
   reservation and cloud-required redemption need an isolated database-level
   harness. Sequential validator/redemption tests are **not** proof against
   concurrent double-spending or an offline till bypassing the cloud.
2. **Actual terminal durability:** real IndexedDB/native SQLite save, process
   crash/restart, cross-window locking and acknowledgement transactions are not
   exercised by the injected file-storage fixture.
3. **Documents and reports:** helper-level VAT is checked, but real rendered
   80mm/A4 output and back-office report reconciliation, original-line partial
   refunds, fiscal output and database-backed document history are not tested.
4. **Full pricing paths:** catalogue sync → local product → register handler,
   customer-contract date selection, invoice-service basis selection, end-to-end
   coupon application and customer-specific formula levels need additional
   entry-point tests. No L6–L10 or future feature is invented here.

No shared data was read or written. No migration, Rust/native build, browser suite,
publish, merge or release was run. The new GitHub job is syntax-validated but its
hosted execution remains **not verified until a PR runs it**.

## CI and ownership

`.github/workflows/ci-web-api.yml` now includes **Money-path tests**, scoped to
relevant POS/API/back-office/library, root dependency/config and test changes.
Existing application checks are not replaced or relaxed. The new test folder and
runner are explicitly owned by Chris in CODEOWNERS.

Chris must enable the required **Money-path tests** status and CODEOWNERS-review
enforcement in branch protection after review/merge. Rollback is a reviewed revert
of these test/config/docs changes; there is no application/data migration to undo.
