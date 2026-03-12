# VinTrade - Wholesale Wine & Spirits Management System

## Overview
A comprehensive stock and invoicing system for wholesale customers purchasing wines and spirits. Features include item catalog management, customer accounts with payment terms, multiple document types (invoices, credit notes, proforma), pricing contracts, seasonal offers, reports, and mobile barcode scanning.

## Architecture
- **Frontend**: React + TypeScript + Vite, Shadcn/ui components, TanStack Query, Wouter routing
- **Backend**: Express.js REST API
- **Database**: PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS with wine-themed color scheme (burgundy primary)

## Key Features
- Item catalog with categories, pack sizes (pc, 6-pack, 12-pack), 5 price levels
- Customer management with payment terms (cash, credit 7/14/30/60/90 days)
- Invoice, Credit Note, and Proforma document creation
- Pricing contracts per customer with discounts
- Seasonal offers with mix & match capability
- Reports and customer account statements
- Barcode scanning for mobile invoice creation
- PDF/HTML document generation

## Project Structure
- `shared/schema.ts` - All Drizzle ORM models and Zod schemas
- `server/db.ts` - Database connection
- `server/storage.ts` - IStorage interface and DatabaseStorage implementation
- `server/routes.ts` - All API routes
- `server/seed.ts` - Database seeding with sample data
- `client/src/pages/` - All page components (dashboard, items, customers, invoices, pricing, offers, reports)
- `client/src/components/` - Shared components (sidebar, data-table, stat-card, barcode-scanner, etc.)

## Stock Management
- stockQuantity always stored as individual bottles/pieces
- When purchasing in packs: bottles added = quantity * packSize
- When selling in packs: bottles subtracted = quantity * packSize
- Items display shows both bottle count and pack equivalent (e.g. "48 btls (8 packs)")
- Sales invoices subtract stock on creation (non-draft); credit notes restore stock
- Purchase invoices add stock on creation

## API Routes
- `/api/dashboard/stats` - Dashboard statistics
- `/api/categories` - CRUD for categories
- `/api/items` - CRUD for items, `/api/items/barcode/:barcode` for barcode lookup
- `/api/customers` - CRUD for customers
- `/api/invoices` - CRUD for invoices/credit notes/proforma
- `/api/invoices/type/:type` - Filter by document type
- `/api/price-contracts` - Pricing contracts
- `/api/seasonal-offers` - Seasonal offers
- `/api/suppliers` - CRUD for suppliers
- `/api/purchase-invoices` - Purchase invoices from suppliers (affects stock)
- `/api/supplier-payments` - Supplier payment register
- `/api/reports/sales` - Sales report
- `/api/reports/statements` - Customer statements

## Price Contract System
- Contracts have a header (customer, period, purchase goal, voucher reward) and multiple discount rules
- Each rule specifies: categoryIds, brands, minQuantity, discountType (percentage/fixed), discountValue
- Rules stored in `price_contract_rules` table linked to `price_contracts`
- Invoice discount matching: iterates all rules across active contracts; discount is calculated off retail price (price1); only applies if resulting price is lower than the customer's assigned price level price (price floor check)
- Purchase goals: if customer meets spending target during contract period, they earn a voucher (% or fixed amount)
- API: GET /api/price-contracts returns contracts with rules inline; PUT /api/price-contracts/:id/rules to set rules

