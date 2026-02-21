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
