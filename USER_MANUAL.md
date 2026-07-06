# GlobiPOS User Manual

GlobiPOS is a wholesale wine & spirits management system with an integrated multi-location point-of-sale (POS) platform. This manual covers all four applications that make up the system:

1. **Main App** — back-office administration and the customer web portal
2. **PDA App** — handheld scanner tools for warehouse/floor staff
3. **POS App** — native till/checkout application for cashiers
4. **Customer App** — standalone mobile storefront for customers

---

## 1. Getting Started

### 1.1 Logging In
- Open the Main App and sign in with your username and password.
- **Two-factor authentication (2FA) is mandatory.** If this is your first login, you will be guided through a one-time TOTP setup (using an authenticator app such as Google Authenticator or Authy) before you can access anything else.
- If you lose access to your authenticator app, ask an admin to reset your 2FA from the **Users** page — you will be prompted to set it up again on your next login.

### 1.2 User Roles
GlobiPOS uses a three-tier permission system:

| Role | Access |
|---|---|
| **Superuser** | Full access to everything, including the Settings gate and all modules. |
| **Admin** | Full access to all modules. |
| **Staff** | Restricted to a configurable subset of modules (assigned by an admin), such as Items, Customers, Invoices, Payments, Suppliers, Pricing, Accounting, Reports, Email Logs, Import, and Statements. If no restrictions are set, staff have full access. |

Admins manage users and permissions from **Settings → Users**.

---

## 2. Main App (Back Office)

The Main App is where day-to-day business administration happens: catalog and customer management, sales documents, purchasing, accounting, reporting, and system configuration.

### 2.1 Navigation
The left sidebar is grouped into sections: **Overview, Sales, Purchasing, Pricing, Accounting, Analytics, System, GlobiPOS, Digital Signage,** and **Admin**. Collapse the sidebar for more screen space using the toggle at the top.

### 2.2 Dashboard
The home page (`/`) shows key business metrics at a glance: sales totals, top-selling items, and revenue trends over time.

### 2.3 Items & Categories
- **Items** (`/items`): Manage your full product catalog — SKUs, categories, pack sizes, barcodes, and up to **5 configurable price levels** per item. Stock is tracked at the individual bottle/piece level, with the UI showing both bottle count and pack equivalents.
- **Categories** (`/categories`): Organize items into a category hierarchy used throughout pricing, reporting, and the customer-facing shop.

### 2.4 Customers
Manage customer accounts, contact details, payment terms, and price-level assignment. Customer statements with aging analysis are available for account follow-up.

### 2.5 Sales Documents
GlobiPOS supports four document types, all created through the same multi-step wizard (`/invoices/new`):

- **Invoice** — a finalized sale.
- **Credit Note** — a reversal/adjustment against a customer account.
- **Proforma** — a non-binding preview of a sale; can be converted to an invoice.
- **Quotation** — a price quote for a customer; can be converted to an invoice.

Each document automatically applies the customer's pricing tier and any active pricing contracts.

### 2.6 Purchasing
- **Suppliers**: Manage supplier records and running balances.
- **Purchase Invoices** (`/purchase-invoices`): Record stock received from suppliers. Purchase invoices automatically update stock quantities, supplier balances, and generate the appropriate accounting journal entries.
- **Goods Received via PDA (GRV)**: See section 3.5 — GRVs created on the PDA app are finalized here and become real purchase invoices.

### 2.7 Pricing
- **Pricing Contracts**: Flexible discount rules by minimum quantity, category, or brand, with percentage or fixed discounts.
- **Purchase Goals / Vouchers**: Reward programs where customers earn vouchers for hitting spending thresholds.

### 2.8 Accounting
Full double-entry bookkeeping under **Accounting**:
- **Chart of Accounts** — the account structure.
- **Journal Entries** — manual and automatically generated entries (invoices, payments, purchases all post automatically).
- **Expenses** — non-purchase expense tracking.
- **Financial Reports**: Trial Balance, Profit & Loss, Balance Sheet, General Ledger, and the Cyprus VAT 4 Return.
- **Audit Grid** (`/accounting/audit`): A four-tab diagnostic tool —
  1. **Transaction Audit** — dense XLS-style grid of every journal line with balance checks, filters, and CSV export.
  2. **Data Dictionary** — reference for account mapping rules and integrity checks.
  3. **Simulation** — visual walkthrough of how each transaction type flows through the books.
  4. **Snapshots** — save named checkpoints of the accounting state, compare balances between any two snapshots, and roll back if needed.

### 2.9 Reporting
Sales reports (including profit margin analysis), customer statements, and email delivery of documents/statements directly from the app.

### 2.10 PDA Operations (`/pda-operations`)
Back-office visibility into everything staff do on the handheld PDA app:
- Stock take sessions
- Stock transfers between locations
- **Goods Received (GRV)** — review OCR-imported supplier invoices, resolve any items or suppliers the system couldn't auto-match, see a discrepancy count per GRV, and open the generated purchase invoice directly.

### 2.11 POS Management (`/pos/*`)
Configure the multi-location point-of-sale platform: locations, terminals, register layouts, and in-store promotions. This is where admins register new POS terminals and manage cashiers.

### 2.12 Digital Signage (`/signage`)
Manage playlists of content (images, promotions, videos) shown on in-store customer-facing screens.

### 2.13 Data Import & Backup
- **Import** (`/import`): Bulk-upload items, customers, and suppliers from Excel/CSV, with smart column matching.
- **Backup & Restore**: Full and differential backups are supported.
  - *Full backup* exports everything.
  - *Differential backup* exports only new transactions since the last backup (invoices, payments, journal entries, expenses, purchase invoices), plus all config tables (customers, items, suppliers).
  - A daily scheduled backup runs automatically and emails you a copy (via Resend), switching to differential mode within 8 days of the last backup.
  - Restores support both full (wipe-and-replace) and differential (merge) modes, with a preview step before committing.

