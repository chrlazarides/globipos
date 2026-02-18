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

## Recent Changes
- 2026-02-18: Added supplier management, purchase invoices with stock impact, supplier payments register
- 2026-02-18: Stock now tracked per bottle with pack equivalent display
- 2026-02-18: Sales invoices/credit notes now affect stock levels per bottle
- 2026-02-18: Initial MVP build with full schema, frontend, and backend
