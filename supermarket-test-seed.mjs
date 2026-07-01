/**
 * Supermarket Test Seed — GlobiPOS
 * Creates a full retail supermarket test dataset:
 *   - POS Location: Fresh Market Supermarket
 *   - POS Terminal: T001 (Checkout 1)
 *   - 10 categories + ~45 products with barcodes
 *   - POS Layout Set with category + hot-item buttons
 *   - 4 cashiers (manager, supervisor, 2× cashier)
 *
 * Usage:
 *   node supermarket-test-seed.mjs
 *
 * Requires the GlobiPOS server to be running on localhost:5000.
 */

import jwt from "jsonwebtoken";

const BASE = "http://localhost:5000";
const SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
const token = jwt.sign({ id: 1, username: "superadmin", role: "superuser" }, SECRET, { expiresIn: "2h" });
const H = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

let ok = 0, fail = 0;
function log(label, pass, detail = "") {
  if (pass) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}${detail ? " — " + detail : ""}`); fail++; }
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method, headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; }
  catch { return { status: r.status, data: text }; }
}

// ── 1. Categories ─────────────────────────────────────────────────────────────
console.log("\n══ 1. CATEGORIES ══");

const CATS = [
  { name: "Dairy & Eggs",          vatRate: "5",  description: "Milk, cheese, eggs, yogurt, butter" },
  { name: "Beverages",             vatRate: "19", description: "Water, soft drinks, juices, coffee, tea" },
  { name: "Snacks & Confectionery",vatRate: "19", description: "Crisps, chocolate, biscuits, nuts" },
  { name: "Bakery",                vatRate: "5",  description: "Bread, rolls, pastries, pitta" },
  { name: "Fresh Produce",         vatRate: "5",  description: "Fruit, vegetables, herbs" },
  { name: "Frozen Foods",          vatRate: "19", description: "Frozen meals, ice cream, vegetables" },
  { name: "Household & Cleaning",  vatRate: "19", description: "Detergents, cleaning products, paper goods" },
  { name: "Meat & Fish",           vatRate: "5",  description: "Fresh and packaged meat, poultry, seafood" },
  { name: "Beer, Wine & Spirits",  vatRate: "19", description: "Alcoholic beverages" },
  { name: "Tobacco",               vatRate: "19", description: "Cigarettes and tobacco products" },
];

const catIds = {};
for (const cat of CATS) {
  const { status, data } = await api("POST", "/api/categories", {
    name: cat.name, description: cat.description, vatRate: cat.vatRate,
    active: true, parentId: null,
  });
  if (status === 200 || status === 201) {
    catIds[cat.name] = data.id;
    log(`Category: ${cat.name}`, true);
  } else {
    // May already exist — try to find it
    const { data: all } = await api("GET", "/api/categories");
    const found = all?.find?.(c => c.name === cat.name);
    if (found) { catIds[cat.name] = found.id; log(`Category: ${cat.name} (existing)`, true); }
    else log(`Category: ${cat.name}`, false, JSON.stringify(data));
  }
}

// ── 2. Products ───────────────────────────────────────────────────────────────
console.log("\n══ 2. PRODUCTS ══");

const PRODUCTS = [
  // Dairy & Eggs
  { name:"Whole Milk 1L",          sku:"MILK001", barcode:"5201001001001", cat:"Dairy & Eggs",           price:"1.20", cost:"0.70", vat:"5",  stock:200, unit:"each",  pack:1 },
  { name:"Semi-Skimmed Milk 1L",   sku:"MILK002", barcode:"5201001001002", cat:"Dairy & Eggs",           price:"1.15", cost:"0.65", vat:"5",  stock:150, unit:"each",  pack:1 },
  { name:"Fresh Eggs 6pk",         sku:"EGGS001", barcode:"5201001001003", cat:"Dairy & Eggs",           price:"1.80", cost:"0.90", vat:"5",  stock:100, unit:"pack",  pack:6 },
  { name:"Greek Yogurt 500g",      sku:"YOGU001", barcode:"5201001001004", cat:"Dairy & Eggs",           price:"1.50", cost:"0.80", vat:"5",  stock:80,  unit:"each",  pack:1 },
  { name:"Cheddar Cheese 200g",    sku:"CHEE001", barcode:"5201001001005", cat:"Dairy & Eggs",           price:"2.50", cost:"1.40", vat:"5",  stock:60,  unit:"each",  pack:1 },
  { name:"Unsalted Butter 250g",   sku:"BUTT001", barcode:"5201001001006", cat:"Dairy & Eggs",           price:"2.20", cost:"1.20", vat:"5",  stock:70,  unit:"each",  pack:1 },
  // Beverages
  { name:"Still Water 1.5L",       sku:"WATR001", barcode:"5201002001001", cat:"Beverages",              price:"0.45", cost:"0.15", vat:"19", stock:500, unit:"bottle",pack:1 },
  { name:"Sparkling Water 1.5L",   sku:"WATR002", barcode:"5201002001002", cat:"Beverages",              price:"0.55", cost:"0.18", vat:"19", stock:300, unit:"bottle",pack:1 },
  { name:"Cola 1.5L",              sku:"COLA001", barcode:"5201002001003", cat:"Beverages",              price:"1.25", cost:"0.55", vat:"19", stock:200, unit:"bottle",pack:1 },
  { name:"Orange Juice 1L",        sku:"OJUI001", barcode:"5201002001004", cat:"Beverages",              price:"1.80", cost:"0.90", vat:"19", stock:120, unit:"carton",pack:1 },
  { name:"Green Tea 500ml",        sku:"GTEA001", barcode:"5201002001005", cat:"Beverages",              price:"1.10", cost:"0.55", vat:"19", stock:90,  unit:"bottle",pack:1 },
  { name:"Ground Coffee 250g",     sku:"COFF001", barcode:"5201002001006", cat:"Beverages",              price:"4.50", cost:"2.50", vat:"19", stock:60,  unit:"each",  pack:1 },
  // Snacks
  { name:"Crisps Original 150g",   sku:"CRIS001", barcode:"5201003001001", cat:"Snacks & Confectionery", price:"0.99", cost:"0.45", vat:"19", stock:200, unit:"bag",   pack:1 },
  { name:"Crisps Cheese 150g",     sku:"CRIS002", barcode:"5201003001002", cat:"Snacks & Confectionery", price:"0.99", cost:"0.45", vat:"19", stock:180, unit:"bag",   pack:1 },
  { name:"Milk Chocolate Bar 100g",sku:"CHOC001", barcode:"5201003001003", cat:"Snacks & Confectionery", price:"0.85", cost:"0.38", vat:"19", stock:250, unit:"each",  pack:1 },
  { name:"Dark Chocolate Bar 100g",sku:"CHOC002", barcode:"5201003001004", cat:"Snacks & Confectionery", price:"0.99", cost:"0.45", vat:"19", stock:150, unit:"each",  pack:1 },
  { name:"Digestive Biscuits 200g",sku:"BISC001", barcode:"5201003001005", cat:"Snacks & Confectionery", price:"1.20", cost:"0.55", vat:"19", stock:120, unit:"pack",  pack:1 },
  { name:"Salted Mixed Nuts 250g", sku:"NUTS001", barcode:"5201003001006", cat:"Snacks & Confectionery", price:"2.99", cost:"1.60", vat:"19", stock:80,  unit:"bag",   pack:1 },
  // Bakery
  { name:"White Sliced Bread 800g",sku:"BREA001", barcode:"5201004001001", cat:"Bakery",                 price:"1.10", cost:"0.50", vat:"5",  stock:100, unit:"loaf",  pack:1 },
  { name:"Wholemeal Bread 800g",   sku:"BREA002", barcode:"5201004001002", cat:"Bakery",                 price:"1.30", cost:"0.60", vat:"5",  stock:80,  unit:"loaf",  pack:1 },
  { name:"Croissants 4pk",         sku:"CROI001", barcode:"5201004001003", cat:"Bakery",                 price:"2.50", cost:"1.20", vat:"5",  stock:50,  unit:"pack",  pack:4 },
  { name:"Pitta Bread 6pk",        sku:"PITA001", barcode:"5201004001004", cat:"Bakery",                 price:"1.20", cost:"0.55", vat:"5",  stock:60,  unit:"pack",  pack:6 },
  // Fresh Produce
  { name:"Tomatoes 1kg",           sku:"TOMA001", barcode:"5201005001001", cat:"Fresh Produce",          price:"1.50", cost:"0.70", vat:"5",  stock:150, unit:"kg",    pack:1 },
  { name:"Bananas 1kg",            sku:"BANA001", barcode:"5201005001002", cat:"Fresh Produce",          price:"0.99", cost:"0.45", vat:"5",  stock:120, unit:"kg",    pack:1 },
  { name:"Apples Gala 1kg",        sku:"APPL001", barcode:"5201005001003", cat:"Fresh Produce",          price:"1.80", cost:"0.85", vat:"5",  stock:100, unit:"kg",    pack:1 },
  { name:"Cucumber each",          sku:"CUCU001", barcode:"5201005001004", cat:"Fresh Produce",          price:"0.45", cost:"0.20", vat:"5",  stock:80,  unit:"each",  pack:1 },
  { name:"Iceberg Lettuce each",   sku:"LETT001", barcode:"5201005001005", cat:"Fresh Produce",          price:"0.75", cost:"0.35", vat:"5",  stock:60,  unit:"each",  pack:1 },
  // Frozen
  { name:"Frozen Garden Peas 1kg", sku:"PEAS001", barcode:"5201006001001", cat:"Frozen Foods",           price:"1.50", cost:"0.70", vat:"19", stock:80,  unit:"bag",   pack:1 },
  { name:"Ice Cream Vanilla 500ml",sku:"ICEC001", barcode:"5201006001002", cat:"Frozen Foods",           price:"2.20", cost:"1.10", vat:"19", stock:50,  unit:"tub",   pack:1 },
  { name:"Frozen Margherita Pizza",sku:"PIZZ001", barcode:"5201006001003", cat:"Frozen Foods",           price:"3.50", cost:"1.80", vat:"19", stock:60,  unit:"each",  pack:1 },
  { name:"Frozen Chips 1kg",       sku:"CHIP001", barcode:"5201006001004", cat:"Frozen Foods",           price:"1.80", cost:"0.85", vat:"19", stock:70,  unit:"bag",   pack:1 },
  // Household
  { name:"Dish Soap Lemon 500ml",  sku:"DISH001", barcode:"5201007001001", cat:"Household & Cleaning",   price:"1.20", cost:"0.55", vat:"19", stock:100, unit:"bottle",pack:1 },
  { name:"Laundry Powder 1kg",     sku:"LAUN001", barcode:"5201007001002", cat:"Household & Cleaning",   price:"4.50", cost:"2.20", vat:"19", stock:60,  unit:"box",   pack:1 },
  { name:"Toilet Rolls 6pk",       sku:"TOIL001", barcode:"5201007001003", cat:"Household & Cleaning",   price:"3.50", cost:"1.80", vat:"19", stock:80,  unit:"pack",  pack:6 },
  { name:"Kitchen Roll 2pk",       sku:"KTCH001", barcode:"5201007001004", cat:"Household & Cleaning",   price:"1.80", cost:"0.90", vat:"19", stock:70,  unit:"pack",  pack:2 },
  // Meat & Fish
  { name:"Chicken Breast 500g",    sku:"CHKN001", barcode:"5201008001001", cat:"Meat & Fish",            price:"4.50", cost:"2.50", vat:"5",  stock:60,  unit:"pack",  pack:1 },
  { name:"Beef Mince 500g",        sku:"BEEF001", barcode:"5201008001002", cat:"Meat & Fish",            price:"5.50", cost:"3.00", vat:"5",  stock:40,  unit:"pack",  pack:1 },
  { name:"Pork Sausages 400g",     sku:"PORK001", barcode:"5201008001003", cat:"Meat & Fish",            price:"2.80", cost:"1.40", vat:"5",  stock:50,  unit:"pack",  pack:1 },
  { name:"Salmon Fillet 300g",     sku:"SALM001", barcode:"5201008001004", cat:"Meat & Fish",            price:"6.50", cost:"3.80", vat:"5",  stock:30,  unit:"pack",  pack:1 },
  // Beer, Wine & Spirits
  { name:"Lager Beer 500ml",       sku:"BEER001", barcode:"5201009001001", cat:"Beer, Wine & Spirits",   price:"1.50", cost:"0.70", vat:"19", stock:200, unit:"can",   pack:1 },
  { name:"Red Wine 750ml",         sku:"WINE001", barcode:"5201009001002", cat:"Beer, Wine & Spirits",   price:"7.50", cost:"3.80", vat:"19", stock:60,  unit:"bottle",pack:1 },
  { name:"White Wine 750ml",       sku:"WINE002", barcode:"5201009001003", cat:"Beer, Wine & Spirits",   price:"6.50", cost:"3.20", vat:"19", stock:60,  unit:"bottle",pack:1 },
  { name:"Vodka 700ml",            sku:"VODKA01", barcode:"5201009001004", cat:"Beer, Wine & Spirits",   price:"12.50",cost:"6.00", vat:"19", stock:40,  unit:"bottle",pack:1 },
  // Tobacco
  { name:"Cigarettes King Size 20s",sku:"CIGS001",barcode:"5201010001001", cat:"Tobacco",                price:"4.20", cost:"3.00", vat:"19", stock:100, unit:"pack",  pack:20 },
  { name:"Rolling Tobacco 50g",    sku:"RTOB001", barcode:"5201010001002", cat:"Tobacco",                price:"9.50", cost:"6.50", vat:"19", stock:40,  unit:"pouch", pack:1 },
];

const itemIds = {};
for (const p of PRODUCTS) {
  const catId = catIds[p.cat];
  if (!catId) { log(`Product: ${p.name}`, false, `Category '${p.cat}' not found`); continue; }
  const { status, data } = await api("POST", "/api/items", {
    name: p.name, sku: p.sku, barcode: p.barcode,
    categoryId: catId,
    price1: p.price, price2: p.price, price3: p.price, price4: p.price, price5: p.price,
    costPrice: p.cost,
    vatRate: p.vat,
    stockQuantity: p.stock,
    unitType: p.unit, packSize: p.pack,
    reorderLevel: 20,
    active: true, description: "",
  });
  if (status === 200 || status === 201) {
    itemIds[p.sku] = data.id;
    log(`Product: ${p.name}`, true);
  } else {
    // May already exist
    const { data: all } = await api("GET", "/api/items");
    const found = all?.find?.(i => i.sku === p.sku);
    if (found) { itemIds[p.sku] = found.id; log(`Product: ${p.name} (existing)`, true); }
    else log(`Product: ${p.name}`, false, JSON.stringify(data).slice(0, 80));
  }
}

// ── 3. POS Location ───────────────────────────────────────────────────────────
console.log("\n══ 3. POS LOCATION ══");

let locationId;
{
  const { status, data } = await api("POST", "/api/pos/locations", {
    name: "Fresh Market Supermarket", code: "MKTMAIN",
    address: "123 Market Street, Limassol, Cyprus",
    phone: "+357 25 123456",
    timezone: "Europe/Nicosia", currencyCode: "EUR", active: true,
  });
  if (status === 200 || status === 201) {
    locationId = data.id;
    log("Location: Fresh Market Supermarket", true, `id=${locationId}`);
  } else {
    const { data: all } = await api("GET", "/api/pos/locations");
    const found = all?.find?.(l => l.code === "MKTMAIN");
    if (found) { locationId = found.id; log("Location: Fresh Market (existing)", true); }
    else { log("Location: Fresh Market Supermarket", false, JSON.stringify(data)); }
  }
}

// ── 4. POS Terminal ───────────────────────────────────────────────────────────
console.log("\n══ 4. POS TERMINAL ══");

let terminalId;
{
  const { status, data } = await api("POST", "/api/pos/terminals", {
    name: "Checkout 1", code: "T001",
    locationId, description: "Main checkout lane",
    hardwareType: "desktop", active: true,
  });
  if (status === 200 || status === 201) {
    terminalId = data.id;
    log("Terminal: T001 — Checkout 1", true, `id=${terminalId}`);
  } else {
    const { data: all } = await api("GET", "/api/pos/terminals");
    const found = all?.find?.(t => t.code === "T001");
    if (found) { terminalId = found.id; log("Terminal: T001 (existing)", true); }
    else { log("Terminal: T001 — Checkout 1", false, JSON.stringify(data)); }
  }
}

// ── 5. POS Layout ─────────────────────────────────────────────────────────────
console.log("\n══ 5. POS LAYOUT ══");

let layoutSetId;
{
  const { status, data } = await api("POST", "/api/pos/layouts", {
    name: "Supermarket Standard", description: "4-column supermarket layout",
    locationId, columns: 4, active: true,
  });
  if (status === 200 || status === 201) {
    layoutSetId = data.id;
    log("Layout Set: Supermarket Standard", true);
  } else {
    const { data: all } = await api("GET", "/api/pos/layouts");
    const found = all?.find?.(l => l.name === "Supermarket Standard");
    if (found) { layoutSetId = found.id; log("Layout Set: Supermarket Standard (existing)", true); }
    else { log("Layout Set: Supermarket Standard", false, JSON.stringify(data)); }
  }
}

// Assign layout to terminal
if (terminalId && layoutSetId) {
  await api("PUT", `/api/pos/terminals/${terminalId}`, { layoutSetId });
  log("Layout assigned to terminal T001", true);
}

// Build buttons — 4 columns, rows of categories then hot products
const COLORS = {
  "Dairy & Eggs": "#3b82f6",           // blue
  "Beverages": "#06b6d4",              // cyan
  "Snacks & Confectionery": "#f59e0b", // amber
  "Bakery": "#92400e",                 // brown
  "Fresh Produce": "#22c55e",          // green
  "Frozen Foods": "#818cf8",           // indigo
  "Household & Cleaning": "#6b7280",   // gray
  "Meat & Fish": "#ef4444",            // red
  "Beer, Wine & Spirits": "#7c3aed",   // purple
  "Tobacco": "#374151",                // dark
};

const buttons = [];
let pos = 0;

// Row 1-3: category buttons
for (const cat of CATS) {
  if (!catIds[cat.name]) continue;
  buttons.push({
    layoutSetId, position: pos++,
    label: cat.name.split(" ")[0], // short label
    color: COLORS[cat.name] || "#6b7280",
    buttonType: "category",
    categoryId: catIds[cat.name],
    icon: null, itemId: null, actionCode: null,
  });
}

// Pad to next row boundary (4 columns)
while (pos % 4 !== 0) {
  buttons.push({ layoutSetId, position: pos++, label: "", color: "#1f2937", buttonType: "empty", icon: null, itemId: null, categoryId: null, actionCode: null });
}

// Row 4: fast-access action buttons
const ACTIONS = [
  { label: "Pay Cash",    color: "#16a34a", actionCode: "PAY_CASH" },
  { label: "Pay Card",    color: "#2563eb", actionCode: "PAY_CARD" },
  { label: "Discount %",  color: "#d97706", actionCode: "ORDER_DISCOUNT_PCT" },
  { label: "Void Line",   color: "#dc2626", actionCode: "VOID_LINE" },
];
for (const a of ACTIONS) {
  buttons.push({ layoutSetId, position: pos++, label: a.label, color: a.color, buttonType: "action", actionCode: a.actionCode, icon: null, itemId: null, categoryId: null });
}

// Row 5-7: hot products
const HOT_SKUS = [
  "MILK001","EGGS001","BREA001","WATR001","COLA001",
  "CRIS001","CHOC001","BEER001","WINE001","CHKN001",
  "TOMA001","BANA001",
];
for (const sku of HOT_SKUS) {
  const itemId = itemIds[sku];
  if (!itemId) continue;
  const prod = PRODUCTS.find(p => p.sku === sku);
  buttons.push({
    layoutSetId, position: pos++,
    label: prod?.name.split(" ").slice(0, 2).join(" ") || sku,
    color: "#374151", buttonType: "item",
    itemId, icon: null, categoryId: null, actionCode: null,
  });
}

if (layoutSetId) {
  // Upsert all buttons via the layout API
  const { status, data } = await api("PUT", `/api/pos/layouts/${layoutSetId}/buttons`, { buttons });
  if (status === 200 || status === 201) log(`Layout buttons: ${buttons.length} created`, true);
  else {
    // Try individual upserts
    let btnOk = 0;
    for (const btn of buttons) {
      const r = await api("POST", `/api/pos/layouts/${layoutSetId}/buttons`, btn);
      if (r.status === 200 || r.status === 201) btnOk++;
    }
    log(`Layout buttons: ${btnOk}/${buttons.length} created`, btnOk > 0);
  }
}

// ── 6. Cashiers ───────────────────────────────────────────────────────────────
console.log("\n══ 6. CASHIERS ══");

const CASHIERS = [
  { name: "Maria Georgiou",  pin: "1234", role: "manager",    locationId },
  { name: "Yiannis Petrou",  pin: "2222", role: "supervisor", locationId },
  { name: "Andreas Nicolaou",pin: "3333", role: "cashier",    locationId },
  { name: "Eleni Stavrou",   pin: "4444", role: "cashier",    locationId },
];

for (const c of CASHIERS) {
  const { status, data } = await api("POST", "/api/pos/cashiers", c);
  if (status === 200 || status === 201) log(`Cashier: ${c.name} (PIN: ${c.pin}, role: ${c.role})`, true);
  else {
    const { data: all } = await api("GET", "/api/pos/cashiers");
    const found = all?.find?.(x => x.name === c.name);
    if (found) log(`Cashier: ${c.name} (existing)`, true);
    else log(`Cashier: ${c.name}`, false, JSON.stringify(data));
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`
══════════════════════════════════════════════
  SUPERMARKET TEST SEED — COMPLETE
  ✅ Passed: ${ok}   ❌ Failed: ${fail}
══════════════════════════════════════════════

  TERMINAL SETUP (enter these in the Tauri app):
  ─────────────────────────────────────────────
  Server URL : http://<YOUR_SERVER_IP>:5000
  Terminal Code: T001

  CASHIER PINs:
  ─────────────────────────────────────────────
  Maria Georgiou   (Manager)    PIN: 1234
  Yiannis Petrou   (Supervisor) PIN: 2222
  Andreas Nicolaou (Cashier)    PIN: 3333
  Eleni Stavrou    (Cashier)    PIN: 4444
══════════════════════════════════════════════
`);