### 2.14 Customer Portal (`/portal/*`)
A customer-facing web experience embedded in the Main App: dashboard, shop/catalog, order history, loyalty points, and an AI shopping assistant/chat.

### 2.15 Settings & Users
- **Settings** is password-protected (superusers bypass this).
- **Users** tab (next to Settings): create/manage staff and admin accounts, assign module permissions, and reset a user's 2FA.

---

## 3. PDA App (Handheld Scanner Tools)

A mobile-optimized web app for warehouse and shop-floor staff, designed to run on handheld barcode scanners or phones. Navigation is via a fixed bottom bar.

### 3.1 Price Lookup
Scan any barcode to instantly see the item's current price and stock level — useful for quick customer questions on the shop floor.

### 3.2 Stock Take
Run inventory count sessions: scan items one by one, and the system tracks counted quantities against expected stock so discrepancies can be reviewed and applied.

### 3.3 Labels / Agoranomia
Print or verify shelf-edge price labels for regulatory compliance checks.

### 3.4 Transfers
Move stock between locations (e.g., warehouse → shop) with a scan-based workflow.

### 3.5 Invoice Import (OCR + Goods Received Voucher)
This is the fastest way to receive stock from a supplier:
1. **Photograph the invoice** using the PDA camera. The system uses AI (OpenAI vision) to read the supplier name, invoice number/date, and every line item.
2. The system tries to automatically match the supplier and each item against your existing records.
3. A **Goods Received Voucher (GRV)** is created, listing the expected quantities from the invoice.
4. **Scan the physical goods** as they arrive — the app reconciles scanned quantities against what the invoice said should be there, flagging any mismatches or unrecognized items.
5. **Finalize the GRV.** This creates a real purchase invoice — updating stock, the supplier's balance, and posting the accounting journal entry — exactly as if it had been entered manually. If any quantities didn't reconcile, the GRV (and resulting purchase invoice) is flagged with a discrepancy note for back-office follow-up.
6. If you lose connectivity mid-scan, your scanned quantities are buffered on the device and automatically synced once you're back online.

Any GRV lines the system couldn't auto-match to a supplier or item can be resolved manually from **PDA Operations → Goods Received** in the Main App.

### 3.6 Receipts
View and review previously completed goods receipts.

---

## 4. POS App (Till / Checkout)

A native, installable checkout application for cashiers, built for speed at the till.

### 4.1 Setup & Login
- **Setup**: On first run, a terminal is registered with the server (API URL + Terminal ID) by an admin.
- **Login**: Cashiers sign in with a quick PIN code, not a full username/password.

### 4.2 Main POS Screen
The primary selling interface — barcode scanning, a category sidebar for browsing items, a numpad for manual entry/quantity adjustments, and an action bar for discounts, holds, and payment.

### 4.3 Self-Checkout Mode
A simplified version of the POS screen designed for customers to operate directly, for stores offering self-checkout kiosks.

### 4.4 Shift Management
Cashiers and admins can open/close shifts, run X and Z reports, and record cash drops from the **Shift Manager**.

### 4.5 Card Payments
When a customer pays by card, the terminal charge is tracked with a reference number. If a connection issue occurs mid-charge, the system checks the persisted charge status before ever telling staff to retry — preventing an accidental double-charge.

### 4.6 Barcode Configuration
Admins can configure rules for scale-generated and weighted-item barcodes (e.g. deli/produce scale prefixes) so the till correctly parses embedded weights and prices.

---

## 5. Customer App (Mobile Storefront)

A dedicated, lightweight storefront for customers to browse and order — usable as a standalone mobile web app. Navigation is a 5-tab bottom bar.

### 5.1 Catalog
Browse and search the full product catalog, filterable by category.

### 5.2 Basket
Review items in your cart, adjust quantities, and proceed to checkout.

### 5.3 Orders
Track the status of current orders and view full order history.

### 5.4 Loyalty
View your loyalty points balance and any available coupons or offers. Customers earn **1 point per €1** spent (subtotal) on every order, whether placed through the Customer App/Portal or entered manually. Points accumulate toward Bronze, Silver, and Gold tiers.

### 5.5 Account
Manage your profile, delivery addresses, and notification preferences.

---

## 6. WhatsApp Ordering

Customers can also order via WhatsApp. Messages sent to the connected WhatsApp Business number are picked up automatically by a chatbot that can answer FAQs and help place an order, with the conversation and messages visible to staff in the Main App under **WhatsApp Orders**.

---

## 7. Tips & Troubleshooting

- **Can't access a page?** Your account may not have permission for that module — ask an admin to update your access under **Settings → Users**.
- **Lost your 2FA device?** Ask an admin to reset 2FA for your account; you'll set it up again on next login.
- **Working offline?** The Main App caches items and customers locally and queues unsynced invoices, syncing automatically once you're back online. It can also be installed as a Progressive Web App (PWA) on mobile devices for an app-like, offline-friendly experience.
- **A GRV or purchase invoice looks wrong?** Check **PDA Operations → Goods Received** for a discrepancy note, then open the linked purchase invoice to correct it if needed.
- **Need to undo a mistake in the books?** Use **Accounting → Audit Grid → Snapshots** to compare or roll back to an earlier checkpoint.

---

*This manual reflects the current state of GlobiPOS. As new features are added, this document should be updated to match.*
