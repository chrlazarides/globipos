/**
 * Stock Management & Sales Reports Test Suite
 *
 * Tests: purchase invoice adds stock, draft invoice does NOT deduct stock,
 * confirmed/sent invoice deducts stock, oversell blocked, credit note restores stock,
 * report endpoints return valid data, journal entries balanced.
 *
 * Auth: Bearer JWT (same strategy as accounting-audit.spec.ts).
 */

import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import jwt from "jsonwebtoken";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const SKU = `STOCK-TEST-${Date.now()}`;

function generateToken() {
  return jwt.sign(
    { id: "stock-test-user", username: "stock_test", email: "stock@test.local", role: "admin" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

interface Ctx {
  token: string;
  itemId: string;
  itemInitialStock: number;
  customerId: string;
  supplierId: string;
  purchaseInvoiceId: string;
  salesInvoiceId: string;
  draftInvoiceId: string;
  creditNoteId: string;
  categoryId: string;
}

const ctx: Ctx = {
  token: "", itemId: "", itemInitialStock: 0, customerId: "", supplierId: "",
  purchaseInvoiceId: "", salesInvoiceId: "", draftInvoiceId: "", creditNoteId: "", categoryId: ""
};

async function api(
  rc: APIRequestContext, method: "GET"|"POST"|"PATCH"|"DELETE",
  path: string, body?: object
): Promise<any> {
  const opts: any = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.token}` } };
  if (body) opts.data = body;
  let res: any;
  if (method === "GET")    res = await rc.get(`${BASE_URL}${path}`, opts);
  else if (method === "POST")   res = await rc.post(`${BASE_URL}${path}`, opts);
  else if (method === "PATCH")  res = await rc.patch(`${BASE_URL}${path}`, opts);
  else if (method === "DELETE") res = await rc.delete(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  try { return { status: res.status(), data: JSON.parse(text) }; }
  catch { return { status: res.status(), data: text }; }
}

const today = new Date().toISOString().split("T")[0];

test.describe.serial("Stock Management & Sales Reports", () => {

  // ── SETUP ──────────────────────────────────────────────────────────────────
  test("Setup: auth, item, customer, supplier", async ({ request }) => {
    ctx.token = generateToken();

    // Category
    const catRes = await api(request, "POST", "/api/categories", {
      name: `Stock Test Cat ${Date.now()}`, description: "", active: true
    });
    expect(catRes.status, "category created").toBeLessThan(300);
    ctx.categoryId = catRes.data.id;

    // Item starting at 0 stock
    const itemRes = await api(request, "POST", "/api/items", {
      name: "Stock Test Bottle", sku: SKU,
      price1: "50.00", price2: "50.00", price3: "50.00", price4: "50.00", price5: "50.00",
      costPrice: "20.00", vatRate: "19", stockQuantity: 0,
      unitType: "bottle", packSize: 1, reorderLevel: 2, active: true,
      categoryId: ctx.categoryId, barcode: null, description: ""
    });
    expect(itemRes.status, `item created (${JSON.stringify(itemRes.data).slice(0,120)})`).toBeLessThan(300);
    ctx.itemId = itemRes.data.id;
    ctx.itemInitialStock = 0;

    // Existing customer
    const custRes = await api(request, "GET", "/api/customers");
    expect(custRes.status).toBe(200);
    const cust = custRes.data.find((c: any) => c.code === "CUST001") || custRes.data[0];
    expect(cust, "at least one customer exists").toBeTruthy();
    ctx.customerId = cust.id;

    // Existing supplier
    const supRes = await api(request, "GET", "/api/suppliers");
    expect(supRes.status).toBe(200);
    const sup = supRes.data[0];
    expect(sup, "at least one supplier exists").toBeTruthy();
    ctx.supplierId = sup.id;
  });

  // ── TEST 1: Purchase invoice ADDS stock ────────────────────────────────────
  test("Purchase invoice adds 12 bottles to stock", async ({ request }) => {
    const before = await api(request, "GET", `/api/items/${ctx.itemId}`);
    const stockBefore = before.data.stockQuantity;

    const piRes = await api(request, "POST", "/api/purchase-invoices", {
      supplierId: ctx.supplierId,
      invoiceNumber: `PI-STKTEST-${Date.now()}`,
      date: today,
      dueDate: today,
      status: "confirmed",
      notes: "Stock test purchase",
      subtotal: "240.00",
      vatAmount: "45.60",
      total: "285.60",
      items: [{
        purchaseInvoiceId: "TEMP",
        itemId: ctx.itemId,
        description: "Stock Test Bottle",
        quantity: 12,
        purchaseUnit: "bottle",
        unitCost: "20.00",
        discountPercent: "0",
        discount: "0.00",
        vatRate: "19",
        total: "240.00"
      }]
    });
    expect(piRes.status, `purchase invoice created — ${JSON.stringify(piRes.data).slice(0,120)}`).toBeLessThan(300);
    ctx.purchaseInvoiceId = piRes.data.id;

    const after = await api(request, "GET", `/api/items/${ctx.itemId}`);
    expect(after.data.stockQuantity, `stock should be ${stockBefore + 12}`).toBe(stockBefore + 12);
  });

  // ── TEST 2: Draft sales invoice does NOT deduct stock ─────────────────────
  test("Draft sales invoice does NOT deduct stock", async ({ request }) => {
    const before = await api(request, "GET", `/api/items/${ctx.itemId}`);
    const stockBefore = before.data.stockQuantity;

    const draftRes = await api(request, "POST", "/api/invoices", {
      type: "invoice", customerId: ctx.customerId, date: today, status: "draft",
      subtotal: "50.00", taxRate: "19", taxAmount: "9.50", discountAmount: "0.00", total: "59.50",
      items: [{
        itemId: ctx.itemId, description: "Stock Test Bottle", quantity: 3, saleUnit: "bottle",
        unitPrice: "50.00", discountPercent: "0", discount: "0.00", total: "150.00"
      }]
    });
    expect(draftRes.status, `draft invoice created — ${JSON.stringify(draftRes.data).slice(0,120)}`).toBeLessThan(300);
    ctx.draftInvoiceId = draftRes.data.id;

    const after = await api(request, "GET", `/api/items/${ctx.itemId}`);
    expect(after.data.stockQuantity, "draft must not deduct stock").toBe(stockBefore);
  });

  // ── TEST 3: Confirmed/sent invoice DOES deduct stock ──────────────────────
  test("Confirmed sales invoice deducts 5 bottles from stock", async ({ request }) => {
    const before = await api(request, "GET", `/api/items/${ctx.itemId}`);
    const stockBefore = before.data.stockQuantity;

    const saleRes = await api(request, "POST", "/api/invoices", {
      type: "invoice", customerId: ctx.customerId, date: today, status: "sent",
      subtotal: "250.00", taxRate: "19", taxAmount: "47.50", discountAmount: "0.00", total: "297.50",
      items: [{
        itemId: ctx.itemId, description: "Stock Test Bottle", quantity: 5, saleUnit: "bottle",
        unitPrice: "50.00", discountPercent: "0", discount: "0.00", total: "250.00"
      }]
    });
    expect(saleRes.status, `sale invoice created — ${JSON.stringify(saleRes.data).slice(0,120)}`).toBeLessThan(300);
    ctx.salesInvoiceId = saleRes.data.id;

    const after = await api(request, "GET", `/api/items/${ctx.itemId}`);
    expect(after.data.stockQuantity, `stock should be ${stockBefore - 5}`).toBe(stockBefore - 5);
  });

  // ── TEST 4: Oversell blocked ───────────────────────────────────────────────
  test("Oversell attempt is blocked with HTTP 400", async ({ request }) => {
    const oversellRes = await api(request, "POST", "/api/invoices", {
      type: "invoice", customerId: ctx.customerId, date: today, status: "sent",
      subtotal: "499950.00", taxRate: "19", taxAmount: "94990.50", discountAmount: "0.00", total: "594940.50",
      items: [{
        itemId: ctx.itemId, description: "Stock Test Bottle", quantity: 9999, saleUnit: "bottle",
        unitPrice: "50.00", discountPercent: "0", discount: "0.00", total: "499950.00"
      }]
    });
    expect(oversellRes.status, "oversell should return 400").toBe(400);
  });

  // ── TEST 5: Credit note restores stock ────────────────────────────────────
  test("Credit note restores 2 bottles to stock", async ({ request }) => {
    const before = await api(request, "GET", `/api/items/${ctx.itemId}`);
    const stockBefore = before.data.stockQuantity;

    const cnRes = await api(request, "POST", "/api/invoices", {
      type: "credit_note", customerId: ctx.customerId, date: today, status: "confirmed",
      subtotal: "100.00", taxRate: "19", taxAmount: "19.00", discountAmount: "0.00", total: "119.00",
      relatedInvoiceId: ctx.salesInvoiceId,
      items: [{
        itemId: ctx.itemId, description: "Stock Test Bottle (Return)", quantity: 2, saleUnit: "bottle",
        unitPrice: "50.00", discountPercent: "0", discount: "0.00", total: "100.00"
      }]
    });
    expect(cnRes.status, `credit note created — ${JSON.stringify(cnRes.data).slice(0,120)}`).toBeLessThan(300);
    ctx.creditNoteId = cnRes.data.id;

    const after = await api(request, "GET", `/api/items/${ctx.itemId}`);
    expect(after.data.stockQuantity, `stock should restore by 2 to ${stockBefore + 2}`).toBe(stockBefore + 2);
  });

  // ── TEST 6: Journal entries for sale are balanced ─────────────────────────
  test("Sales invoice generates balanced journal entries with correct accounts", async ({ request }) => {
    await new Promise(r => setTimeout(r, 500));

    const jeListRes = await api(request, "GET", "/api/journal-entries");
    expect(jeListRes.status).toBe(200);

    const invoiceJE = jeListRes.data.find(
      (je: any) => je.sourceType === "invoice" && je.sourceId === ctx.salesInvoiceId
    );
    expect(invoiceJE, `JE exists for invoice ${ctx.salesInvoiceId}`).toBeTruthy();

    const jeDetail = await api(request, "GET", `/api/journal-entries/${invoiceJE.id}`);
    expect(jeDetail.status).toBe(200);
    const lines = jeDetail.data.lines || [];
    expect(lines.length, "JE has at least 2 lines").toBeGreaterThanOrEqual(2);

    // Must be balanced
    const totalDebits  = lines.reduce((s: number, l: any) => s + parseFloat(l.debit  || "0"), 0);
    const totalCredits = lines.reduce((s: number, l: any) => s + parseFloat(l.credit || "0"), 0);
    expect(Math.abs(totalDebits - totalCredits), "JE is balanced (debits = credits)").toBeLessThanOrEqual(0.01);

    // AR debited
    const arLine = lines.find((l: any) => l.accountCode === "1100");
    expect(arLine, "AR (1100) line present").toBeTruthy();
    expect(parseFloat(arLine.debit), "AR is debited").toBeGreaterThan(0);

    // Sales credited
    const salesLine = lines.find((l: any) => l.accountCode === "4000");
    expect(salesLine, "Sales Revenue (4000) line present").toBeTruthy();
    expect(parseFloat(salesLine.credit), "Sales is credited").toBeGreaterThan(0);

    // VAT credited
    const vatLine = lines.find((l: any) => l.accountCode === "2100");
    expect(vatLine, "VAT Payable (2100) line present").toBeTruthy();
    expect(parseFloat(vatLine.credit), "VAT is credited").toBeGreaterThan(0);

    // COGS debited and Inventory credited
    const cogsLine = lines.find((l: any) => l.accountCode === "5000");
    expect(cogsLine, "COGS (5000) line present — item has cost price").toBeTruthy();
    expect(parseFloat(cogsLine.debit), "COGS is debited").toBeGreaterThan(0);

    const invLine = lines.find((l: any) => l.accountCode === "1200");
    expect(invLine, "Inventory (1200) line present").toBeTruthy();
    expect(parseFloat(invLine.credit), "Inventory is credited").toBeGreaterThan(0);
  });

  // ── TEST 7: Credit note JE is balanced and reverses the sale ─────────────
  test("Credit note generates a balanced reversing journal entry", async ({ request }) => {
    await new Promise(r => setTimeout(r, 500));
    const jeListRes = await api(request, "GET", "/api/journal-entries");
    expect(jeListRes.status).toBe(200);

    const cnJE = jeListRes.data.find(
      (je: any) => je.sourceType === "credit_note" && je.sourceId === ctx.creditNoteId
    );
    expect(cnJE, "JE exists for credit note").toBeTruthy();

    const jeDetail = await api(request, "GET", `/api/journal-entries/${cnJE.id}`);
    const lines = jeDetail.data.lines || [];
    const totalDebits  = lines.reduce((s: number, l: any) => s + parseFloat(l.debit  || "0"), 0);
    const totalCredits = lines.reduce((s: number, l: any) => s + parseFloat(l.credit || "0"), 0);
    expect(Math.abs(totalDebits - totalCredits), "CN JE is balanced").toBeLessThanOrEqual(0.01);

    // AR credited (reversed)
    const arLine = lines.find((l: any) => l.accountCode === "1100");
    expect(arLine, "AR (1100) line present in CN JE").toBeTruthy();
    expect(parseFloat(arLine.credit), "AR is credited on CN (reversal)").toBeGreaterThan(0);
  });

  // ── TEST 8: Sales Reports endpoints ───────────────────────────────────────
  test("Sales summary report returns valid data", async ({ request }) => {
    const res = await api(request, "GET", "/api/reports/sales-summary");
    expect(res.status, "sales-summary endpoint up").toBe(200);
    expect(res.data).toBeTruthy();
  });

  test("Aging / statements report returns an array with customer data", async ({ request }) => {
    const res = await api(request, "GET", "/api/reports/statements");
    expect(res.status, "statements endpoint up").toBe(200);
    expect(Array.isArray(res.data), "statements response is an array").toBeTruthy();
    // Each statement should have customerId and an aging breakdown
    if (res.data.length > 0) {
      const first = res.data[0];
      expect(first, "statement has customerId").toHaveProperty("customerId");
    }
  });

  test("Profit & Loss report returns revenue and expense figures", async ({ request }) => {
    const from = "2020-01-01";
    const res = await api(request, "GET", `/api/reports/profit-loss/${from}/${today}`);
    expect(res.status, "P&L endpoint up").toBe(200);
    const keys = Object.keys(res.data || {});
    const hasRevenue = keys.some(k => /revenue|income|sales|net/i.test(k));
    expect(hasRevenue, `P&L has a revenue/income field — keys: ${keys.join(", ")}`).toBeTruthy();
  });

  test("Items list includes test item with correct stock quantity", async ({ request }) => {
    const res = await api(request, "GET", "/api/items");
    expect(res.status, "items endpoint up").toBe(200);
    expect(Array.isArray(res.data), "items response is an array").toBeTruthy();

    const ourItem = res.data.find((r: any) => r.id === ctx.itemId || r.sku === SKU);
    expect(ourItem, "test item appears in items list").toBeTruthy();

    // After: +12 purchase, -5 sale, +2 credit note, draft did nothing = net +9
    const expectedQty = ctx.itemInitialStock + 12 - 5 + 2;
    expect(ourItem.stockQuantity, `items list qty = ${expectedQty}`).toBe(expectedQty);
  });

  // ── CLEANUP ────────────────────────────────────────────────────────────────
  test("Cleanup: delete test item and category", async ({ request }) => {
    if (ctx.itemId) {
      const r = await api(request, "DELETE", `/api/items/${ctx.itemId}`);
      expect([200, 204, 404], "item deleted or already gone").toContain(r.status);
    }
    if (ctx.categoryId) {
      const r = await api(request, "DELETE", `/api/categories/${ctx.categoryId}`);
      expect([200, 204, 404], "category deleted or already gone").toContain(r.status);
    }
  });
});
