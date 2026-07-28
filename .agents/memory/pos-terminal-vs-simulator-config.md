---
name: POS terminal configs mirrored in web Simulator
description: Terminal-local schema_meta configs (barcode_config, receipt_config, hardware_config) have no server API; the Simulator mirrors them via localStorage sim_* keys
---

Terminal-side parameters (barcode structure rules, receipt design, hardware) live in
each POS terminal's local SQLite `schema_meta`, loaded via Tauri commands. The web
back-office/server never sees them — there is no `/api` endpoint for these configs.

The web POS Simulator (`client/src/pages/pos-simulate.tsx`) therefore keeps its own
copies in browser localStorage (`sim_barcode_config`, `sim_receipt_config`) with the
same shape/defaults as the terminal structs, so behaviour can be tested without a
terminal.

**Why:** Testers expected the simulator to exercise the configurable scale-barcode
parsing and receipt design; syncing terminal-local SQLite to the web wasn't feasible.

**How to apply:** When adding a new terminal-local config (Rust `*_config.rs` +
`schema_meta` key), decide whether the Simulator needs a matching localStorage
mirror; keep parse/build logic order identical to the terminal (e.g. scan flow
parses scale barcodes BEFORE exact-barcode lookup) or the simulation diverges.
