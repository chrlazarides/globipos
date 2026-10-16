# Proposal: consolidate GlobiPOS engineering memory

**Status: proposed; Chris's approval required. Date: 17 October 2026.**
No memory file is edited, moved or deleted by this proposal.

Inventory: **70 topic notes plus MEMORY.md** in the current development workspace,
not approximately 75 exact files. GitHub main contains an older subset; names
below include development-only notes. Review those branches before any move.
This inventory describes candidate grouping, not authority to discard policy.
Keep user-approved business decisions and permission boundaries; retain links
from the index if Chris later approves relocation.

## Fifteen general rules

1. **Keep releases and source access explicit.** Web publishing, native preflight,
   signed updates, customer distribution and source visibility are separate.
   Notes: `native-release-boundary`, `source-privacy`, `publishing-image-footprint`,
   `product-customer-logos`, `deployment-control-boundaries`.
2. **Respect staged scope and approval boundaries.** Do not infer release,
   migration or integration permission from a task merge or a simulation.
   Notes: `multi-device-build-boundaries`, `isolated-task-completion`,
   `scoped-post-merge-setup`, `development-stage`, `agoranomia-scope`.
3. **Preserve checkout and merge integrity.** Verify the actual worktree and
   resolve structural merge corruption before changing behaviour.
   Notes: `git-worktree-identity`, `structural-merge-verification`.
4. **Keep contracts browser-safe and API generation deterministic.**
   Notes: `browser-safe-shared-contracts`, `openapi-request-schemas`,
   `native-react-boundary`.
5. **Financial retries retain identity; ambiguous output requires recovery.**
   Notes: `financial-client-recovery`, `financial-preview-validation`,
   `print-recovery-boundary`, `credit-note-single-use`.
6. **Prices, VAT, units and stock need explicit, approved semantics.** Never
   convert or reinterpret stored values from assumptions.
   Notes: `catalogue-price-convention`, `pos-pricing-decisions`,
   `item-uom-stock-policy`, `legacy-stock-provenance`,
   `grocery-scale-and-daily-prices`.
7. **Use trusted identities and explicit financial permissions.**
   Notes: `voucher-device-trust`, `credential-snapshot-consistency`,
   `cashier-rfid-approval`, `cashier-session-scope`, `pos-external-tools`.
8. **Keep roles, balances and external transactions separate.**
   Notes: `supplier-trade-roles`, `pos-customer-credit-scope`,
   `rewards-refund-liability`, `shop-pickup-policy`, `offline-stock-hold-policy`.
9. **Saved layouts and every assigned function must survive adaptation.**
   Notes: `layout-editing-safety`, `preferred-supermarket-layout`,
   `toy-company-layout`, `fresh-function-parity`, `pos-function-approval`,
   `pos-function-assignment-scope`, `pos-department-layout-behaviour`.
10. **Responsive and accessible layouts need device-specific verification.**
    Notes: `mobile-pos-mode`, `native-dialog-verification`,
    `till-hardware-support-scope`, `pda-device-support`.
11. **Simulation is not proof of real peripheral operation.** Keep device
    lifetimes, trace evidence and physical acceptance distinct.
    Notes: `layout-simulation-boundary`, `simulation-peripheral-lifetime`,
    `peripheral-monitoring-scope`, `pole-display-acceptance`.
12. **Offline apps preserve scope, data and partial-catalogue boundaries.**
    Notes: `pwa-install-ownership`, `pwa-shell-cache-matching`,
    `partial-catalog-boundary`, `pda-offline-boundaries`,
    `pda-catalogue-transport`, `offline-icon-ligatures`.
13. **Published hosting and legacy schema readiness need targeted checks.**
    Notes: `native-shop-schema-readiness`, `native-shop-host-routing`,
    `retail-eshop-scope`, `eshop-version-control-boundary`,
    `backup-email-delivery`.
14. **Tests must isolate side effects and report runtime limitations honestly.**
    Notes: `browser-fixture-isolation`, `async-chromium-test-completion`,
    `pda-webkit-verification`, `node-test-bundling`, `native-test-locks`.
15. **Tooling evidence must match its execution environment.**
    Notes: `workflow-build-environment`, `workflow-duplicate-port-owners`,
    `mockup-static-verification`, `vite-dev-name-collisions`,
    `apktool-fixture-yaml`.

All 70 topic names above are basenames under `.agents/memory/` with `.md`.
These are proposed summaries, not replacements for details or newer approvals.

## Incident-specific notes that could move

The following contain concrete incidents/tool limitations suitable for an
incident record, **while retaining the reusable rule** in engineering guidance:

| Note | Candidate record / detail worth keeping |
|---|---|
| `apktool-fixture-yaml.md` | APK fixture reader rejected otherwise-valid inline YAML |
| `vite-dev-name-collisions.md` | Development Babel failure missed by typecheck/production build |
| `workflow-duplicate-port-owners.md` | Failed restart left an older server owning the port |
| `git-worktree-identity.md` | Missing `.git` pointer selected the parent checkout |
| `structural-merge-verification.md` | Marker-free merge corrupted shared imports/fixtures |
| `mockup-static-verification.md` | Static fixture captured through the wrong preview route |
| `async-chromium-test-completion.md` | Headless DOM timing did not prove IndexedDB test completion |
| `pda-webkit-verification.md` | GTK runtime failures did not prove an iPhone/Safari defect |
| `backup-email-delivery.md` | Oversized exports surfaced as generic provider failures |
| `pda-catalogue-transport.md` | Published response delivery failed despite application HTTP 200 |

These are **candidates**, not a claim that each entire note is disposable or a
complete dated incident report. Establish the original incident date from
evidence before naming a historical report; do not invent a date.

## Decisions that could move, not be erased

Group approved scope/business choices into accepted decision records: release
and privacy boundaries; staged build approvals; POS pricing/UOM and stock policy;
trade/supplier roles and separate balances; device trust and external launch
permissions; cash/refund/rewards policies; pickup/hold policy; layout preservation
and function parity; PDA/mobile support; installation ownership; eShop scope.
The corresponding notes are listed in rules 1–2, 5–13. Preserve their precise
wording, scope and approvals rather than replacing them with generic slogans.

## Approval and migration checklist (not executed)

1. Chris approves grouping and each candidate move.
2. Compare the full text on all active branches, including additional notes not
   yet in this workspace's index; resolve obsolete/conflicting decisions openly.
3. Create accepted decision/incident records with source links and verified dates.
4. Retain a small memory index of durable, non-code-derived rules and links.
5. Review the diff to ensure no business rule, user preference or approval is
   lost; only then separately approve removals. This step removes nothing.
