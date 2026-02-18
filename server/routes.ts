import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCategorySchema, insertItemSchema, insertCustomerSchema, insertPriceContractSchema, insertSeasonalOfferSchema, insertInvoiceSchema, insertInvoiceItemSchema, insertPaymentSchema, insertPortalOrderSchema, insertPortalOrderItemSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Dashboard
  app.get("/api/dashboard/stats", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Categories
  app.get("/api/categories", async (_req, res) => {
    const cats = await storage.getCategories();
    res.json(cats);
  });

  app.post("/api/categories", async (req, res) => {
    try {
      const data = insertCategorySchema.parse(req.body);
      if (data.parentId === "none" || data.parentId === "") data.parentId = null;
      const cat = await storage.createCategory(data);
      res.json(cat);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Items
  app.get("/api/items", async (_req, res) => {
    const allItems = await storage.getItems();
    res.json(allItems);
  });

  app.get("/api/items/:id", async (req, res) => {
    const item = await storage.getItem(req.params.id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.get("/api/items/barcode/:barcode", async (req, res) => {
    const item = await storage.getItemByBarcode(req.params.barcode);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.post("/api/items", async (req, res) => {
    try {
      const data = insertItemSchema.parse(req.body);
      if (data.categoryId === "") data.categoryId = null;
      const item = await storage.createItem(data);
      res.json(item);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/items/:id", async (req, res) => {
    try {
      const item = await storage.updateItem(req.params.id, req.body);
      if (!item) return res.status(404).json({ message: "Item not found" });
      res.json(item);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Customers
  app.get("/api/customers", async (_req, res) => {
    const custs = await storage.getCustomers();
    res.json(custs);
  });

  app.get("/api/customers/:id", async (req, res) => {
    const cust = await storage.getCustomer(req.params.id);
    if (!cust) return res.status(404).json({ message: "Customer not found" });
    res.json(cust);
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const data = insertCustomerSchema.parse(req.body);
      const cust = await storage.createCustomer(data);
      res.json(cust);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const cust = await storage.updateCustomer(req.params.id, req.body);
      if (!cust) return res.status(404).json({ message: "Customer not found" });
      res.json(cust);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Price Contracts
  app.get("/api/price-contracts", async (_req, res) => {
    const contracts = await storage.getPriceContracts();
    res.json(contracts);
  });

  app.post("/api/price-contracts", async (req, res) => {
    try {
      const data = insertPriceContractSchema.parse(req.body);
      const contract = await storage.createPriceContract(data);
      res.json(contract);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Seasonal Offers
  app.get("/api/seasonal-offers", async (_req, res) => {
    const offers = await storage.getSeasonalOffers();
    res.json(offers);
  });

  app.post("/api/seasonal-offers", async (req, res) => {
    try {
      const data = insertSeasonalOfferSchema.parse(req.body);
      const offer = await storage.createSeasonalOffer(data);
      res.json(offer);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Invoices
  app.get("/api/invoices", async (req, res) => {
    const type = req.query.type as string | undefined;
    // Handle TanStack query key format: /api/invoices/invoice
    const invs = await storage.getInvoices(type);
    res.json(invs);
  });

  // Specific invoice type route for TanStack query key format
  app.get("/api/invoices/type/:type", async (req, res) => {
    const invs = await storage.getInvoices(req.params.type);
    res.json(invs);
  });

  app.get("/api/invoices/:id", async (req, res) => {
    // Skip non-UUID ids
    if (req.params.id === "new" || req.params.id === "type") return res.status(404).json({ message: "Not found" });
    const inv = await storage.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    res.json(inv);
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const { items: lineItems, ...invoiceData } = req.body;
      const data = insertInvoiceSchema.parse({ ...invoiceData, invoiceNumber: "TEMP" });
      const parsedItems = (lineItems || []).map((li: any) => insertInvoiceItemSchema.parse({ ...li, invoiceId: "TEMP" }));
      const inv = await storage.createInvoice(data, parsedItems);
      res.json(inv);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const { items: lineItems, ...invoiceData } = req.body;
      const parsedItems = lineItems ? (lineItems as any[]).map((li: any) => insertInvoiceItemSchema.parse({ ...li, invoiceId: req.params.id })) : undefined;
      const inv = await storage.updateInvoice(req.params.id, invoiceData, parsedItems);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      res.json(inv);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // PDF Generation
  app.get("/api/invoices/:id/pdf", async (req, res) => {
    try {
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      const customer = await storage.getCustomer(inv.customerId);
      const typeLabel = inv.type === "credit_note" ? "CREDIT NOTE" : inv.type === "proforma" ? "PROFORMA INVOICE" : "INVOICE";

      const html = generateInvoiceHtml(inv, customer, typeLabel);

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.html"`);
      res.send(html);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Payments
  app.post("/api/payments", async (req, res) => {
    try {
      const data = insertPaymentSchema.parse(req.body);
      const payment = await storage.createPayment(data);
      res.json(payment);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Reports
  app.get("/api/reports/sales", async (req, res) => {
    try {
      const from = (req.query.from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const to = (req.query.to as string) || new Date().toISOString().split("T")[0];
      const customerId = req.query.customerId as string | undefined;
      const report = await storage.getSalesReport(from, to, customerId);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Handle TanStack query key format for sales report
  app.get("/api/reports/sales/:from/:to/:customerId", async (req, res) => {
    try {
      const report = await storage.getSalesReport(req.params.from, req.params.to, req.params.customerId);
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/reports/statements", async (_req, res) => {
    try {
      const statements = await storage.getCustomerStatements();
      res.json(statements);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/reports/statement/:customerId/pdf", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const statements = await storage.getCustomerStatements();
      const st = statements.find(s => s.customerId === req.params.customerId);
      const html = generateStatementHtml(customer, st);
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="statement-${customer.code}.html"`);
      res.send(html);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // System Settings
  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!Array.isArray(settings)) return res.status(400).json({ message: "Settings array required" });
      const results = [];
      for (const s of settings) {
        const result = await storage.upsertSetting(s.key, s.value, s.label, s.group);
        results.push(result);
      }
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/settings/seed-defaults", async (_req, res) => {
    try {
      const defaults = [
        { key: "company_name", value: "VinTrade", label: "Company Name", group: "company" },
        { key: "company_address", value: "Limassol, Cyprus", label: "Company Address", group: "company" },
        { key: "company_phone", value: "+357-25-000000", label: "Company Phone", group: "company" },
        { key: "company_email", value: "info@vintrade.cy", label: "Company Email", group: "company" },
        { key: "company_tax_id", value: "CY-00000000A", label: "Company Tax ID (TIN)", group: "company" },
        { key: "vat_rate", value: "19", label: "Default VAT Rate (%)", group: "tax" },
        { key: "currency", value: "EUR", label: "Currency", group: "tax" },
        { key: "currency_symbol", value: "€", label: "Currency Symbol", group: "tax" },
        { key: "invoice_prefix", value: "INV", label: "Invoice Number Prefix", group: "invoicing" },
        { key: "credit_note_prefix", value: "CN", label: "Credit Note Number Prefix", group: "invoicing" },
        { key: "proforma_prefix", value: "PF", label: "Proforma Number Prefix", group: "invoicing" },
        { key: "invoice_footer", value: "Thank you for your business", label: "Invoice Footer Message", group: "invoicing" },
        { key: "payment_terms_default", value: "cash", label: "Default Payment Terms", group: "invoicing" },
        { key: "low_stock_threshold", value: "10", label: "Low Stock Alert Threshold", group: "inventory" },
        { key: "portal_enabled", value: "true", label: "Customer Portal Enabled", group: "portal" },
        { key: "portal_allow_ordering", value: "true", label: "Allow Portal Ordering", group: "portal" },
      ];
      const results = [];
      for (const d of defaults) {
        const existing = await storage.getSetting(d.key);
        if (!existing) {
          const created = await storage.upsertSetting(d.key, d.value, d.label, d.group);
          results.push(created);
        } else {
          results.push(existing);
        }
      }
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Portal API Routes
  app.post("/api/portal/login", async (req, res) => {
    try {
      const { code, accessCode } = req.body;
      if (!code || !accessCode) return res.status(400).json({ message: "Customer code and access code required" });
      const customer = await storage.getCustomerByCode(code.toUpperCase());
      if (!customer) return res.status(401).json({ message: "Invalid credentials" });
      if (!customer.portalAccessCode || customer.portalAccessCode !== accessCode) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if (!customer.active) return res.status(403).json({ message: "Account is inactive" });
      res.json({ customer });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/customer/:id", async (req, res) => {
    const customer = await storage.getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ message: "Not found" });
    res.json(customer);
  });

  app.get("/api/portal/customer/:id/invoices", async (req, res) => {
    try {
      const invoices = await storage.getCustomerInvoices(req.params.id);
      res.json(invoices);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/customer/:id/orders", async (req, res) => {
    try {
      const orders = await storage.getPortalOrders(req.params.id);
      res.json(orders);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/customer/:id/statement", async (req, res) => {
    try {
      const statements = await storage.getCustomerStatements();
      const st = statements.find(s => s.customerId === req.params.id);
      res.json(st || { customerId: req.params.id, customerName: "", totalInvoiced: "0.00", totalPaid: "0.00", balance: "0.00", invoiceCount: 0 });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/portal/catalog", async (_req, res) => {
    try {
      const items = await storage.getAvailableItems();
      const cats = await storage.getCategories();
      res.json({ items, categories: cats });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/portal/orders", async (req, res) => {
    try {
      const { customerId, items: orderItems, notes } = req.body;
      if (!customerId || !orderItems?.length) {
        return res.status(400).json({ message: "Customer and items required" });
      }
      const customer = await storage.getCustomer(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const VAT_RATE = 0.19;
      let subtotal = 0;
      const processedItems: any[] = [];

      for (const oi of orderItems) {
        const item = await storage.getItem(oi.itemId);
        if (!item) continue;
        if (item.stockQuantity < oi.quantity) {
          return res.status(400).json({ message: `Not enough stock for ${item.name}. Available: ${item.stockQuantity}` });
        }
        const priceKey = `price${customer.priceLevel}` as keyof typeof item;
        const unitPrice = parseFloat(String(item[priceKey] || item.price1));
        const lineTotal = unitPrice * oi.quantity;
        subtotal += lineTotal;
        processedItems.push({
          itemId: item.id,
          itemName: item.name,
          quantity: oi.quantity,
          unitPrice: unitPrice.toFixed(2),
          total: lineTotal.toFixed(2),
        });
      }

      const vatAmount = subtotal * VAT_RATE;
      const total = subtotal + vatAmount;

      const order = await storage.createPortalOrder(
        { customerId, subtotal: subtotal.toFixed(2), vatAmount: vatAmount.toFixed(2), total: total.toFixed(2), notes: notes || null, status: "pending" },
        processedItems.map(pi => ({ ...pi, orderId: "TEMP" }))
      );

      for (const oi of orderItems) {
        const item = await storage.getItem(oi.itemId);
        if (item) {
          await storage.updateItem(item.id, { stockQuantity: item.stockQuantity - oi.quantity });
        }
      }

      res.json(order);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}

function generateInvoiceHtml(inv: any, customer: any, typeLabel: string) {
  const itemRows = (inv.items || []).map((li: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${li.description}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">€${parseFloat(li.unitPrice).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">€${parseFloat(li.discount).toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">€${parseFloat(li.total).toFixed(2)}</td>
    </tr>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${inv.invoiceNumber}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; color: #333; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .title { font-size: 28px; font-weight: 700; color: #8b2252; }
  .doc-type { font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 2px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
  .info-box h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin: 0 0 8px; }
  .info-box p { margin: 2px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
  th { background: #f8f5f0; padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .totals { display: flex; justify-content: flex-end; }
  .totals-table td { padding: 6px 16px; font-size: 14px; }
  .totals-table .grand-total td { font-size: 18px; font-weight: 700; color: #8b2252; border-top: 2px solid #8b2252; }
  .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">VinTrade</div>
      <div class="doc-type">Wholesale Wine & Spirits</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:20px;font-weight:700;">${typeLabel}</div>
      <div style="font-size:14px;color:#666;">${inv.invoiceNumber}</div>
    </div>
  </div>
  <div class="info-grid">
    <div class="info-box">
      <h3>Bill To</h3>
      <p style="font-weight:600;">${customer?.name || "N/A"}</p>
      <p>${customer?.address || ""}</p>
      <p>${customer?.city || ""}</p>
      ${customer?.taxId ? `<p>Tax ID: ${customer.taxId}</p>` : ""}
    </div>
    <div class="info-box" style="text-align:right;">
      <h3>Details</h3>
      <p>Date: ${new Date(inv.date).toLocaleDateString()}</p>
      ${inv.dueDate ? `<p>Due: ${new Date(inv.dueDate).toLocaleDateString()}</p>` : ""}
      <p>Status: ${inv.status}</p>
      <p>Terms: ${customer?.paymentTerms || "N/A"}</p>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>Description</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Discount</th><th style="text-align:right;">Total</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="totals">
    <table class="totals-table">
      <tr><td>Subtotal</td><td style="text-align:right;">€${parseFloat(inv.subtotal).toFixed(2)}</td></tr>
      <tr><td>Tax (${inv.taxRate}%)</td><td style="text-align:right;">€${parseFloat(inv.taxAmount).toFixed(2)}</td></tr>
      <tr class="grand-total"><td>Total</td><td style="text-align:right;">€${parseFloat(inv.total).toFixed(2)}</td></tr>
    </table>
  </div>
  ${inv.notes ? `<div style="margin-top:30px;padding:16px;background:#f8f5f0;border-radius:6px;font-size:13px;"><strong>Notes:</strong> ${inv.notes}</div>` : ""}
  <div class="footer">
    <p>VinTrade - Wholesale Wine & Spirits Management</p>
    <p>Thank you for your business</p>
  </div>
</body>
</html>`;
}

function generateStatementHtml(customer: any, statement: any) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Statement - ${customer.name}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; color: #333; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .title { font-size: 28px; font-weight: 700; color: #8b2252; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 30px; }
  .summary-card { background: #f8f5f0; padding: 20px; border-radius: 8px; }
  .summary-card h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin: 0 0 8px; }
  .summary-card .value { font-size: 24px; font-weight: 700; }
  .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">VinTrade</div>
      <div style="font-size:14px;color:#666;">ACCOUNT STATEMENT</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px;font-weight:600;">${customer.name}</div>
      <div style="font-size:13px;color:#666;">${customer.code}</div>
      <div style="font-size:13px;color:#666;">${new Date().toLocaleDateString()}</div>
    </div>
  </div>
  <div style="margin-bottom:20px;">
    <p>${customer.address || ""}</p>
    <p>${customer.city || ""}</p>
    <p>Terms: ${customer.paymentTerms}</p>
  </div>
  <div class="summary">
    <div class="summary-card">
      <h3>Total Invoiced</h3>
      <div class="value">€${statement?.totalInvoiced || "0.00"}</div>
    </div>
    <div class="summary-card">
      <h3>Total Paid</h3>
      <div class="value">€${statement?.totalPaid || "0.00"}</div>
    </div>
    <div class="summary-card">
      <h3>Balance Due</h3>
      <div class="value" style="color:#8b2252;">€${statement?.balance || "0.00"}</div>
    </div>
  </div>
  <div class="footer">
    <p>VinTrade - Wholesale Wine & Spirits Management</p>
  </div>
</body>
</html>`;
}
