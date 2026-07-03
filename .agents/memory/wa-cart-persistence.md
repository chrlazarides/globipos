---
name: WhatsApp chatbot in-memory state persistence
description: Pattern for making chatbot-service.ts in-memory Maps (cart, pending items, etc.) survive server restarts
---

The WhatsApp chatbot service (`server/chatbot-service.ts`) keeps several
conversation-keyed Maps as the hot path for every inbound message (cart,
pending-confirmation, browse-results). Wiping these silently on restart
causes real customer-facing data loss (abandoned carts, lost confirmations).

**Pattern used for durable state:** keep the in-memory Map as the fast path,
but mirror every mutation to a DB row keyed by conversationId (upsert on
write, delete when the row would be empty). On server boot, before
`registerRoutes()` runs, rehydrate the Maps from surviving rows and
re-arm any `setTimeout` expiry timers using the remaining TTL instead of a
fresh one — otherwise restored pending items would get bonus time.
Add an hourly prune job for rows that are long abandoned (no pending item,
stale `updatedAt`) so the table doesn't grow unbounded.

**Why:** the chatbot Maps predate any persistence and multiple features
depend on their exact runtime shape (Node-native `setTimeout` handles).
Rewriting them as pure DB-backed stores would be a much larger refactor;
mirroring writes keeps the hot path unchanged while closing the "silent
data loss on restart" gap.

**How to apply:** if adding new session-like chatbot state (e.g. checkout
step, delivery address draft), follow the same dual-write pattern rather
than introducing a different persistence mechanism — keeps restart
behavior consistent across all conversation state in this file. Note:
`waBrowseStore` (last shown product list) is intentionally NOT persisted
to DB — it's covered by a separate task about preserving browse history
across chat sessions, not server restarts.
