# GlobiPOS
Unified retail and wholesale POS, back office, stock and customer operations across web, handheld and native terminals.

## Repo map and quick commands
Node 24; pnpm 10.26.1; install with `pnpm install --frozen-lockfile`.
Commands below are **references**, not permission to run protected operations.
Run `pnpm --filter <package> run dev` for workspace apps; quick checks:

| Folder / purpose | Package / quick check |
|---|---|
| `artifacts/globipos` — back office, eShop and PDA web routes | `@workspace/globipos`: `run typecheck` |
| `artifacts/api-server` — Express API | `@workspace/api-server`: `run typecheck`; unit/API scripts when present |
| `artifacts/globipos-terminal` — browser/PWA register | `@workspace/globipos-terminal`: `run typecheck` + `run test` |
| `artifacts/globipos-mobile` — dedicated mobile app (development branch; absent on this base) | Use its package's `dev`, `typecheck`, unit scripts after integration |
| `artifacts/mockup-sandbox` — isolated UI prototypes | `@workspace/mockup-sandbox`: `run typecheck` |
| `pos-app` — native Tauri register, independent npm lock | `npm --prefix pos-app run dev`; quick: `npm --prefix pos-app run typecheck` |
| `pda-app` — legacy PDA output, no source package on this base | Run/check PDA through `artifacts/globipos` |
| `customer-app` — legacy customer-display output, no source package on this base | No standalone command; display source belongs to POS |
| `lib` — shared DB, API contracts/client and libraries | `pnpm exec tsc --build lib/<package>/tsconfig.json`; unit script if present |
| `scripts` — engineering/release utilities | `pnpm --filter @workspace/scripts run hello`; quick: `run typecheck` |

Do not invent missing unit scripts. See [Engineering](docs/ENGINEERING.md) for commands, gaps and CI.

## Agent rules
- Start every task with one GitHub issue; touch one app. Cross-app scope needs approval in that issue.
- Branch: `type/issue-short-name`; use Conventional Commits; finish with a PR using the template.
- Run only the changed app's quick checks (typecheck + existing unit tests); CI owns the full suite.
- Without Chris's **written approval in the issue**, never merge, publish, deploy, create signed releases, run migrations or DB push against shared databases, change pricing/payments/fiscal/loyalty/credit/voucher/device-trust code, compile Rust/native locally, or add dependencies younger than the one-day minimum release age. Never disable that guard.
- Back-office upgrades need a clear version: prepare one patch/minor/major version increment per upgrade and commit it with the code. Rebuilds/snapshots/restores do not increment it. Use `pnpm version:backoffice patch` when that helper is integrated; it is not on this base. Do not change POS/Rust versions incidentally.
- Publishing must follow `.agents/skills/publish-pwa-tauri/SKILL.md`: separate POS/PDA PWA publishing from native releases, use approved GitHub preflight builds and exclude development output from web images. That skill is on the development branch; its absence here is not permission to release. Signed releases require approval.
- Keep work single-agent, focused and cost-conscious; do not repeat unchanged checks.

Read [docs/ENGINEERING.md](docs/ENGINEERING.md) and [docs/decisions/](docs/decisions/).
