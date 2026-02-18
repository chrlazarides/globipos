import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCategorySchema, insertItemSchema, insertCustomerSchema, insertPriceContractSchema, insertSeasonalOfferSchema, insertInvoiceSchema, insertInvoiceItemSchema, insertPaymentSchema, insertPortalOrderSchema, insertPortalOrderItemSchema, insertSupplierSchema, insertPurchaseInvoiceSchema, insertPurchaseInvoiceItemSchema, insertSupplierPaymentSchema } from "@shared/schema";
import { z } from "zod";
import multer from "multer";
import * as XLSX from "xlsx";

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
                return res.status(400).json({ message: `Not enough stock for ${item.itemName || item.name || 'item'}. Available: ${item.stockQuantity} bottles, needed: ${bottlesToSubtract}` });
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

      const html = generateInvoiceHtml(inv, customer, typeLabel, autoPrint);

      res.setHeader("Content-Type", "text/html");
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.html"`);
      }
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
      const autoPrint = req.query.print === "1";
      const html = generateStatementHtml(customer, st, autoPrint);
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

  return httpServer;
}

function generateInvoiceHtml(inv: any, customer: any, typeLabel: string, autoPrint: boolean = false) {
  const items = inv.items || [];
  const hasDiscountPercent = items.some((li: any) => parseFloat(li.discountPercent || "0") > 0);
  const hasDiscount = items.some((li: any) => parseFloat(li.discount || "0") > 0);

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
      <td class="cell right">\u20AC${parseFloat(li.unitPrice).toFixed(2)}</td>
      ${hasDiscountPercent ? `<td class="cell right">${discPercent > 0 ? discPercent.toFixed(1) + "%" : "-"}</td>` : ""}
      ${hasDiscount ? `<td class="cell right">${discAmount > 0 ? "\u20AC" + discAmount.toFixed(2) : "-"}</td>` : ""}
      <td class="cell right bold">\u20AC${parseFloat(li.total).toFixed(2)}</td>
    </tr>`;
  }).join("");

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
        <div class="brand-name">VinTrade</div>
        <div class="brand-sub">Wholesale Wine & Spirits</div>
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
          <span>\u20AC${parseFloat(inv.subtotal).toFixed(2)}</span>
        </div>
        <div class="totals-row tax">
          <span>VAT (${inv.taxRate}%)</span>
          <span>\u20AC${parseFloat(inv.taxAmount).toFixed(2)}</span>
        </div>
        <div class="totals-row grand">
          <span>Total</span>
          <span>\u20AC${parseFloat(inv.total).toFixed(2)}</span>
        </div>
      </div>
    </div>

    ${inv.notes ? `
    <div class="notes-box">
      <div class="notes-label">Notes</div>
      <div class="notes-text">${inv.notes}</div>
    </div>` : ""}

    <div class="footer">
      <p>VinTrade - Wholesale Wine & Spirits</p>
      <p>Thank you for your business</p>
    </div>
  </div>
  ${printScript}
</body>
</html>`;
}

function generateStatementHtml(customer: any, statement: any, autoPrint: boolean = false) {
  const invoices = statement?.invoices || [];
  const invoiceRows = invoices.map((inv: any, idx: number) => `
    <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
      <td class="cell">${inv.invoiceNumber || ""}</td>
      <td class="cell">${new Date(inv.date).toLocaleDateString("en-GB")}</td>
      <td class="cell">${inv.type === "credit_note" ? "Credit Note" : "Invoice"}</td>
      <td class="cell right">\u20AC${parseFloat(inv.total || "0").toFixed(2)}</td>
      <td class="cell right">\u20AC${parseFloat(inv.paid || "0").toFixed(2)}</td>
      <td class="cell right bold">\u20AC${parseFloat(inv.balance || "0").toFixed(2)}</td>
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
        <div class="brand-name">VinTrade</div>
        <div class="brand-sub">Wholesale Wine & Spirits</div>
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
        <div class="summary-value">\u20AC${parseFloat(statement?.totalInvoiced || "0").toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Total Paid</div>
        <div class="summary-value">\u20AC${parseFloat(statement?.totalPaid || "0").toFixed(2)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Balance Due</div>
        <div class="summary-value due">\u20AC${parseFloat(statement?.balance || "0").toFixed(2)}</div>
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
      <p>VinTrade - Wholesale Wine & Spirits</p>
    </div>
  </div>
  ${printScript}
</body>
</html>`;
}
