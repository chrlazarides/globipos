---
name: Phase 5 Chat Auth Pattern
description: Auth middleware conventions and design decisions for the WhatsApp/chat routes added in Phase 5
---

# Phase 5 Chat Routes — Auth & Design Decisions

## Rule
The project uses `requireAdmin` (imported from `./auth`) as the standard auth middleware for protected API routes. There is no `requireAuth` or `authenticate` middleware exported from auth.ts.

**Why:** Using `requireAuth` causes a ReferenceError at startup. Always import and use `requireAdmin` for admin-protected routes.

**How to apply:** Any new route that requires an authenticated staff/admin user should use `requireAdmin` as middleware. For routes accessible by portal customers (unauthenticated), add no middleware or use `requireCustomerAuth`.

## FAQ endpoint visibility
- `GET /api/faq` — public (no middleware); the WhatsApp webhook calls it server-side and the portal chatbot may fetch it
- `POST/PUT/DELETE /api/faq/:id` — requireAdmin

## req.user access
`req.user` is typed on the Express Request object directly (not `(req as any).user`). The pattern `req.user?.id` works without casting.

## Portal chat routes
Portal chat routes (`/api/portal/chat/*`) have no auth middleware — they are open endpoints used by portal customers who are authenticated via session cookie from portal-login, not by admin JWT.

## WhatsApp webhook
`GET /api/webhooks/whatsapp` and `POST /api/webhooks/whatsapp` have no auth middleware — Meta calls these externally. The verify token is `process.env.WHATSAPP_VERIFY_TOKEN || "globipos_whatsapp"`.