## Recent Changes
- 2026-02-18: Company settings now include IBAN, SWIFT/BIC, Bank Name, Registration No. fields
- 2026-02-18: Invoice/statement HTML documents use dynamic company settings from DB (no hardcoded values)
- 2026-02-18: Invoice documents show bank details section when IBAN/SWIFT configured
- 2026-02-18: Currency symbol in documents pulled from settings (defaults to EUR)
- 2026-02-18: Price contracts redesigned with multi-rule discount system (price_contract_rules table)
- 2026-02-18: Contract rules enforce minQuantity and price-level floor check before applying discounts
- 2026-02-18: Added purchase goal and voucher reward fields to contracts (purchaseGoal, voucherType, voucherValue)
- 2026-02-18: Pricing UI completely redesigned with detail view, rules editor, and price comparison preview
- 2026-02-18: Price contracts now support multiple categories and brands (array fields categoryIds, brands)
- 2026-02-18: Brand/Producer field is now a dropdown populated from existing item brands
- 2026-02-18: Added /api/items/brands endpoint for distinct brand list
- 2026-02-18: Smart Excel import page (/import) with multi-sheet analysis, auto-detection, column mapping, live preview, verification
- 2026-02-18: Import endpoints for all entity types: /api/items/import, /api/customers/import, /api/suppliers/import, /api/categories/import
- 2026-02-18: Import supports sheetName parameter for multi-sheet Excel files
- 2026-02-18: Added Quotation document type alongside Invoice, Credit Note, Proforma
- 2026-02-18: Proforma and Quotation views have "Create Invoice" button to convert to invoice
- 2026-02-18: Added dual discount system (percentage + amount) on invoice lines with contract auto-apply
- 2026-02-18: Supplier country field added for international suppliers
- 2026-02-18: Added supplier management, purchase invoices with stock impact, supplier payments register
- 2026-02-21: Offline invoicing capability with IndexedDB caching (items, customers) and local invoice queue
- 2026-02-21: Offline indicator in sidebar header (amber "Offline Mode" badge) and invoice form (amber banner)
- 2026-02-21: Pending offline invoices shown on Invoices list with sync/discard options
- 2026-02-21: Auto-sync when internet returns with toast notifications for success/failure
- 2026-02-21: Files: client/src/lib/offline-store.ts (IndexedDB), client/src/hooks/use-online-status.ts (hook)
- 2026-02-18: Stock now tracked per bottle with pack equivalent display
- 2026-02-18: Sales invoices/credit notes now affect stock levels per bottle
- 2026-02-18: Initial MVP build with full schema, frontend, and backend
- 2026-02-19: Email sending via SendGrid integration for invoice documents
- 2026-02-19: Email log table and page (/email-logs) tracking all sent emails
- 2026-02-19: "Send" button on invoice view mode to email document to customer
- 2026-02-19: Email column added to customers list table
- 2026-02-19: API routes: POST /api/invoices/:id/send-email, GET /api/email-logs, GET /api/email-logs/customer/:customerId
- 2026-02-23: PWA (Progressive Web App) support - installable on Android and iPhone
- 2026-02-23: Web app manifest (client/public/manifest.json) with app name, icons, shortcuts, theme color
- 2026-02-23: Service worker (client/public/sw.js) for offline caching of static assets and API data
- 2026-02-23: PWA install hook (client/src/hooks/use-pwa-install.ts) with install prompt handling
- 2026-02-23: Install App button in sidebar footer when browser supports PWA installation
- 2026-02-23: Apple-specific meta tags for iOS home screen support (apple-mobile-web-app-capable)
- 2026-02-23: SVG app icons in client/public/icons/ (sizes: 72-512px) with burgundy VT branding
- 2026-02-28: Demo data seed/clear API endpoints (POST /api/demo/seed, POST /api/demo/clear)
- 2026-02-28: Settings page has "Demo Data Management" section with Load Demo Data and Remove All Data buttons
- 2026-02-28: Demo data includes 7 categories, 23 items (with brands), 10 Cyprus customers, 5 international suppliers, 8 documents (invoices/CN/PF/QT), 2 contracts, 3 offers
- 2026-02-28: Remove All Data has confirmation dialog; preserves system settings while clearing all transactional data
- 2026-03-04: Accounting module with double-entry bookkeeping (QuickBooks-style)
- 2026-03-04: Tables: accounts, journal_entries, journal_entry_lines, expenses
- 2026-03-04: Chart of Accounts page (/accounting/chart-of-accounts) with grouped view, add/edit, seed defaults (30+ accounts)
- 2026-03-04: Journal Entries page (/accounting/journal-entries) with create/view, debit=credit validation, expandable detail rows
- 2026-03-04: Expenses page (/accounting/expenses) with quick entry, auto VAT calc, auto journal entry generation
- 2026-03-04: Financial Reports page (/accounting/reports) with Trial Balance, Profit & Loss, Balance Sheet tabs
- 2026-03-04: General Ledger page (/accounting/general-ledger/:accountId) with running balance, date range filter
- 2026-03-04: Auto-journal entries: sales invoices (DR A/R, CR Revenue, CR VAT, DR COGS, CR Inventory), credit notes (reverse including COGS), purchase invoices (DR Inventory, DR VAT, CR A/P), customer payments (DR Cash/Bank, CR A/R), supplier payments (DR A/P, CR Cash/Bank), expenses (DR Expense, DR VAT, CR Payment acct)
- 2026-03-04: Default Chart of Accounts codes: 1000 Cash, 1010 Bank, 1100 A/R, 1200 Inventory, 2000 A/P, 2100 VAT, 3000 Equity, 4000 Revenue, 5000 COGS, 6000-7200 Operating Expenses
- 2026-03-04: Sidebar "Accounting" section with Chart of Accounts, Journal Entries, Expenses, Financial Reports links
- 2026-03-04: API: /api/accounts (CRUD + seed-defaults), /api/journal-entries, /api/expenses, /api/reports/trial-balance, profit-loss, balance-sheet, general-ledger
- 2026-03-06: Company name changed to "VINERIA DI MARE Trading" (default); all UI references are dynamic from settings
- 2026-03-06: Sidebar, portal header, portal login, page title, PWA manifest all read company name from /api/settings
- 2026-03-06: Customer statements have Preview (eye icon) and Send Email (paper plane icon) buttons
- 2026-03-06: API route: POST /api/reports/statement/:customerId/send-email for emailing statements
- 2026-03-06: Sales report now includes profit margin analysis: per-invoice cost/profit/margin, per-customer profitability table, and overall summary cards (Total Sales, Cost, Gross Profit, Margin %, Tax, Invoice Count)
- 2026-03-06: Profit calculated from invoice line items joined with items.costPrice; pack sales multiply cost by packSize
- 2026-03-09: Recalculate Balances feature (POST /api/accounts/recalculate) — deletes all journal entries, regenerates from all transactions (invoices, payments, purchase invoices, supplier payments, expenses), resets account balances
- 2026-03-09: "Recalculate Balances" button on Chart of Accounts page with spinning icon indicator
- 2026-03-09: Fixes production accounting corruption where accounts were seeded after invoices were already created
- 2026-03-10: Invoice view mode uses stored DB values for subtotal/taxAmount/total/discount — never recalculates summary amounts
- 2026-03-10: Customer account number (code) auto-generated as CUST0001, CUST0002, etc. via GET /api/customers/next-code
- 2026-03-10: Duplicate customer detection on create — checks name, email, taxId (case-insensitive); returns 409 with details
- 2026-03-10: Fixed VAT journal entry bug — invoices used non-existent data.vatTotal instead of data.taxAmount; purchase invoices used data.vatAmount
- 2026-03-10: Error messages from API now extract JSON message field for cleaner user-facing display
- 2026-03-10: Print CSS optimized — min-height: auto in print, reduced margins/spacing to prevent extra blank pages
- 2026-03-10: Cyprus quarterly VAT Return report (Form VAT 4) on Accounting Reports page
- 2026-03-10: VAT Return shows Output VAT (sales minus credit notes), Input VAT (purchases + expenses), Net VAT Payable/Refundable
- 2026-03-10: Quarter selector with 3-year range (previous, current, next year), shows period dates
- 2026-03-10: API: GET /api/reports/vat-return/:from/:to — aggregates from invoices, purchase_invoices, expenses tables
- 2026-03-11: Aging analysis added to customer statements — 5 buckets: Current, 1-30, 31-60, 61-90, 90+ days overdue
- 2026-03-11: Aging columns shown in Reports > Statements tab (color-coded: green/yellow/orange/red); rows highlight in red if overdue
- 2026-03-11: Aging analysis section added to printed/emailed statement HTML documents after the transaction table
- 2026-03-11: Aging computed only for unpaid invoices; uses dueDate if present, otherwise invoice date
- 2026-03-12: Settings page password protection — SHA-256 hashed password stored in system_settings; session remembered in sessionStorage
- 2026-03-12: Settings password gate shows lock screen before allowing access; Lock button to re-lock manually
- 2026-03-12: API: POST /api/settings/verify-password, POST /api/settings/change-password
- 2026-03-12: Automatic daily backup — GET /api/backup/export (JSON download), POST /api/backup/send-email (email via Resend)
- 2026-03-12: Backup includes all tables: categories, items, customers, suppliers, invoices, purchase invoices, payments, accounts, journal entries, expenses, settings (excluding password hash)
- 2026-03-12: Scheduled backup: runs 1 min after startup then every hour; sends if backup_auto=true and 24+ hours since last backup
- 2026-03-12: Backup & Security sections added to Settings page (separate from main settings groups)
- 2026-03-12: ensureDefaultSettings() on startup fixes known bad company names (e.g. "ALBANIA POWER") and ensures all settings keys exist
