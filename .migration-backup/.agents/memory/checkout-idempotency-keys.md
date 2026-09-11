---
name: Checkout idempotency keys
description: Durable retry and locking rules for customer checkout side effects.
---

Persist a checkout idempotency key with the exact client-side draft, including across reloads and offline queue delivery. Rotate it only when the draft changes or a checkout succeeds. On the server, scope uniqueness by customer and resolve a replay while holding the same customer lock used for wallet mutation.

**Why:** A server may commit an order even when the client never receives the response. A component-local key or an order-ID-only ledger constraint lets the retry create a new order and repeat rewards.

**How to apply:** Any customer checkout path that mutates balances, rewards, inventory, or ledgers must atomically claim a durable customer-scoped key and return the committed result on replay without repeating post-commit side effects.