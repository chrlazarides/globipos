import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCategorySchema, insertItemSchema, insertCustomerSchema, insertPriceContractSchema, insertSeasonalOfferSchema, insertInvoiceSchema, insertInvoiceItemSchema, insertPaymentSchema, insertPortalOrderSchema, insertPortalOrderItemSchema, insertSupplierSchema, insertPurchaseInvoiceSchema, insertPurchaseInvoiceItemSchema, insertSupplierPaymentSchema, categories, items, customers, invoices, invoiceItems, payments, priceContracts, priceContractRules, priceContractItems, seasonalOffers, seasonalOfferItems, suppliers, purchaseInvoices, purchaseInvoiceItems, supplierPayments, portalOrders, portalOrderItems, emailLogs } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import * as XLSX from "xlsx";
import { sendInvoiceEmail } from "./email";
import { db } from "./db";
import { sql } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

  app.get("/api/items/brands", async (_req, res) => {
    const allItems = await storage.getItems();
    const brandSet = new Set<string>();
    allItems.forEach(i => { if (i.brand) brandSet.add(i.brand); });
    const brands = Array.from(brandSet).sort();
    res.json(brands);
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

  app.get("/api/items/suggest-sku/:categoryId", async (req, res) => {
    try {
      const allItems = await storage.getItems();
      const categories = await storage.getCategories();
      const category = categories.find(c => c.id === req.params.categoryId);
      const prefix = category
        ? category.name.split(/\s+/).map(w => w[0]?.toUpperCase()).join("").substring(0, 3)
        : "ITM";
      const existing = allItems
        .filter(i => i.sku.startsWith(prefix + "-"))
        .map(i => parseInt(i.sku.replace(prefix + "-", "")) || 0);
      const next = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
      res.json({ sku: `${prefix}-${String(next).padStart(3, "0")}` });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
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

  app.post("/api/items/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = req.body.sheetName || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
      const categories = await storage.getCategories();
      const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          const sku = getValue("sku");
          if (!name || !sku) {
            results.errors.push({ row: i + 2, message: "Name and SKU are required" });
            continue;
          }

          const categoryName = getValue("category");
          let categoryId: string | null = null;
          if (categoryName) {
            categoryId = catMap.get(categoryName.toLowerCase()) || null;
            if (!categoryId) {
              const newCat = await storage.createCategory({ name: categoryName, description: null, parentId: null, active: true });
              categoryId = newCat.id;
              catMap.set(categoryName.toLowerCase(), newCat.id);
            }
          }

          const itemData = {
            name,
            sku,
            barcode: getValue("barcode") || null,
            description: getValue("description") || null,
            categoryId,
            unitType: getValue("unitType") || "pc",
            packSize: parseInt(getValue("packSize")) || 1,
            price1: getValue("price1") || "0",
            price2: getValue("price2") || "0",
            price3: getValue("price3") || "0",
            price4: getValue("price4") || "0",
            price5: getValue("price5") || "0",
            costPrice: getValue("costPrice") || "0",
            stockQuantity: parseInt(getValue("stockQuantity")) || 0,
            reorderLevel: parseInt(getValue("reorderLevel")) || 10,
            volume: getValue("volume") || null,
            alcoholPercentage: getValue("alcoholPercentage") || null,
            brand: getValue("brand") || null,
            origin: getValue("origin") || null,
            vintage: getValue("vintage") || null,
            active: true,
          };

          await storage.createItem(itemData);
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/items/import/json", async (req, res) => {
    try {
      const { rows } = req.body;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data rows provided" });
      }
      if (rows.length > 10000) {
        return res.status(400).json({ message: "Too many rows (max 10000)" });
      }

      const categories = await storage.getCategories();
      const catMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));
      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          if (typeof row !== "object" || row === null) {
            results.errors.push({ row: i + 1, message: "Invalid row data" });
            continue;
          }
          const name = String(row.name || "").trim();
          const sku = String(row.sku || "").trim();
          if (!name || !sku) {
            results.errors.push({ row: i + 1, message: "Name and SKU are required" });
            continue;
          }

          const categoryName = String(row.category || "").trim();
          let categoryId: string | null = null;
          if (categoryName) {
            categoryId = catMap.get(categoryName.toLowerCase()) || null;
            if (!categoryId) {
              const newCat = await storage.createCategory({ name: categoryName, description: null, parentId: null, active: true });
              categoryId = newCat.id;
              catMap.set(categoryName.toLowerCase(), newCat.id);
            }
          }

          await storage.createItem({
            name,
            sku,
            barcode: row.barcode || null,
            description: row.description || null,
            categoryId,
            unitType: row.unitType || "pc",
            packSize: parseInt(row.packSize) || 1,
            price1: row.price1 || "0",
            price2: row.price2 || "0",
            price3: row.price3 || "0",
            price4: row.price4 || "0",
            price5: row.price5 || "0",
            costPrice: row.costPrice || "0",
            stockQuantity: parseInt(row.stockQuantity) || 0,
            reorderLevel: parseInt(row.reorderLevel) || 10,
            volume: row.volume || null,
            alcoholPercentage: row.alcoholPercentage || null,
            brand: row.brand || null,
            origin: row.origin || null,
            vintage: row.vintage || null,
            active: true,
          });
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 1, message: e.message });
        }
      }

      res.json(results);
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

  app.post("/api/customers/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = req.body.sheetName || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};

      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          const code = getValue("code");
          if (!name || !code) {
            results.errors.push({ row: i + 2, message: "Name and Code are required" });
            continue;
          }

          const paymentTerms = getValue("paymentTerms") || "cash";
          const validTerms = ["cash", "credit_7", "credit_14", "credit_30", "credit_60", "credit_90"];
          
          const custData = {
            name,
            code: code.toUpperCase(),
            email: getValue("email") || null,
            phone: getValue("phone") || null,
            address: getValue("address") || null,
            city: getValue("city") || null,
            taxId: getValue("taxId") || null,
            paymentTerms: validTerms.includes(paymentTerms) ? paymentTerms : "cash",
            creditLimit: getValue("creditLimit") || "0",
            currentBalance: "0",
            priceLevel: parseInt(getValue("priceLevel")) || 1,
            notes: getValue("notes") || null,
            portalAccessCode: getValue("portalAccessCode") || null,
            active: true,
          };

          await storage.createCustomer(custData);
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Price Contracts
  app.get("/api/price-contracts", async (_req, res) => {
    const contracts = await storage.getPriceContracts();
    const contractsWithRules = await Promise.all(
      contracts.map(async (c) => {
        const rules = await storage.getContractRules(c.id);
        return { ...c, rules };
      })
    );
    res.json(contractsWithRules);
  });

  app.post("/api/price-contracts", async (req, res) => {
    try {
      const { rules, ...contractData } = req.body;
      const data = insertPriceContractSchema.parse(contractData);
      const contract = await storage.createPriceContract(data);
      if (rules && Array.isArray(rules) && rules.length > 0) {
        await storage.setContractRules(contract.id, rules);
      }
      res.json(contract);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/price-contracts/:id", async (req, res) => {
    try {
      const { rules, ...contractData } = req.body;
      const contract = await storage.updatePriceContract(req.params.id, contractData);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      if (rules && Array.isArray(rules)) {
        await storage.setContractRules(req.params.id, rules);
      }
      res.json(contract);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/price-contracts/:id/rules", async (req, res) => {
    const rules = await storage.getContractRules(req.params.id);
    res.json(rules);
  });

  app.put("/api/price-contracts/:id/rules", async (req, res) => {
    try {
      const rules = await storage.setContractRules(req.params.id, req.body.rules || []);
      res.json(rules);
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

      if (data.type === "invoice" && data.status !== "draft") {
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToSubtract = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              if (item.stockQuantity < bottlesToSubtract) {
                return res.status(400).json({ message: `Not enough stock for ${item.name || 'item'}. Available: ${item.stockQuantity} bottles, needed: ${bottlesToSubtract}` });
              }
            }
          }
        }
      }

      const inv = await storage.createInvoice(data, parsedItems);

      if (data.type === "invoice" && data.status !== "draft") {
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToSubtract = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              await storage.updateItem(item.id, { stockQuantity: item.stockQuantity - bottlesToSubtract });
            }
          }
        }
      } else if (data.type === "credit_note") {
        for (const li of parsedItems) {
          if (li.itemId) {
            const item = await storage.getItem(li.itemId);
            if (item) {
              const bottlesToAdd = (li.saleUnit === "pack" && item.packSize > 1) ? li.quantity * item.packSize : li.quantity;
              await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
            }
          }
        }
      }

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

  // Document view/print/download
  app.get("/api/invoices/:id/pdf", async (req, res) => {
    try {
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      const customer = await storage.getCustomer(inv.customerId);
      const typeLabel = inv.type === "credit_note" ? "CREDIT NOTE" : inv.type === "proforma" ? "PROFORMA INVOICE" : inv.type === "quotation" ? "QUOTATION" : "INVOICE";
      const autoPrint = req.query.print === "1";

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const html = generateInvoiceHtml(inv, customer, typeLabel, autoPrint, settingsMap);

      res.setHeader("Content-Type", "text/html");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.html"`);
      }
      res.send(html);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Send invoice by email
  const sendEmailBodySchema = z.object({ email: z.string().email().optional() }).optional();
  app.post("/api/invoices/:id/send-email", async (req, res) => {
    try {
      const body = sendEmailBodySchema.parse(req.body);
      const inv = await storage.getInvoice(req.params.id);
      if (!inv) return res.status(404).json({ message: "Invoice not found" });

      const customer = await storage.getCustomer(inv.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const toEmail = body?.email || customer.email;
      if (!toEmail) return res.status(400).json({ message: "Customer has no email address" });

      const typeLabel = inv.type === "credit_note" ? "CREDIT NOTE" : inv.type === "proforma" ? "PROFORMA INVOICE" : inv.type === "quotation" ? "QUOTATION" : "INVOICE";

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const companyName = settingsMap.company_name || "VinTrade";
      const subject = `${typeLabel} ${inv.invoiceNumber} from ${companyName}`;
      const html = generateInvoiceHtml(inv, customer, typeLabel, false, settingsMap);

      const result = await sendInvoiceEmail(toEmail, subject, html);

      await storage.createEmailLog({
        invoiceId: inv.id,
        customerId: customer.id,
        customerName: customer.name,
        toEmail: toEmail,
        fromEmail: result.fromEmail || null,
        subject: subject,
        status: result.success ? "sent" : "failed",
        errorMessage: result.error || null,
      });

      if (result.success) {
        res.json({ message: `Email sent successfully to ${toEmail}` });
      } else {
        res.status(500).json({ message: `Failed to send email: ${result.error}` });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Email logs
  app.get("/api/email-logs", async (_req, res) => {
    try {
      const logs = await storage.getEmailLogs();
      res.json(logs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/email-logs/customer/:customerId", async (req, res) => {
    try {
      const logs = await storage.getEmailLogsByCustomer(req.params.customerId);
      res.json(logs);
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
      const autoPrint = req.query.print === "1";

      const allSettings = await storage.getSettings();
      const settingsMap: Record<string, string> = {};
      allSettings.forEach(s => { settingsMap[s.key] = s.value; });

      const html = generateStatementHtml(customer, st, autoPrint, settingsMap);
      res.setHeader("Content-Type", "text/html");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="statement-${customer.code}.html"`);
      }
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
        { key: "company_reg_no", value: "", label: "Company Registration No.", group: "company" },
        { key: "company_iban", value: "", label: "Bank IBAN", group: "company" },
        { key: "company_swift", value: "", label: "Bank SWIFT/BIC", group: "company" },
        { key: "company_bank_name", value: "", label: "Bank Name", group: "company" },
        { key: "vat_rate", value: "19", label: "Default VAT Rate (%)", group: "tax" },
        { key: "currency", value: "EUR", label: "Currency", group: "tax" },
        { key: "currency_symbol", value: "€", label: "Currency Symbol", group: "tax" },
        { key: "invoice_prefix", value: "INV", label: "Invoice Number Prefix", group: "invoicing" },
        { key: "credit_note_prefix", value: "CN", label: "Credit Note Number Prefix", group: "invoicing" },
        { key: "proforma_prefix", value: "PF", label: "Proforma Number Prefix", group: "invoicing" },
        { key: "invoice_footer", value: "Thank you for your business", label: "Invoice Footer Message", group: "invoicing" },
        { key: "payment_terms_default", value: "cash", label: "Default Payment Terms", group: "invoicing" },
        { key: "price_level_1", value: "Price Level 1", label: "Price Level 1 Name", group: "pricing" },
        { key: "price_level_2", value: "Price Level 2", label: "Price Level 2 Name", group: "pricing" },
        { key: "price_level_3", value: "Price Level 3", label: "Price Level 3 Name", group: "pricing" },
        { key: "price_level_4", value: "Price Level 4", label: "Price Level 4 Name", group: "pricing" },
        { key: "price_level_5", value: "Price Level 5", label: "Price Level 5 Name", group: "pricing" },
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

  // Suppliers
  app.get("/api/suppliers", async (_req, res) => {
    const sups = await storage.getSuppliers();
    res.json(sups);
  });

  app.get("/api/suppliers/:id", async (req, res) => {
    const sup = await storage.getSupplier(req.params.id);
    if (!sup) return res.status(404).json({ message: "Supplier not found" });
    res.json(sup);
  });

  app.post("/api/suppliers", async (req, res) => {
    try {
      const data = insertSupplierSchema.parse(req.body);
      const sup = await storage.createSupplier(data);
      res.json(sup);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/suppliers/:id", async (req, res) => {
    try {
      const sup = await storage.updateSupplier(req.params.id, req.body);
      if (!sup) return res.status(404).json({ message: "Supplier not found" });
      res.json(sup);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/suppliers/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = req.body.sheetName || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          const code = getValue("code");
          if (!name || !code) {
            results.errors.push({ row: i + 2, message: "Name and Code are required" });
            continue;
          }

          const paymentTerms = getValue("paymentTerms") || "cash";
          const validTerms = ["cash", "credit_7", "credit_14", "credit_30", "credit_60", "credit_90"];

          const supData = {
            name,
            code: code.toUpperCase(),
            contactPerson: getValue("contactPerson") || null,
            email: getValue("email") || null,
            phone: getValue("phone") || null,
            address: getValue("address") || null,
            city: getValue("city") || null,
            country: getValue("country") || "Cyprus",
            taxId: getValue("taxId") || null,
            paymentTerms: validTerms.includes(paymentTerms) ? paymentTerms : "cash",
            currentBalance: "0",
            notes: getValue("notes") || null,
            active: true,
          };

          await storage.createSupplier(supData);
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/categories/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = req.body.sheetName || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return res.status(400).json({ message: `Sheet "${sheetName}" not found` });
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) return res.status(400).json({ message: "File is empty" });

      const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : {};
      const results: { success: number; errors: { row: number; message: string }[] } = { success: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getValue = (field: string) => {
            const col = columnMap[field] || field;
            return row[col] !== undefined ? String(row[col]).trim() : "";
          };

          const name = getValue("name");
          if (!name) {
            results.errors.push({ row: i + 2, message: "Name is required" });
            continue;
          }

          await storage.createCategory({
            name,
            description: getValue("description") || null,
            parentId: null,
            active: true,
          });
          results.success++;
        } catch (e: any) {
          results.errors.push({ row: i + 2, message: e.message });
        }
      }

      res.json(results);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Purchase Invoices
  app.get("/api/purchase-invoices", async (_req, res) => {
    const invs = await storage.getPurchaseInvoices();
    res.json(invs);
  });

  app.get("/api/purchase-invoices/last-costs", async (_req, res) => {
    const costs = await storage.getLastPurchaseCosts();
    res.json(costs);
  });

  app.get("/api/purchase-invoices/:id", async (req, res) => {
    const inv = await storage.getPurchaseInvoice(req.params.id);
    if (!inv) return res.status(404).json({ message: "Purchase invoice not found" });
    res.json(inv);
  });

  app.post("/api/purchase-invoices", async (req, res) => {
    try {
      const { items: lineItems, ...invoiceData } = req.body;
      const data = insertPurchaseInvoiceSchema.parse(invoiceData);

      if (!lineItems?.length) {
        return res.status(400).json({ message: "At least one line item is required" });
      }

      const parsedItems = lineItems.map((li: any) => insertPurchaseInvoiceItemSchema.parse(li));
      const inv = await storage.createPurchaseInvoice(data, parsedItems);

      for (const li of parsedItems) {
        const item = await storage.getItem(li.itemId);
        if (item) {
          const bottlesToAdd = li.purchaseUnit === "pack" ? li.quantity * item.packSize : li.quantity;
          await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
        }
      }

      const supplier = await storage.getSupplier(data.supplierId);
      if (supplier) {
        const newBalance = parseFloat(supplier.currentBalance) + parseFloat(String(data.total));
        await storage.updateSupplier(data.supplierId, { currentBalance: newBalance.toFixed(2) });
      }

      res.json(inv);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/purchase-invoices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.getPurchaseInvoice(id);
      if (!existing) return res.status(404).json({ message: "Purchase invoice not found" });

      const { items: lineItems, ...invoiceData } = req.body;

      // Reverse old stock impact
      for (const oldItem of existing.items) {
        const item = await storage.getItem(oldItem.itemId);
        if (item) {
          const bottlesToRemove = oldItem.purchaseUnit === "pack" ? oldItem.quantity * item.packSize : oldItem.quantity;
          await storage.updateItem(item.id, { stockQuantity: Math.max(0, item.stockQuantity - bottlesToRemove) });
        }
      }

      // Reverse old supplier balance impact
      const oldSupplier = await storage.getSupplier(existing.supplierId);
      if (oldSupplier) {
        const oldBalance = parseFloat(oldSupplier.currentBalance) - parseFloat(existing.total);
        await storage.updateSupplier(existing.supplierId, { currentBalance: Math.max(0, oldBalance).toFixed(2) });
      }

      // Update invoice header
      const { invoiceNumber, ...updateData } = invoiceData;
      await storage.updatePurchaseInvoice(id, updateData);

      // Replace line items
      await storage.deletePurchaseInvoiceItems(id);
      if (lineItems?.length) {
        const parsedItems = lineItems.map((li: any) => insertPurchaseInvoiceItemSchema.parse(li));
        await storage.createPurchaseInvoiceItems(parsedItems.map((li: any) => ({ ...li, purchaseInvoiceId: id })));

        // Apply new stock impact
        for (const li of parsedItems) {
          const item = await storage.getItem(li.itemId);
          if (item) {
            const bottlesToAdd = li.purchaseUnit === "pack" ? li.quantity * item.packSize : li.quantity;
            await storage.updateItem(item.id, { stockQuantity: item.stockQuantity + bottlesToAdd });
          }
        }
      }

      // Apply new supplier balance impact
      const newSupplier = await storage.getSupplier(invoiceData.supplierId);
      if (newSupplier) {
        const newBalance = parseFloat(newSupplier.currentBalance) + parseFloat(String(invoiceData.total));
        await storage.updateSupplier(invoiceData.supplierId, { currentBalance: newBalance.toFixed(2) });
      }

      const updated = await storage.getPurchaseInvoice(id);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Supplier Payments
  app.get("/api/supplier-payments", async (req, res) => {
    const supplierId = req.query.supplierId as string | undefined;
    const payments = await storage.getSupplierPayments(supplierId);
    res.json(payments);
  });

  app.post("/api/supplier-payments", async (req, res) => {
    try {
      const data = insertSupplierPaymentSchema.parse(req.body);
      const supplier = await storage.getSupplier(data.supplierId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      const payment = await storage.createSupplierPayment(data);
      const newBalance = parseFloat(supplier.currentBalance) - parseFloat(String(data.amount));
      await storage.updateSupplier(data.supplierId, { currentBalance: Math.max(0, newBalance).toFixed(2) });
      res.json(payment);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
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
        const bottlesNeeded = (oi.saleUnit === "pack" && item.packSize > 1) ? oi.quantity * item.packSize : oi.quantity;
        if (item.stockQuantity < bottlesNeeded) {
          return res.status(400).json({ message: `Not enough stock for ${item.name}. Available: ${item.stockQuantity} bottles` });
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
          const bottlesToSubtract = (oi.saleUnit === "pack" && item.packSize > 1) ? oi.quantity * item.packSize : oi.quantity;
          await storage.updateItem(item.id, { stockQuantity: item.stockQuantity - bottlesToSubtract });
        }
      }

      res.json(order);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/demo/seed", async (_req, res) => {
    try {
      const [existingCats] = await db.select({ count: sql<number>`count(*)` }).from(categories);
      const [existingItems] = await db.select({ count: sql<number>`count(*)` }).from(items);
      const [existingCustomers] = await db.select({ count: sql<number>`count(*)` }).from(customers);
      if ((existingCats?.count || 0) > 0 || (existingItems?.count || 0) > 0 || (existingCustomers?.count || 0) > 0) {
        return res.status(400).json({ message: "Database already contains data. Clear demo data first before seeding." });
      }

      const [redWine] = await db.insert(categories).values({ name: "Red Wine", description: "Premium red wines from top vineyards" }).returning();
      const [whiteWine] = await db.insert(categories).values({ name: "White Wine", description: "Crisp and refreshing white wines" }).returning();
      const [sparkling] = await db.insert(categories).values({ name: "Sparkling", description: "Champagnes and sparkling wines" }).returning();
      const [spirits] = await db.insert(categories).values({ name: "Spirits", description: "Premium spirits and liquors" }).returning();
      const [rose] = await db.insert(categories).values({ name: "Rosé", description: "Light and fruity rosé wines" }).returning();
      const [beer] = await db.insert(categories).values({ name: "Beer & Cider", description: "Craft beers and artisan ciders" }).returning();
      const [fortified] = await db.insert(categories).values({ name: "Fortified Wine", description: "Port, sherry and dessert wines" }).returning();

      const seedItems = [
        { name: "Château Margaux 2018", sku: "RW-001", barcode: "3401234567890", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "189.99", price2: "179.99", price3: "169.99", price4: "159.99", price5: "149.99", costPrice: "120.00", stockQuantity: 48, reorderLevel: 12, volume: "750ml", alcoholPercentage: "13.5", brand: "Château Margaux", origin: "Bordeaux, France", vintage: "2018" },
        { name: "Opus One 2019", sku: "RW-002", barcode: "3401234567891", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "399.99", price2: "379.99", price3: "359.99", price4: "339.99", price5: "319.99", costPrice: "250.00", stockQuantity: 24, reorderLevel: 6, volume: "750ml", alcoholPercentage: "14.5", brand: "Opus One", origin: "Napa Valley, USA", vintage: "2019" },
        { name: "Penfolds Grange 2017", sku: "RW-003", barcode: "3401234567892", categoryId: redWine.id, unitType: "pack", packSize: 6, price1: "2100.00", price2: "1999.00", price3: "1899.00", price4: "1799.00", price5: "1699.00", costPrice: "1400.00", stockQuantity: 48, reorderLevel: 24, volume: "750ml", alcoholPercentage: "14.1", brand: "Penfolds", origin: "South Australia", vintage: "2017" },
        { name: "Barolo Riserva 2016", sku: "RW-004", barcode: "3401234567910", categoryId: redWine.id, unitType: "bottle", packSize: 1, price1: "85.00", price2: "79.00", price3: "74.00", price4: "69.00", price5: "65.00", costPrice: "48.00", stockQuantity: 36, reorderLevel: 10, volume: "750ml", alcoholPercentage: "14.0", brand: "Marchesi di Barolo", origin: "Piedmont, Italy", vintage: "2016" },
        { name: "Rioja Gran Reserva 2015", sku: "RW-005", barcode: "3401234567911", categoryId: redWine.id, unitType: "pack", packSize: 12, price1: "540.00", price2: "504.00", price3: "468.00", price4: "432.00", price5: "396.00", costPrice: "300.00", stockQuantity: 120, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.5", brand: "Marqués de Riscal", origin: "Rioja, Spain", vintage: "2015" },
        { name: "Cloudy Bay Sauvignon Blanc", sku: "WW-001", barcode: "3401234567893", categoryId: whiteWine.id, unitType: "pack", packSize: 12, price1: "288.00", price2: "276.00", price3: "264.00", price4: "252.00", price5: "240.00", costPrice: "180.00", stockQuantity: 120, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.0", brand: "Cloudy Bay", origin: "Marlborough, NZ", vintage: "2023" },
        { name: "Chablis Premier Cru 2021", sku: "WW-002", barcode: "3401234567894", categoryId: whiteWine.id, unitType: "bottle", packSize: 1, price1: "45.99", price2: "42.99", price3: "39.99", price4: "37.99", price5: "35.99", costPrice: "28.00", stockQuantity: 72, reorderLevel: 18, volume: "750ml", alcoholPercentage: "12.5", brand: "William Fèvre", origin: "Burgundy, France", vintage: "2021" },
        { name: "Pinot Grigio delle Venezie", sku: "WW-003", barcode: "3401234567912", categoryId: whiteWine.id, unitType: "pack", packSize: 6, price1: "72.00", price2: "66.00", price3: "60.00", price4: "54.00", price5: "48.00", costPrice: "36.00", stockQuantity: 96, reorderLevel: 24, volume: "750ml", alcoholPercentage: "12.0", brand: "Santa Margherita", origin: "Veneto, Italy", vintage: "2023" },
        { name: "Riesling Spätlese 2022", sku: "WW-004", barcode: "3401234567913", categoryId: whiteWine.id, unitType: "bottle", packSize: 1, price1: "28.50", price2: "26.00", price3: "24.00", price4: "22.00", price5: "20.00", costPrice: "14.00", stockQuantity: 60, reorderLevel: 15, volume: "750ml", alcoholPercentage: "9.5", brand: "Dr. Loosen", origin: "Mosel, Germany", vintage: "2022" },
        { name: "Dom Pérignon 2013", sku: "SP-001", barcode: "3401234567895", categoryId: sparkling.id, unitType: "bottle", packSize: 1, price1: "249.99", price2: "239.99", price3: "229.99", price4: "219.99", price5: "209.99", costPrice: "170.00", stockQuantity: 18, reorderLevel: 6, volume: "750ml", alcoholPercentage: "12.5", brand: "Dom Pérignon", origin: "Champagne, France", vintage: "2013" },
        { name: "Veuve Clicquot Yellow Label", sku: "SP-002", barcode: "3401234567896", categoryId: sparkling.id, unitType: "pack", packSize: 6, price1: "360.00", price2: "342.00", price3: "324.00", price4: "306.00", price5: "288.00", costPrice: "240.00", stockQuantity: 36, reorderLevel: 12, volume: "750ml", alcoholPercentage: "12.0", brand: "Veuve Clicquot", origin: "Champagne, France", vintage: "NV" },
        { name: "Prosecco Superiore DOCG", sku: "SP-003", barcode: "3401234567914", categoryId: sparkling.id, unitType: "pack", packSize: 12, price1: "180.00", price2: "168.00", price3: "156.00", price4: "144.00", price5: "132.00", costPrice: "96.00", stockQuantity: 144, reorderLevel: 36, volume: "750ml", alcoholPercentage: "11.0", brand: "Bisol", origin: "Veneto, Italy", vintage: "NV" },
        { name: "Macallan 18 Year", sku: "ST-001", barcode: "3401234567897", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "329.99", price2: "319.99", price3: "309.99", price4: "299.99", price5: "289.99", costPrice: "220.00", stockQuantity: 15, reorderLevel: 5, volume: "700ml", alcoholPercentage: "43.0", brand: "Macallan", origin: "Scotland", vintage: "" },
        { name: "Hennessy XO Cognac", sku: "ST-002", barcode: "3401234567898", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "199.99", price2: "189.99", price3: "179.99", price4: "169.99", price5: "159.99", costPrice: "130.00", stockQuantity: 5, reorderLevel: 8, volume: "700ml", alcoholPercentage: "40.0", brand: "Hennessy", origin: "Cognac, France", vintage: "" },
        { name: "Grey Goose Vodka", sku: "ST-003", barcode: "3401234567915", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "42.00", price2: "39.00", price3: "36.00", price4: "33.00", price5: "30.00", costPrice: "22.00", stockQuantity: 60, reorderLevel: 15, volume: "700ml", alcoholPercentage: "40.0", brand: "Grey Goose", origin: "France", vintage: "" },
        { name: "Hendrick's Gin", sku: "ST-004", barcode: "3401234567916", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "38.00", price2: "35.00", price3: "32.00", price4: "29.00", price5: "27.00", costPrice: "20.00", stockQuantity: 45, reorderLevel: 12, volume: "700ml", alcoholPercentage: "41.4", brand: "Hendrick's", origin: "Scotland", vintage: "" },
        { name: "Patrón Silver Tequila", sku: "ST-005", barcode: "3401234567917", categoryId: spirits.id, unitType: "bottle", packSize: 1, price1: "55.00", price2: "50.00", price3: "46.00", price4: "42.00", price5: "38.00", costPrice: "28.00", stockQuantity: 30, reorderLevel: 8, volume: "700ml", alcoholPercentage: "40.0", brand: "Patrón", origin: "Mexico", vintage: "" },
        { name: "Whispering Angel Rosé 2023", sku: "RS-001", barcode: "3401234567899", categoryId: rose.id, unitType: "pack", packSize: 12, price1: "240.00", price2: "228.00", price3: "216.00", price4: "204.00", price5: "192.00", costPrice: "150.00", stockQuantity: 96, reorderLevel: 24, volume: "750ml", alcoholPercentage: "13.0", brand: "Château d'Esclans", origin: "Provence, France", vintage: "2023" },
        { name: "Miraval Rosé 2023", sku: "RS-002", barcode: "3401234567918", categoryId: rose.id, unitType: "pack", packSize: 6, price1: "144.00", price2: "132.00", price3: "120.00", price4: "108.00", price5: "96.00", costPrice: "72.00", stockQuantity: 60, reorderLevel: 12, volume: "750ml", alcoholPercentage: "13.0", brand: "Miraval", origin: "Provence, France", vintage: "2023" },
        { name: "Peroni Nastro Azzurro", sku: "BR-001", barcode: "3401234567919", categoryId: beer.id, unitType: "pack", packSize: 24, price1: "36.00", price2: "33.60", price3: "31.20", price4: "28.80", price5: "26.40", costPrice: "18.00", stockQuantity: 240, reorderLevel: 48, volume: "330ml", alcoholPercentage: "5.1", brand: "Peroni", origin: "Italy", vintage: "" },
        { name: "KEO Beer", sku: "BR-002", barcode: "3401234567920", categoryId: beer.id, unitType: "pack", packSize: 24, price1: "28.80", price2: "26.40", price3: "24.00", price4: "21.60", price5: "19.20", costPrice: "14.00", stockQuantity: 480, reorderLevel: 96, volume: "330ml", alcoholPercentage: "4.5", brand: "KEO", origin: "Cyprus", vintage: "" },
        { name: "Taylor's 20 Year Tawny Port", sku: "FW-001", barcode: "3401234567921", categoryId: fortified.id, unitType: "bottle", packSize: 1, price1: "65.00", price2: "60.00", price3: "55.00", price4: "50.00", price5: "46.00", costPrice: "35.00", stockQuantity: 24, reorderLevel: 6, volume: "750ml", alcoholPercentage: "20.0", brand: "Taylor's", origin: "Douro, Portugal", vintage: "" },
        { name: "Commandaria St. John", sku: "FW-002", barcode: "3401234567922", categoryId: fortified.id, unitType: "bottle", packSize: 1, price1: "18.00", price2: "16.50", price3: "15.00", price4: "13.50", price5: "12.00", costPrice: "8.00", stockQuantity: 100, reorderLevel: 20, volume: "750ml", alcoholPercentage: "15.0", brand: "KEO", origin: "Cyprus", vintage: "" },
      ];

      const createdItems = await db.insert(items).values(seedItems).returning();

      const seedCustomers = [
        { name: "Limassol Wine House", code: "CUST001", email: "orders@limassolwinehouse.com.cy", phone: "+357-25-123456", address: "15 Makarios Avenue", city: "Limassol", taxId: "CY-12345678A", paymentTerms: "credit_30", creditLimit: "50000", currentBalance: "0", priceLevel: 1, portalAccessCode: "WINE2026" },
        { name: "Nicosia Grand Hotel", code: "CUST002", email: "purchasing@nicosiagrand.com.cy", phone: "+357-22-234567", address: "28 Ledra Street", city: "Nicosia", taxId: "CY-23456789B", paymentTerms: "credit_14", creditLimit: "25000", currentBalance: "0", priceLevel: 2, portalAccessCode: "HOTEL2026" },
        { name: "Paphos Beach Resort", code: "CUST003", email: "procurement@paphosbeach.com.cy", phone: "+357-26-345678", address: "42 Poseidonos Avenue", city: "Paphos", taxId: "CY-34567890C", paymentTerms: "cash", creditLimit: "0", currentBalance: "0", priceLevel: 3, portalAccessCode: "RESORT26" },
        { name: "Larnaca Spirits Trading", code: "CUST004", email: "wine@larnacaspirits.com.cy", phone: "+357-24-456789", address: "7 Athinon Avenue", city: "Larnaca", taxId: "CY-45678901D", paymentTerms: "credit_60", creditLimit: "100000", currentBalance: "0", priceLevel: 1, portalAccessCode: "TRADE2026" },
        { name: "Troodos Mountain Lodge", code: "CUST005", email: "orders@troodoslodge.com.cy", phone: "+357-25-567890", address: "3 Platres Hill Road", city: "Platres", taxId: "CY-56789012E", paymentTerms: "credit_30", creditLimit: "35000", currentBalance: "0", priceLevel: 2, portalAccessCode: "LODGE2026" },
        { name: "Ayia Napa Beach Bar", code: "CUST006", email: "bar@ayianapabay.com.cy", phone: "+357-23-678901", address: "12 Nissi Avenue", city: "Ayia Napa", taxId: "CY-67890123F", paymentTerms: "credit_7", creditLimit: "15000", currentBalance: "0", priceLevel: 3, portalAccessCode: "BEACH26" },
        { name: "Metro Wine Bar", code: "CUST007", email: "wines@metrobar.com.cy", phone: "+357-22-789012", address: "5 Stasikratous Street", city: "Nicosia", taxId: "CY-78901234G", paymentTerms: "credit_30", creditLimit: "40000", currentBalance: "0", priceLevel: 2, portalAccessCode: "METRO2026" },
        { name: "Elite Dining Group", code: "CUST008", email: "procurement@elitedining.com.cy", phone: "+357-25-890123", address: "88 Amathountos Avenue", city: "Limassol", taxId: "CY-89012345H", paymentTerms: "credit_60", creditLimit: "80000", currentBalance: "0", priceLevel: 1, portalAccessCode: "ELITE2026" },
        { name: "Protaras Sunset Lounge", code: "CUST009", email: "drinks@sunsetlounge.com.cy", phone: "+357-23-901234", address: "9 Protaras Avenue", city: "Protaras", taxId: "CY-90123456I", paymentTerms: "credit_14", creditLimit: "20000", currentBalance: "0", priceLevel: 3, portalAccessCode: "SUNSET26" },
        { name: "Cyprus Wine Academy", code: "CUST010", email: "orders@cypruswineacademy.com", phone: "+357-22-012345", address: "22 Diagorou Street", city: "Nicosia", taxId: "CY-01234567J", paymentTerms: "credit_30", creditLimit: "30000", currentBalance: "0", priceLevel: 2, portalAccessCode: "ACADEMY26" },
      ];

      const createdCustomers = await db.insert(customers).values(seedCustomers).returning();

      const seedSuppliers = [
        { name: "Bordeaux Direct Imports", code: "SUP001", email: "export@bordeauxdirect.fr", phone: "+33-5-5678-1234", address: "10 Quai des Chartrons", city: "Bordeaux", country: "France", taxId: "FR-12345678901" },
        { name: "Italian Wine Merchants", code: "SUP002", email: "vendite@italianwine.it", phone: "+39-011-5678-900", address: "Via Roma 45", city: "Torino", country: "Italy", taxId: "IT-98765432109" },
        { name: "Spirits Global Ltd", code: "SUP003", email: "trade@spiritsglobal.co.uk", phone: "+44-20-7123-4567", address: "15 Regent Street", city: "London", country: "United Kingdom", taxId: "GB-123456789" },
        { name: "KEO Plc", code: "SUP004", email: "wholesale@keo.com.cy", phone: "+357-25-888000", address: "1 Franklin Roosevelt Avenue", city: "Limassol", country: "Cyprus", taxId: "CY-11223344K" },
        { name: "Champagne House Paris", code: "SUP005", email: "orders@champagnehouse.fr", phone: "+33-3-2634-5678", address: "8 Avenue de Champagne", city: "Épernay", country: "France", taxId: "FR-55667788901" },
      ];

      await db.insert(suppliers).values(seedSuppliers).returning();

      const today = new Date();
      const fmt = (d: Date) => d.toISOString().split("T")[0];
      const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

      const inv1Items = [
        { description: "Château Margaux 2018", quantity: 6, unitPrice: "189.99", discount: "0", discountPercent: "0", total: "1139.94", itemId: createdItems[0].id },
        { description: "Cloudy Bay Sauvignon Blanc 12-pack", quantity: 2, unitPrice: "288.00", discount: "0", discountPercent: "0", total: "576.00", itemId: createdItems[5].id },
      ];
      const inv1Sub = 1715.94;
      const inv1Tax = +(inv1Sub * 0.19).toFixed(2);
      const [inv1] = await db.insert(invoices).values({
        invoiceNumber: "INV-00001", type: "invoice", customerId: createdCustomers[0].id,
        date: fmt(addDays(today, -18)), dueDate: fmt(addDays(today, 12)),
        subtotal: inv1Sub.toFixed(2), taxRate: "19", taxAmount: inv1Tax.toFixed(2),
        discountAmount: "0", total: (inv1Sub + inv1Tax).toFixed(2), status: "sent",
      }).returning();
      await db.insert(invoiceItems).values(inv1Items.map(li => ({ ...li, invoiceId: inv1.id })));

      const inv2Items = [
        { description: "Dom Pérignon 2013", quantity: 12, unitPrice: "239.99", discount: "50.00", discountPercent: "0", total: "2829.88", itemId: createdItems[9].id },
        { description: "Macallan 18 Year", quantity: 6, unitPrice: "319.99", discount: "0", discountPercent: "0", total: "1919.94", itemId: createdItems[12].id },
      ];
      const inv2Sub = 4749.82;
      const inv2Tax = +(inv2Sub * 0.19).toFixed(2);
      const [inv2] = await db.insert(invoices).values({
        invoiceNumber: "INV-00002", type: "invoice", customerId: createdCustomers[7].id,
        date: fmt(addDays(today, -13)), dueDate: fmt(addDays(today, 47)),
        subtotal: inv2Sub.toFixed(2), taxRate: "19", taxAmount: inv2Tax.toFixed(2),
        discountAmount: "50.00", total: (inv2Sub + inv2Tax).toFixed(2), status: "paid",
      }).returning();
      await db.insert(invoiceItems).values(inv2Items.map(li => ({ ...li, invoiceId: inv2.id })));

      await db.insert(payments).values({
        invoiceId: inv2.id, amount: (inv2Sub + inv2Tax).toFixed(2),
        paymentDate: fmt(addDays(today, -5)), paymentMethod: "bank_transfer", reference: "TRF-20260220-001",
      });

      const inv3Items = [
        { description: "Veuve Clicquot Yellow Label 6-pack", quantity: 4, unitPrice: "342.00", discount: "0", discountPercent: "0", total: "1368.00", itemId: createdItems[10].id },
      ];
      const [inv3] = await db.insert(invoices).values({
        invoiceNumber: "INV-00003", type: "invoice", customerId: createdCustomers[1].id,
        date: fmt(addDays(today, -39)), dueDate: fmt(addDays(today, -25)),
        subtotal: "1368.00", taxRate: "19", taxAmount: "259.92",
        discountAmount: "0", total: "1627.92", status: "overdue",
      }).returning();
      await db.insert(invoiceItems).values(inv3Items.map(li => ({ ...li, invoiceId: inv3.id })));

      const inv4Items = [
        { description: "Grey Goose Vodka", quantity: 24, unitPrice: "39.00", discount: "0", discountPercent: "5", total: "889.20", itemId: createdItems[14].id },
        { description: "Hendrick's Gin", quantity: 12, unitPrice: "35.00", discount: "0", discountPercent: "0", total: "420.00", itemId: createdItems[15].id },
        { description: "Prosecco Superiore DOCG 12-pack", quantity: 3, unitPrice: "168.00", discount: "0", discountPercent: "0", total: "504.00", itemId: createdItems[11].id },
      ];
      const inv4Sub = 1813.20;
      const inv4Tax = +(inv4Sub * 0.19).toFixed(2);
      const [inv4] = await db.insert(invoices).values({
        invoiceNumber: "INV-00004", type: "invoice", customerId: createdCustomers[5].id,
        date: fmt(addDays(today, -7)), dueDate: fmt(addDays(today, 0)),
        subtotal: inv4Sub.toFixed(2), taxRate: "19", taxAmount: inv4Tax.toFixed(2),
        discountAmount: "0", total: (inv4Sub + inv4Tax).toFixed(2), status: "sent",
      }).returning();
      await db.insert(invoiceItems).values(inv4Items.map(li => ({ ...li, invoiceId: inv4.id })));

      const inv5Items = [
        { description: "Barolo Riserva 2016", quantity: 12, unitPrice: "79.00", discount: "0", discountPercent: "0", total: "948.00", itemId: createdItems[3].id },
        { description: "Whispering Angel Rosé 2023 12-pack", quantity: 2, unitPrice: "228.00", discount: "0", discountPercent: "0", total: "456.00", itemId: createdItems[17].id },
      ];
      const inv5Sub = 1404.00;
      const inv5Tax = +(inv5Sub * 0.19).toFixed(2);
      const [inv5] = await db.insert(invoices).values({
        invoiceNumber: "INV-00005", type: "invoice", customerId: createdCustomers[6].id,
        date: fmt(addDays(today, -3)), dueDate: fmt(addDays(today, 27)),
        subtotal: inv5Sub.toFixed(2), taxRate: "19", taxAmount: inv5Tax.toFixed(2),
        discountAmount: "0", total: (inv5Sub + inv5Tax).toFixed(2), status: "draft",
      }).returning();
      await db.insert(invoiceItems).values(inv5Items.map(li => ({ ...li, invoiceId: inv5.id })));

      const cn1Items = [
        { description: "Château Margaux 2018 (returned damaged)", quantity: 2, unitPrice: "189.99", discount: "0", discountPercent: "0", total: "379.98", itemId: createdItems[0].id },
      ];
      const cn1Sub = 379.98;
      const cn1Tax = +(cn1Sub * 0.19).toFixed(2);
      const [cn1] = await db.insert(invoices).values({
        invoiceNumber: "CN-00001", type: "credit_note", customerId: createdCustomers[0].id,
        date: fmt(addDays(today, -10)), dueDate: fmt(addDays(today, -10)),
        subtotal: cn1Sub.toFixed(2), taxRate: "19", taxAmount: cn1Tax.toFixed(2),
        discountAmount: "0", total: (cn1Sub + cn1Tax).toFixed(2), status: "sent", linkedInvoiceId: inv1.id,
      }).returning();
      await db.insert(invoiceItems).values(cn1Items.map(li => ({ ...li, invoiceId: cn1.id })));

      const pf1Items = [
        { description: "Penfolds Grange 2017 6-pack", quantity: 2, unitPrice: "1999.00", discount: "0", discountPercent: "0", total: "3998.00", itemId: createdItems[2].id },
        { description: "Riesling Spätlese 2022", quantity: 24, unitPrice: "26.00", discount: "0", discountPercent: "0", total: "624.00", itemId: createdItems[8].id },
      ];
      const pf1Sub = 4622.00;
      const pf1Tax = +(pf1Sub * 0.19).toFixed(2);
      const [pf1] = await db.insert(invoices).values({
        invoiceNumber: "PF-00001", type: "proforma", customerId: createdCustomers[3].id,
        date: fmt(addDays(today, -2)), dueDate: fmt(addDays(today, 28)),
        subtotal: pf1Sub.toFixed(2), taxRate: "19", taxAmount: pf1Tax.toFixed(2),
        discountAmount: "0", total: (pf1Sub + pf1Tax).toFixed(2), status: "draft",
      }).returning();
      await db.insert(invoiceItems).values(pf1Items.map(li => ({ ...li, invoiceId: pf1.id })));

      const qt1Items = [
        { description: "Rioja Gran Reserva 2015 12-pack", quantity: 5, unitPrice: "504.00", discount: "0", discountPercent: "10", total: "2268.00", itemId: createdItems[4].id },
        { description: "Miraval Rosé 2023 6-pack", quantity: 4, unitPrice: "132.00", discount: "0", discountPercent: "0", total: "528.00", itemId: createdItems[18].id },
      ];
      const qt1Sub = 2796.00;
      const qt1Tax = +(qt1Sub * 0.19).toFixed(2);
      await db.insert(invoices).values({
        invoiceNumber: "QT-00001", type: "quotation", customerId: createdCustomers[9].id,
        date: fmt(today), dueDate: fmt(addDays(today, 30)),
        subtotal: qt1Sub.toFixed(2), taxRate: "19", taxAmount: qt1Tax.toFixed(2),
        discountAmount: "0", total: (qt1Sub + qt1Tax).toFixed(2), status: "draft",
      }).returning().then(([qt1]) => db.insert(invoiceItems).values(qt1Items.map(li => ({ ...li, invoiceId: qt1.id }))));

      const [contract1] = await db.insert(priceContracts).values({
        customerId: createdCustomers[0].id, name: "Wine House Annual Contract",
        startDate: "2026-01-01", endDate: "2026-12-31", discountType: "percentage",
        discountValue: "10", minQuantity: 12, active: true,
        purchaseGoal: "25000", voucherType: "percentage", voucherValue: "5",
      }).returning();
      await db.insert(priceContractRules).values([
        { contractId: contract1.id, categoryIds: [redWine.id, whiteWine.id], brands: [], minQuantity: 6, discountType: "percentage", discountValue: "10" },
        { contractId: contract1.id, categoryIds: [sparkling.id], brands: [], minQuantity: 12, discountType: "percentage", discountValue: "8" },
      ]);

      const [contract2] = await db.insert(priceContracts).values({
        customerId: createdCustomers[7].id, name: "Elite Dining Premium Deal",
        startDate: "2026-01-01", endDate: "2026-06-30", discountType: "percentage",
        discountValue: "8", minQuantity: 6, active: true,
        purchaseGoal: "50000", voucherType: "fixed", voucherValue: "500",
      }).returning();
      await db.insert(priceContractRules).values([
        { contractId: contract2.id, categoryIds: [spirits.id], brands: ["Macallan", "Hennessy"], minQuantity: 3, discountType: "percentage", discountValue: "12" },
        { contractId: contract2.id, categoryIds: [], brands: [], minQuantity: 24, discountType: "fixed", discountValue: "5" },
      ]);

      await db.insert(seasonalOffers).values({
        name: "Spring Wine Festival", description: "Mix and match any 6 bottles from our red and white wine collections for a special discount",
        startDate: "2026-03-01", endDate: "2026-05-31", discountPercentage: "15",
        minItems: 6, mixMatch: true, active: true,
      });

      await db.insert(seasonalOffers).values({
        name: "Summer Sparkling Special", description: "Buy any 12 sparkling wines and get 20% off",
        startDate: "2026-06-01", endDate: "2026-08-31", discountPercentage: "20",
        minItems: 12, mixMatch: false, active: true,
      });

      await db.insert(seasonalOffers).values({
        name: "Cyprus Commandaria Week", description: "Special pricing on local Commandaria wines - buy 3 get 10% off",
        startDate: "2026-04-01", endDate: "2026-04-07", discountPercentage: "10",
        minItems: 3, mixMatch: false, active: true,
      });

      res.json({ message: "Demo data seeded successfully", counts: { categories: 7, items: seedItems.length, customers: seedCustomers.length, suppliers: seedSuppliers.length, invoices: 8, offers: 3, contracts: 2 } });
    } catch (e: any) {
      console.error("Demo seed error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/demo/clear", async (_req, res) => {
    try {
      await db.delete(emailLogs);
      await db.delete(portalOrderItems);
      await db.delete(portalOrders);
      await db.delete(supplierPayments);
      await db.delete(purchaseInvoiceItems);
      await db.delete(purchaseInvoices);
      await db.delete(payments);
      await db.delete(invoiceItems);
      await db.delete(invoices);
      await db.delete(priceContractItems);
      await db.delete(priceContractRules);
      await db.delete(priceContracts);
      await db.delete(seasonalOfferItems);
      await db.delete(seasonalOffers);
      await db.delete(items);
      await db.delete(categories);
      await db.delete(customers);
      await db.delete(suppliers);
      res.json({ message: "All demo data cleared successfully" });
    } catch (e: any) {
      console.error("Demo clear error:", e);
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}

function generateInvoiceHtml(inv: any, customer: any, typeLabel: string, autoPrint: boolean = false, settings: Record<string, string> = {}) {
  const items = inv.items || [];
  const hasDiscountPercent = items.some((li: any) => parseFloat(li.discountPercent || "0") > 0);
  const hasDiscount = items.some((li: any) => parseFloat(li.discount || "0") > 0);

  const companyName = settings.company_name || "VinTrade";
  const companyAddress = settings.company_address || "";
  const companyPhone = settings.company_phone || "";
  const companyEmail = settings.company_email || "";
  const companyTaxId = settings.company_tax_id || "";
  const companyRegNo = settings.company_reg_no || "";
  const companyIban = settings.company_iban || "";
  const companySwift = settings.company_swift || "";
  const companyBankName = settings.company_bank_name || "";
  const currencySymbol = settings.currency_symbol || "\u20AC";
  const invoiceFooter = settings.invoice_footer || "Thank you for your business";

  const itemRows = items.map((li: any, idx: number) => {
    const qty = li.quantity || 0;
    const unit = li.saleUnit || "pc";
    const unitLabel = unit === "pc" ? "" : ` (${unit})`;
    const discPercent = parseFloat(li.discountPercent || "0");
    const discAmount = parseFloat(li.discount || "0");

    return `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td class="cell">${li.description || ""}</td>
      <td class="cell center">${qty}${unitLabel}</td>
      <td class="cell right">${currencySymbol}${parseFloat(li.unitPrice).toFixed(2)}</td>
      ${hasDiscountPercent ? `<td class="cell right">${discPercent > 0 ? discPercent.toFixed(1) + "%" : "-"}</td>` : ""}
      ${hasDiscount ? `<td class="cell right">${discAmount > 0 ? currencySymbol + discAmount.toFixed(2) : "-"}</td>` : ""}
      <td class="cell right bold">${currencySymbol}${parseFloat(li.total).toFixed(2)}</td>
    </tr>`;
  }).join("");

  const hasBankDetails = companyIban || companySwift || companyBankName;

  const printScript = autoPrint ? `<script>window.onload = function() { window.print(); }</script>` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${typeLabel} - ${inv.invoiceNumber}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 0; background: #f5f5f5; }
  .page { max-width: 800px; margin: 0 auto; background: #fff; padding: 48px; min-height: 100vh; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 3px solid #722f37; }
  .brand { }
  .brand-name { font-size: 26px; font-weight: 800; color: #722f37; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 2px; margin-top: 2px; }
  .brand-detail { font-size: 11px; color: #666; line-height: 1.6; margin-top: 6px; }
  .doc-info { text-align: right; }
  .doc-type { font-size: 22px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 1px; }
  .doc-number { font-size: 14px; color: #666; margin-top: 4px; }
  .parties { display: flex; justify-content: space-between; gap: 40px; margin-bottom: 32px; }
  .party { flex: 1; }
  .party-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 600; margin-bottom: 8px; }
  .party-name { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
  .party-detail { font-size: 12px; color: #555; line-height: 1.6; }
  .meta-row { display: flex; gap: 24px; margin-bottom: 28px; padding: 14px 18px; background: #faf8f6; border-radius: 6px; border: 1px solid #f0ebe6; }
  .meta-item { flex: 1; }
  .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; }
  .meta-value { font-size: 13px; font-weight: 600; color: #333; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #722f37; color: #fff; padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; text-align: left; }
  thead th.center { text-align: center; }
  thead th.right { text-align: right; }
  .cell { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #f0f0f0; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 600; }
  .alt-row { background: #fdfcfb; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; }
  .totals-row.subtotal { color: #555; }
  .totals-row.tax { color: #555; }
  .totals-row.grand { font-size: 18px; font-weight: 800; color: #722f37; padding-top: 12px; margin-top: 4px; border-top: 2px solid #722f37; }
  .notes-box { padding: 16px 20px; background: #faf8f6; border-radius: 6px; border-left: 3px solid #722f37; margin-bottom: 32px; }
  .notes-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; margin-bottom: 4px; }
  .notes-text { font-size: 12px; color: #444; line-height: 1.6; }
  .bank-details { padding: 16px 20px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e9ecef; margin-bottom: 32px; }
  .bank-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 600; margin-bottom: 6px; }
  .bank-text { font-size: 12px; color: #444; line-height: 1.8; }
  .footer { text-align: center; padding-top: 24px; border-top: 1px solid #eee; }
  .footer p { font-size: 11px; color: #aaa; line-height: 1.8; }
  .no-print { text-align: center; margin-bottom: 16px; padding: 12px; }
  .no-print button { padding: 10px 28px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; margin: 0 6px; }
  .btn-print { background: #722f37; color: #fff; }
  .btn-print:hover { background: #5a2530; }
  .btn-close { background: #e5e5e5; color: #333; }
  .btn-close:hover { background: #d5d5d5; }
  @media print {
    body { background: #fff; padding: 0; }
    .page { padding: 24px; max-width: 100%; box-shadow: none; }
    .no-print { display: none !important; }
    .header { border-bottom-color: #722f37 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { background: #722f37 !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .totals-row.grand { color: #722f37 !important; border-top-color: #722f37 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .meta-row { background: #faf8f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .alt-row { background: #fdfcfb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @page { margin: 15mm; size: A4; }
</style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">Print Document</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>
  <div class="page">
    <div class="header">
      <div class="brand">
        <div class="brand-name">${companyName}</div>
        <div class="brand-sub">Wholesale Wine & Spirits</div>
        <div class="brand-detail">
          ${companyAddress ? companyAddress + "<br>" : ""}
          ${companyPhone ? "Tel: " + companyPhone : ""}${companyEmail ? " | " + companyEmail : ""}
          ${companyTaxId ? "<br>TIN: " + companyTaxId : ""}${companyRegNo ? " | Reg: " + companyRegNo : ""}
        </div>
      </div>
      <div class="doc-info">
        <div class="doc-type">${typeLabel}</div>
        <div class="doc-number">${inv.invoiceNumber}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-label">Bill To</div>
        <div class="party-name">${customer?.name || "N/A"}</div>
        <div class="party-detail">
          ${customer?.address ? customer.address + "<br>" : ""}
          ${customer?.city || ""}
          ${customer?.taxId ? "<br>Tax ID: " + customer.taxId : ""}
        </div>
      </div>
      <div class="party" style="text-align:right;">
        <div class="party-label">Document Details</div>
        <div class="party-detail">
          <strong>Date:</strong> ${new Date(inv.date).toLocaleDateString("en-GB")}<br>
          ${inv.dueDate ? "<strong>Due:</strong> " + new Date(inv.dueDate).toLocaleDateString("en-GB") + "<br>" : ""}
          <strong>Status:</strong> ${inv.status}<br>
          <strong>Terms:</strong> ${customer?.paymentTerms || "cash"}
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="center">Qty</th>
          <th class="right">Unit Price</th>
          ${hasDiscountPercent ? '<th class="right">Disc %</th>' : ""}
          ${hasDiscount ? '<th class="right">Discount</th>' : ""}
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="totals-section">
      <div class="totals-box">
        <div class="totals-row subtotal">
          <span>Subtotal</span>
          <span>${currencySymbol}${parseFloat(inv.subtotal).toFixed(2)}</span>
        </div>
        <div class="totals-row tax">
          <span>VAT (${inv.taxRate}%)</span>
          <span>${currencySymbol}${parseFloat(inv.taxAmount).toFixed(2)}</span>
        </div>
        <div class="totals-row grand">
          <span>Total</span>
          <span>${currencySymbol}${parseFloat(inv.total).toFixed(2)}</span>
        </div>
      </div>
    </div>

    ${inv.notes ? `
    <div class="notes-box">
      <div class="notes-label">Notes</div>
      <div class="notes-text">${inv.notes}</div>
    </div>` : ""}

    ${hasBankDetails ? `
    <div class="bank-details">
      <div class="bank-label">Bank Details</div>
      <div class="bank-text">
        ${companyBankName ? "<strong>Bank:</strong> " + companyBankName + "<br>" : ""}
        ${companyIban ? "<strong>IBAN:</strong> " + companyIban + "<br>" : ""}
        ${companySwift ? "<strong>SWIFT/BIC:</strong> " + companySwift : ""}
      </div>
    </div>` : ""}

    <div class="footer">
      <p>${companyName} - Wholesale Wine & Spirits</p>
      <p>${invoiceFooter}</p>
    </div>
  </div>
  ${printScript}
</body>
</html>`;
}

function generateStatementHtml(customer: any, statement: any, autoPrint: boolean = false, settings: Record<string, string> = {}) {
  const companyName = settings.company_name || "VinTrade";
  const companyAddress = settings.company_address || "";
  const companyPhone = settings.company_phone || "";
  const companyEmail = settings.company_email || "";
  const companyTaxId = settings.company_tax_id || "";
  const currencySymbol = settings.currency_symbol || "\u20AC";

  const invoices = statement?.invoices || [];
  const invoiceRows = invoices.map((inv: any, idx: number) => `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td class="cell">${inv.invoiceNumber || ""}</td>
      <td class="cell">${new Date(inv.date).toLocaleDateString("en-GB")}</td>
      <td class="cell">${inv.type === "credit_note" ? "Credit Note" : "Invoice"}</td>
      <td class="cell right">${currencySymbol}${parseFloat(inv.total || "0").toFixed(2)}</td>
      <td class="cell right">${currencySymbol}${parseFloat(inv.paid || "0").toFixed(2)}</td>
      <td class="cell right bold">${currencySymbol}${parseFloat(inv.balance || "0").toFixed(2)}</td>
    </tr>
  `).join("");

  const printScript = autoPrint ? `<script>window.onload = function() { window.print(); }</script>` : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Statement - ${customer.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 0; background: #f5f5f5; }
  .page { max-width: 800px; margin: 0 auto; background: #fff; padding: 48px; min-height: 100vh; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 3px solid #722f37; }
  .brand-name { font-size: 26px; font-weight: 800; color: #722f37; }
  .brand-sub { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 2px; margin-top: 2px; }
  .brand-detail { font-size: 11px; color: #666; line-height: 1.6; margin-top: 6px; }
  .doc-type { font-size: 22px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: 1px; }
  .doc-date { font-size: 13px; color: #666; margin-top: 4px; }
  .customer-info { margin-bottom: 28px; }
  .customer-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
  .customer-detail { font-size: 12px; color: #555; line-height: 1.6; }
  .summary { display: flex; gap: 16px; margin-bottom: 32px; }
  .summary-card { flex: 1; background: #faf8f6; padding: 18px 20px; border-radius: 6px; border: 1px solid #f0ebe6; }
  .summary-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; }
  .summary-value { font-size: 22px; font-weight: 800; margin-top: 4px; }
  .summary-value.due { color: #722f37; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #722f37; color: #fff; padding: 10px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; text-align: left; }
  thead th.right { text-align: right; }
  .cell { padding: 10px 12px; font-size: 12px; border-bottom: 1px solid #f0f0f0; }
  .right { text-align: right; }
  .bold { font-weight: 600; }
  .alt-row { background: #fdfcfb; }
  .footer { text-align: center; padding-top: 24px; border-top: 1px solid #eee; margin-top: 40px; }
  .footer p { font-size: 11px; color: #aaa; line-height: 1.8; }
  .no-print { text-align: center; margin-bottom: 16px; padding: 12px; }
  .no-print button { padding: 10px 28px; font-size: 14px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; margin: 0 6px; }
  .btn-print { background: #722f37; color: #fff; }
  .btn-print:hover { background: #5a2530; }
  .btn-close { background: #e5e5e5; color: #333; }
  .btn-close:hover { background: #d5d5d5; }
  @media print {
    body { background: #fff; padding: 0; }
    .page { padding: 24px; max-width: 100%; }
    .no-print { display: none !important; }
    .header { border-bottom-color: #722f37 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { background: #722f37 !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .summary-card { background: #faf8f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .alt-row { background: #fdfcfb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @page { margin: 15mm; size: A4; }
</style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">Print Statement</button>
    <button class="btn-close" onclick="window.close()">Close</button>
  </div>
  <div class="page">
    <div class="header">
      <div>
        <div class="brand-name">${companyName}</div>
        <div class="brand-sub">Wholesale Wine & Spirits</div>
        <div class="brand-detail">
          ${companyAddress ? companyAddress : ""}
          ${companyPhone ? " | Tel: " + companyPhone : ""}
        </div>
      </div>
      <div style="text-align:right;">
        <div class="doc-type">Account Statement</div>
        <div class="doc-date">${new Date().toLocaleDateString("en-GB")}</div>
      </div>
    </div>

    <div class="customer-info">
      <div class="customer-name">${customer.name} (${customer.code})</div>
      <div class="customer-detail">
        ${customer.address ? customer.address + "<br>" : ""}
        ${customer.city || ""}
        ${customer.taxId ? "<br>Tax ID: " + customer.taxId : ""}
        <br>Payment Terms: ${customer.paymentTerms}
      </div>
    </div>

    <div class="summary">
      <div class="summary-card">
        <div class="summary-label">Total Invoiced</div>
        <div class="summary-value">${currencySymbol}${parseFloat(statement?.totalInvoiced || "0").toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Paid</div>
        <div class="summary-value">${currencySymbol}${parseFloat(statement?.totalPaid || "0").toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Balance Due</div>
        <div class="summary-value due">${currencySymbol}${parseFloat(statement?.balance || "0").toFixed(2)}</div>
      </div>
    </div>

    ${invoiceRows ? `
    <table>
      <thead>
        <tr>
          <th>Document</th>
          <th>Date</th>
          <th>Type</th>
          <th class="right">Total</th>
          <th class="right">Paid</th>
          <th class="right">Balance</th>
        </tr>
      </thead>
      <tbody>${invoiceRows}</tbody>
    </table>` : ""}

    <div class="footer">
      <p>${companyName} - Wholesale Wine & Spirits</p>
    </div>
  </div>
  ${printScript}
</body>
</html>`;
}
