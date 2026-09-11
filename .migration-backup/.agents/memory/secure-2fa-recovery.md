---
name: Secure 2FA recovery
description: Security invariants for replacing a lost authenticator without weakening the second factor.
---

Keep the existing authenticator active throughout recovery. Password login, initial setup, email recovery, and replacement setup must use distinct token purposes that cannot authenticate as sessions. Persist and atomically consume email challenges and replacement grants; bind replacement grants to the currently active authenticator state.

**Why:** Clearing 2FA before replacement enrollment creates a password-only takeover window. Stateless or reusable grants can replay an older authenticator secret, while unscoped JWTs may accidentally pass normal session middleware.

**How to apply:** Any 2FA recovery change must retain account-wide TOTP attempt throttling, single-use database challenges, serialized issuance/completion, stale-state detection, and an atomic secret swap only after the replacement TOTP is verified.