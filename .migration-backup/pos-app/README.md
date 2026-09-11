# GlobiPOS Terminal

Tauri 2.0 desktop POS application for GlobiPOS — offline-first, SQLite-backed, with full sync to the GlobiPOS server.

## Prerequisites

| Tool        | Version  | Install                                         |
|-------------|----------|-------------------------------------------------|
| Rust        | ≥ 1.77   | https://rustup.rs                               |
| Node.js     | ≥ 20     | https://nodejs.org                              |
| Tauri CLI   | 2.x      | `npm install -g @tauri-apps/cli`                |
| Linux deps  | —        | `sudo apt install libwebkit2gtk-4.1-dev ...`    |

See https://tauri.app/start/prerequisites/ for the full system dependency list.

## Development

```bash
cd pos-app
npm install
npm run tauri dev
```

On first launch, the **Setup** screen appears: enter your GlobiPOS server URL and the terminal code (found in Admin → POS → Terminals). The app registers with the server, downloads the product catalog and layout, and stores config locally.

## Build (production)

```bash
npm run tauri build
```

Produces a platform-native installer in `src-tauri/target/release/bundle/`.

## Architecture

```
pos-app/
├── src/                   React + TypeScript frontend
│   ├── App.tsx            Root router (setup → login → POS)
│   ├── pages/
│   │   ├── Setup.tsx      First-launch server registration flow
│   │   ├── Login.tsx      Cashier PIN entry
│   │   ├── POS.tsx        Main selling screen
│   │   └── FallbackRules.tsx  Offline fallback rule manager
│   ├── components/
│   │   ├── SyncHeader.tsx   Top bar (status, clock, cashier)
│   │   ├── CategoryNav.tsx  Category filter rail
│   │   ├── LayoutGrid.tsx   Configurable button grid (from SQLite layout)
│   │   ├── OrderTicket.tsx  Right-side order panel
│   │   ├── Numpad.tsx       Floating numpad (qty / price / discount)
│   │   ├── ActionBar.tsx    Bottom function bar
│   │   └── PinPrompt.tsx    Supervisor / manager PIN overlay
│   ├── hooks/
│   │   ├── useOrder.ts      All 15 order mgmt + 11 pricing functions
│   │   ├── useSync.ts       Background sync polling engine
│   │   ├── useBarcode.ts    USB HID barcode scanner
│   │   └── usePermissions.ts Role-based permission layer
│   └── lib/
│       ├── db.ts            Tauri invoke() wrappers for all commands
│       └── pricing.ts       Pure pricing engine (no side effects)
└── src-tauri/             Rust backend (Tauri 2.0)
    ├── src/
    │   ├── lib.rs           All Tauri commands + app entry point
    │   ├── db.rs            SQLite helpers (upsert product/category/layout)
    │   ├── sync.rs          Server API calls (register, catalog, inbox, outbox)
    │   ├── orders.rs        Order persistence + outbox enqueue
    │   ├── auth.rs          PIN validation + audit log
    │   └── migrations.rs    Versioned SQLite schema migrations
    └── tauri.conf.json      Window config, bundle settings, plugin config
```

## Local database (SQLite: globipos.db)

| Table                 | Purpose                                        |
|-----------------------|------------------------------------------------|
| `local_products`      | Cached product catalog from server             |
| `local_categories`    | Cached categories                              |
| `local_layout`        | Layout button grid (position, color, action)   |
| `pos_orders`          | All orders (active, held, completed, voided)   |
| `pos_order_lines`     | Order line items                               |
| `pos_outbox`          | Completed bills queued for server sync         |
| `pos_inbox`           | Messages from server (price changes, alerts)   |
| `price_overrides`     | Timed price overrides (from inbox)             |
| `pos_shifts`          | Cashier shift records                          |
| `cashiers`            | Local cashier PINs and roles                   |
| `sync_fallback_config`| Offline fallback behavior per rule type        |
| `sync_log`            | Sync event log                                 |
| `audit_log`           | Local audit trail                              |

## Sync engine

| Channel   | Interval | Endpoint              | Purpose                          |
|-----------|----------|-----------------------|----------------------------------|
| Heartbeat | 1 min    | POST /api/pos/terminals/{id}/heartbeat | Online status         |
| Catalog   | 15 min   | GET  /api/sync/catalog | Delta product sync              |
| Inbox     | 5 min    | GET  /api/sync/inbox   | Price changes, alerts, layout   |
| Outbox    | 30 s     | POST /api/sync/bills   | Push completed orders to server |

## Offline fallback rules

Configured per-rule in the **Fallback Rules** screen (manager PIN required to open):

| Rule key           | Default behavior      |
|--------------------|-----------------------|
| customer_lookup    | allow                 |
| loyalty_earn       | allow                 |
| loyalty_redeem     | block_with_message    |
| credit_check       | allow                 |
| price_level_override | allow               |
| promo_code         | block                 |
| void_order         | allow                 |
| refund             | block_with_message    |

## POS functions implemented

### Order management (#1–15)
1. Add product to order (tap grid / scan barcode / search)
2. +1 qty on selected line
3. -1 qty on selected line
4. Set exact qty (numpad)
5. Remove selected line
6. Void line (struck-through, stays on ticket)
7. Clear entire order
8. Hold order (save, start new)
9. Recall held order
10. Add line note
11. Add order note
12. Repeat last item
13. Price check (show price, no add)
14. Void order
15. Set customer on order

### Pricing/discount (#16–26)
16. Line price override (numpad)
17. Line % discount
18. Line fixed (€) discount
19. Order % discount
20. Order fixed (€) discount
21. Promo code (local lookup; server lookup in Phase 3)
22. Manual promotion (type + value)
23. Price level switch (levels 1–5)
24. Remove all discounts
25. VAT/tax rate override on selected line
26. Auto-apply timed price changes from inbox

### System (#27–88)
- Barcode scan → item lookup → add to order
- Product name / SKU search with debounce
- Category navigation (filter grid)
- Cashier PIN login / logout
- Permission layer (supervisor / manager PIN approval)
- Sync status in header (online / syncing / offline + queue count)
- Outbox exponential backoff (30s → 60s → 120s → 240s → 480s)
- Fallback rules manager (8 configurable rules)
- Dual-DB query router (local SQLite for products/orders, server for customers with 800ms timeout)
- Local audit log for all sensitive actions
- Payment dialog (cash with change, card)

## Phase 3 (next)
- JCC / Viva / Worldpay payment gateway integration
- Cash drawer + receipt printer hardware commands
- Scale integration
- Shift management UI
- Supermarket functions #89–162
