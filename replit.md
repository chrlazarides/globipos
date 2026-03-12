# VinTrade - Wholesale Wine & Spirits Management System

## Overview
VinTrade is a comprehensive stock and invoicing system designed for wholesale customers in the wine and spirits industry. It streamlines operations from item catalog management and customer accounts to diverse document types (invoices, credit notes, proforma, quotations), advanced pricing contracts, and seasonal offers. Key capabilities include robust reporting, mobile barcode scanning for efficient order creation, and integrated accounting with double-entry bookkeeping, financial reports, and VAT returns. The system also supports offline functionality and is deployable as a Progressive Web App (PWA).

## User Preferences
I prefer iterative development with clear communication on major changes. Please ask before implementing significant architectural shifts or feature additions. I like seeing high-level summaries of progress and potential next steps. I prefer detailed explanations for complex technical decisions.

## System Architecture
VinTrade is built with a modern web stack:
- **Frontend**: React, TypeScript, Vite, utilizing Shadcn/ui for components, TanStack Query for data fetching, and Wouter for routing.
- **Backend**: An Express.js REST API.
- **Database**: PostgreSQL, managed with Drizzle ORM.
- **Styling**: Tailwind CSS, with a wine-themed color scheme (burgundy as primary).
- **UI/UX**: Features a consistent design language with reusable components (sidebar, data-tables, stat-cards). Documents (invoices, statements) are generated dynamically in PDF/HTML format, pulling company details and currency from database settings.
- **Key Features**:
    - **Item & Customer Management**: Detailed item catalog (with categories, pack sizes, 5 price levels) and customer accounts (with various payment terms).
    - **Document Generation**: Supports Invoice, Credit Note, Proforma, and Quotation document types. Quotations and Proformas can be converted to invoices.
    - **Advanced Pricing**: Flexible pricing contracts with discount rules (minQuantity, category, brand specific, percentage/fixed discounts) and purchase goal/voucher reward systems.
    - **Stock Management**: Stock quantity is tracked per individual bottle/piece, with automatic adjustments for sales and purchases, and display showing both bottle count and pack equivalents.
    - **Accounting Module**: Implements double-entry bookkeeping with a chart of accounts, journal entries, expense tracking, and automated journal entry generation for transactions (invoices, payments, purchases). Provides financial reports: Trial Balance, Profit & Loss, Balance Sheet, General Ledger, and Cyprus VAT 4 Return.
    - **Offline Capability**: Supports offline invoicing by caching essential data (items, customers) in IndexedDB and queuing unsynced invoices. Automatically syncs when online.
    - **PWA Support**: Installable as a Progressive Web App on mobile devices, offering an app-like experience with offline asset caching via a service worker.
    - **Security & User Management**: Role-based access control (admin/staff) with JWT-based authentication, httpOnly cookies, and an activity/audit log for all mutating API calls. Settings page access is password protected.
    - **Reporting**: Comprehensive sales reports (including profit margin analysis), customer statements with aging analysis, and email functionality for documents and statements.
    - **Data Management**: Includes smart Excel import functionality for various entities and a scheduled daily backup feature.

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **SendGrid**: Integrated for sending email notifications, specifically for invoice documents and customer statements.
- **Resend**: Used for sending automatic daily backup emails.
- **IndexedDB**: Utilized for client-side data caching to support offline functionality.