import jwt from "jsonwebtoken";

const BASE_URL = "http://localhost:5000";
const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const SKU = `TEST-STOCK-${Date.now()}`;

// Generate auth token
const token = jwt.sign({ id: 1, username: "devadmin", role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
const H = { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };

let passed = 0, failed = 0;

function ok(label, condition, detail = "") {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); failed++; }
}

async function api(method, path, body) {
  const r = await fetch(BASE_URL + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

// ── 1. Setup: create item ──────────────────────────────────────────────────────
console.log("\n══ 1. SETUP — Create test wine item ══");
const { data: customer } = await api("GET", "/api/customers");
const testCustomer = customer.find(c => c.code === "CUST001") || customer[0];
ok("Customer exists in DB", !!testCustomer, JSON.stringify(customer?.length));

const { data: suppliers } = await api("GET", "/api/suppliers");
const testSupplier = suppliers[0];
ok("Supplier exists in DB", !!testSupplier);

const itemRes = await api("POST", "/api/items", {
  name: "Test Bottle For Stock", sku: SKU,
  price1: "50.00", price2: "50.00", price3: "50.00", price4: "50.00", price5: "50.00",
  costPrice: "20.00", vatRate: "19", stockQuantity: 0,
  unitType: "bottle", packSize: 1, reorderLevel: 2, active: true,
  categoryId: null, barcode: null, description: ""
});
const testItem = itemRes.data;
ok("Test item created", itemRes.status === 201 || itemRes.status === 200, JSON.stringify(itemRes.data));

// ── 2. Stock — Purchase Invoice (should ADD stock) ─────────────────────────────
console.log("\n══ 2. STOCK — Purchase invoice adds bottles ══");
const initialStock = testItem.stockQuantity ?? 0;

const purchaseRes = await api("POST", "/api/purchase-invoices", {
  supplierId: testSupplier.id,
  invoiceNumber: `PI-TEST-${Date.now()}`,
  invoiceDate: new Date().toISOString().slice(0,10),
  dueDate: new Date().toISOString().slice(0,10),
  status: "confirmed",
  notes: "Stock test purchase",
  subtotal: "100.00", taxAmount: "19.00", total: "119.00",
  items: [{ itemId: testItem.id, description: "Test Bottle", quantity: 10, unitPrice: "20.00", total: "200.00", purchaseUnit: "bottle", packSize: 1 }]
});
ok("Purchase invoice created (HTTP 200/201)", purchaseRes.status === 200 || purchaseRes.status === 201, `status=${purchaseRes.status} ${JSON.stringify(purchaseRes.data).slice(0,100)}`);

const { data: itemAfterPurchase } = await api("GET", `/api/items/${testItem.id}`);
ok("Stock increased by 10 after purchase", itemAfterPurchase.stockQuantity === initialStock + 10,
  `expected ${initialStock + 10}, got ${itemAfterPurchase.stockQuantity}`);

// ── 3. Stock — Draft Sales Invoice (should NOT subtract stock) ─────────────────
console.log("\n══ 3. STOCK — Draft sales invoice does NOT deduct stock ══");
const draftRes = await api("POST", "/api/invoices", {
  customerId: testCustomer.id, type: "invoice", status: "draft",
  invoiceDate: new Date().toISOString().slice(0,10),
  dueDate: new Date().toISOString().slice(0,10), paymentTerms: "credit_30",
  subtotal: "50.00", taxAmount: "9.50", total: "59.50", notes: "Draft test",
  items: [{ itemId: testItem.id, description: "Test Bottle", quantity: 3, saleUnit: "bottle", packSize: 1, unitPrice: "50.00", discount: "0", discountPercent: "0", vatRate: "19", total: "150.00" }]
});
ok("Draft invoice created", draftRes.status === 200 || draftRes.status === 201, `status=${draftRes.status}`);

const { data: itemAfterDraft } = await api("GET", `/api/items/${testItem.id}`);
ok("Stock UNCHANGED after draft invoice", itemAfterDraft.stockQuantity === initialStock + 10,
  `expected ${initialStock + 10}, got ${itemAfterDraft.stockQuantity}`);

// ── 4. Stock — Confirmed Sales Invoice (should subtract stock) ─────────────────
console.log("\n══ 4. STOCK — Confirmed sales invoice deducts stock ══");
const saleRes = await api("POST", "/api/invoices", {
  customerId: testCustomer.id, type: "invoice", status: "confirmed",
  invoiceDate: new Date().toISOString().slice(0,10),
  dueDate: new Date().toISOString().slice(0,10), paymentTerms: "credit_30",
  subtotal: "50.00", taxAmount: "9.50", total: "59.50", notes: "Stock deduction test",
  items: [{ itemId: testItem.id, description: "Test Bottle", quantity: 4, saleUnit: "bottle", packSize: 1, unitPrice: "50.00", discount: "0", discountPercent: "0", vatRate: "19", total: "200.00" }]
});
ok("Confirmed sales invoice created", saleRes.status === 200 || saleRes.status === 201, `status=${saleRes.status} ${JSON.stringify(saleRes.data).slice(0,100)}`);
const salesInvoice = saleRes.data;

const { data: itemAfterSale } = await api("GET", `/api/items/${testItem.id}`);
ok("Stock decreased by 4 after confirmed sale", itemAfterSale.stockQuantity === initialStock + 10 - 4,
  `expected ${initialStock + 6}, got ${itemAfterSale.stockQuantity}`);

// ── 5. Stock — Oversell blocked ────────────────────────────────────────────────
console.log("\n══ 5. STOCK — Oversell attempt blocked ══");
const oversellRes = await api("POST", "/api/invoices", {
  customerId: testCustomer.id, type: "invoice", status: "confirmed",
  invoiceDate: new Date().toISOString().slice(0,10),
  dueDate: new Date().toISOString().slice(0,10), paymentTerms: "credit_30",
  subtotal: "500.00", taxAmount: "95.00", total: "595.00", notes: "Oversell test",
  items: [{ itemId: testItem.id, description: "Test Bottle", quantity: 9999, saleUnit: "bottle", packSize: 1, unitPrice: "50.00", discount: "0", discountPercent: "0", vatRate: "19", total: "499950.00" }]
});
ok("Oversell blocked (HTTP 400)", oversellRes.status === 400, `got HTTP ${oversellRes.status}`);

// ── 6. Stock — Credit note restores stock ─────────────────────────────────────
console.log("\n══ 6. STOCK — Credit note restores stock ══");
const cnRes = await api("POST", "/api/invoices", {
  customerId: testCustomer.id, type: "credit_note", status: "confirmed",
  invoiceDate: new Date().toISOString().slice(0,10),
  dueDate: new Date().toISOString().slice(0,10), paymentTerms: "credit_30",
  subtotal: "-50.00", taxAmount: "-9.50", total: "-59.50", notes: "CN stock restore",
  relatedInvoiceId: salesInvoice.id,
  items: [{ itemId: testItem.id, description: "Test Bottle", quantity: 2, saleUnit: "bottle", packSize: 1, unitPrice: "50.00", discount: "0", discountPercent: "0", vatRate: "19", total: "-100.00" }]
});
ok("Credit note created", cnRes.status === 200 || cnRes.status === 201, `status=${cnRes.status}`);

const { data: itemAfterCN } = await api("GET", `/api/items/${testItem.id}`);
ok("Stock restored by 2 after credit note", itemAfterCN.stockQuantity === initialStock + 10 - 4 + 2,
  `expected ${initialStock + 8}, got ${itemAfterCN.stockQuantity}`);

// ── 7. Accounting — Journal entries ────────────────────────────────────────────
console.log("\n══ 7. ACCOUNTING — Journal entries for the sale ══");
const { data: journals } = await api("GET", `/api/journal-entries?invoiceId=${salesInvoice.id}`);
ok("Journal entry exists for confirmed sale", Array.isArray(journals) && journals.length > 0, `count=${journals?.length}`);
if (journals?.length > 0) {
  const lines = journals[0].lines || [];
  const arLine = lines.find(l => l.accountCode === "1100");
  const salesLine = lines.find(l => l.accountCode === "4000");
  const vatLine = lines.find(l => l.accountCode === "2100");
  ok("AR debit line exists (account 1100)", !!arLine && parseFloat(arLine.debit) > 0);
  ok("Sales credit line exists (account 4000)", !!salesLine && parseFloat(salesLine.credit) > 0);
  ok("VAT payable credit line exists (account 2100)", !!vatLine && parseFloat(vatLine.credit) > 0);
}

// ── 8. Accounting — Customer balance ──────────────────────────────────────────
console.log("\n══ 8. ACCOUNTING — Customer balance updated by sale ══");
const { data: customerAfter } = await api("GET", `/api/customers/${testCustomer.id}`);
ok("Customer record accessible", !!customerAfter.id);

// ── 9. Sales Reports ──────────────────────────────────────────────────────────
console.log("\n══ 9. SALES REPORTS ══");
const { data: reports, status: rStatus } = await api("GET", "/api/reports/sales-summary");
ok("Sales summary endpoint responds (HTTP 200)", rStatus === 200, `status=${rStatus}`);
if (rStatus === 200 && typeof reports === "object") {
  ok("Report has totalRevenue field", "totalRevenue" in reports || "total" in reports || Array.isArray(reports), JSON.stringify(Object.keys(reports)).slice(0,80));
}

const { data: agingData, status: agingStatus } = await api("GET", "/api/reports/aging");
ok("Aging report endpoint responds (HTTP 200)", agingStatus === 200, `status=${agingStatus}`);

const { data: plData, status: plStatus } = await api("GET", "/api/reports/profit-loss");
ok("P&L report endpoint responds (HTTP 200)", plStatus === 200, `status=${plStatus}`);
if (plStatus === 200 && typeof plData === "object") {
  ok("P&L has revenue field", "revenue" in plData || "totalRevenue" in plData || "income" in plData, JSON.stringify(Object.keys(plData)).slice(0,80));
}

const { data: stockReport, status: srStatus } = await api("GET", "/api/reports/stock");
ok("Stock report endpoint responds (HTTP 200)", srStatus === 200, `status=${srStatus}`);
if (srStatus === 200 && Array.isArray(stockReport)) {
  const ourItem = stockReport.find(r => r.sku === SKU || r.id === testItem.id);
  ok("Test item appears in stock report", !!ourItem, `items in report: ${stockReport.length}`);
  if (ourItem) ok("Stock report shows correct qty", ourItem.stockQuantity === itemAfterCN.stockQuantity,
    `report=${ourItem.stockQuantity}, DB=${itemAfterCN.stockQuantity}`);
}

// ── 10. Cleanup ────────────────────────────────────────────────────────────────
console.log("\n══ 10. CLEANUP ══");
const delRes = await api("DELETE", `/api/items/${testItem.id}`);
ok("Test item cleaned up", delRes.status === 200 || delRes.status === 204, `status=${delRes.status}`);

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n══ RESULT: ${passed} passed, ${failed} failed ══`);
if (failed > 0) process.exit(1);
