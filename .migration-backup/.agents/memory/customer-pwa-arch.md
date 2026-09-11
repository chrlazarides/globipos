---
name: Customer PWA Phase 4 Architecture
description: Auth split between portal session and customer JWT; customer-app/ is a standalone Vite project in its own subdirectory
---

## Auth split
- **Portal** (`/portal/*`): uses express-session cookie, queries `/api/portal/*`. No JWT.
- **Customer PWA** (`customer-app/`): uses JWT Bearer token stored in `localStorage` as `globi_customer_token`. Secret is `SESSION_SECRET + "_customer"`, payload includes `{ type: "customer" }`. Queries `/api/customer/*`.

## customer-app/ project structure
- Standalone Vite+React+TypeScript project in `customer-app/` subdirectory.
- Has its own `package.json`, `vite.config.ts` (with vite-plugin-pwa), `tailwind.config.ts`.
- Must be run independently: `cd customer-app && npm install && npm run dev` (port 5174).
- Proxies `/api` to `localhost:5000` in dev mode.
- **Not wired into the root monorepo** — cannot use root `node_modules`.

## Tauri kiosk
- Scaffold in `customer-app/src-tauri/` for Tauri 2.x kiosk/fullscreen mode.
- Requires Rust toolchain + Tauri CLI to build.

**Why:**
Keeping auth systems separate prevents portal session token leakage into the customer-facing app and makes it easy to deploy the customer PWA to a different domain.
