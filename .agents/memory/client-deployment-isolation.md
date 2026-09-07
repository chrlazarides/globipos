---
name: Client deployment isolation
description: The agreed deployment and upgrade model for independently operated GlobiPOS clients.
---

Each client must run as a separate backend deployment with its own database. Keep all clients on the same main codebase; do not create client-specific branches or add tenant columns to shared business tables.

**Why:** Physical deployment/database isolation minimizes cross-client data leakage, while one source tree keeps support and upgrades consistent. Client-specific branding, domains, modules, providers, and release targets belong in centrally managed deployment profiles.

**How to apply:** Build control-plane features in the development back office, gated to superusers and disabled in client production environments unless explicitly enabled. Keep rollout orchestration provider-neutral until Replit Admin API or GitHub automation is attached.