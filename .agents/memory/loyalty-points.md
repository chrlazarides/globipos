---
name: Loyalty Points System
description: 1 pt per €1 subtotal; awarded on portal orders and /api/customer/orders; tiers Bronze/Silver/Gold
---

## Earning rules
- 1 loyalty point per €1 of order subtotal (floor division)
- Awarded automatically on:
  - Portal order submit (`POST /api/portal/orders`) — non-fatal, won't block order
  - Customer PWA order submit (`POST /api/customer/orders`) — non-fatal

## Tiers
- **Bronze**: 0+ points
- **Silver**: 1000+ points  
- **Gold**: 5000+ points

## Database
- Table: `customerLoyaltyPoints` in `shared/schema.ts`
- Fields: `customerId`, `points`, `type` (earn/redeem), `reason`, `sourceType`, `sourceId`

## API endpoints
- `GET /api/customer/loyalty` — returns `{ totalPoints, tier, history[] }` (JWT protected)
- `GET /api/portal/customer/:id/loyalty` — same data, portal session pattern (no JWT)

**Why:**
Points are awarded non-fatally (`.catch(() => {})`) so a loyalty DB failure never blocks order creation.
