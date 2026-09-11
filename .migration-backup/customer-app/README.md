# GlobiPOS Customer PWA

A standalone mobile-first Progressive Web App for customers to browse the catalog, place orders, track invoices, and earn loyalty points.

## Tech Stack

- **Vite 5** + **React 18** + **TypeScript**
- **Tailwind CSS** for styling
- **vite-plugin-pwa** for service worker + manifest
- **TanStack Query** for data fetching
- **Wouter** for routing
- **Tauri 2** for native kiosk wrapper (optional)

## Quick Start

```bash
# From the customer-app/ directory:
npm install
npm run dev        # starts dev server on port 5174
```

The app proxies `/api/*` to `http://localhost:5000` (the main GlobiPOS server).

## Authentication

Two login methods are supported:

1. **OTP via email** — customer enters their registered email, receives a 6-digit code, and logs in
2. **Customer code + access code** — classic portal login using customer code (e.g. CUST001) and portal password

Both methods return a JWT stored in `localStorage` as `globi_customer_token`.

## Pages

| Route       | Page     | Description                                  |
|-------------|----------|----------------------------------------------|
| `/`         | Catalog  | Browse products, filter by category, scan barcode |
| `/basket`   | Basket   | Cart with delivery/collection choice         |
| `/orders`   | Orders   | Order history + one-tap reorder              |
| `/account`  | Account  | Invoices, statement, credit meter            |
| `/loyalty`  | Loyalty  | Points balance, tier badge, history          |

## Barcode Scanning

Uses the native browser **BarcodeDetector API** (supported in Chrome/Edge, Android WebView). Automatically falls back gracefully when unsupported.

## Push Notifications

- Registers via `/api/customer/push/subscribe` (requires `VAPID_PUBLIC_KEY` env var on the server)
- Subscribes using `vite-plugin-pwa`'s generated service worker
- Opt-in banner shown on first login

## PWA Install

The app is installable on Android/iOS home screens. The manifest configures:
- Standalone display mode
- Theme color `#722F37` (burgundy)
- App shortcuts to Shop and Orders

## Tauri Kiosk Mode

The `src-tauri/` subfolder contains a Tauri 2 wrapper for deploying as a fullscreen kiosk on Android/Linux touch screens.

```bash
# Install Tauri CLI + Rust first, then:
npm run tauri:dev    # development kiosk
npm run tauri:build  # production build
```

The kiosk window is:
- Fullscreen + always on top
- Decorations disabled
- Cursor hidden on Linux touch displays
- Exposes `kiosk_quit` and `kiosk_reload` commands

## Environment Variables

| Variable           | Description                          |
|--------------------|--------------------------------------|
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key (optional) |

The API base URL is automatically proxied to the main GlobiPOS server in development.

## Building for Production

```bash
npm run build
# Output in dist/ — serve with any static host or embed in GlobiPOS server
```
