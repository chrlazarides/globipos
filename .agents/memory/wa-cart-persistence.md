---
name: WhatsApp chatbot in-memory state persistence
description: Pattern for making chatbot-service.ts in-memory Maps (cart, pending items, browse results) survive server restarts and long customer absences
---

The WhatsApp chatbot service (`server/chatbot-service.ts`) keeps several
conversation-keyed Maps as the hot path for every inbound message (cart,
pending-confirmation, browse-results). Wiping these silently on restart, or
after a customer closes WhatsApp for hours, causes real customer-facing data
loss (abandoned carts, lost confirmations, stale product lists).

**Pattern used for durable state:** keep the in-memory Maps as the fast path,
but mirror every mutation to a single DB row per conversation (`wa_cart_state`,
keyed by `conversationId`) covering cart, pending item, and browse results —
upsert on write, delete when the row would be fully empty. On server boot,
before `registerRoutes()` runs, rehydrate the Maps from surviving rows and
re-arm any `setTimeout` expiry timers using the remaining TTL instead of a
fresh one — otherwise restored pending items would get bonus time. An hourly
prune job removes rows abandoned past a hard TTL (24h, no pending item) so the
table doesn't grow unbounded.

**Why:** the chatbot Maps predate any persistence and multiple features depend
on their exact runtime shape (Node-native `setTimeout` handles), so a full
DB-backed rewrite would be a much larger refactor than mirroring writes. A
prior, independently-developed implementation stored everything directly in
Postgres with async accessors and no in-memory layer (see the now-removed
`wa_conversation_state` table) — the two designs were reconciled by picking
the Maps-plus-mirror pattern as the single approach and folding its
browse-results/24h-expiry/anti-flood-dedupe features into the `wa_cart_state`
table so nothing was lost.

**How to apply:** if adding new session-like chatbot state (e.g. checkout
step, delivery address draft), follow the same dual-write pattern rather than
introducing a different persistence mechanism — keeps restart behavior
consistent across all conversation state in this file. All accessor functions
(`getWaCart`, `setPendingItem`, `getBrowseResults`, etc.) remain `async` even
though the fast path is synchronous, so call sites can `await` them uniformly.
Note the WhatsApp webhook route (`/api/webhooks/whatsapp`) is not in
`PUBLIC_PATHS` (server/auth.ts) — a pre-existing, unrelated gap worth fixing
if WhatsApp webhooks stop working end-to-end.
