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

## API Routes
- `/api/dashboard/stats` - Dashboard statistics
- `/api/categories` - CRUD for categories
- `/api/items` - CRUD for items, `/api/items/barcode/:barcode` for barcode lookup
- `/api/customers` - CRUD for customers
- `/api/invoices` - CRUD for invoices/credit notes/proforma
- `/api/invoices/type/:type` - Filter by document type
- `/api/price-contracts` - Pricing contracts
- `/api/seasonal-offers` - Seasonal offers
- `/api/reports/sales/:from/:to/:customerId` - Sales report
- `/api/reports/statements` - Customer statements

## Recent Changes
- 2026-02-18: Initial MVP build with full schema, frontend, and backend
