import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { LayoutGrid } from "../src/components/LayoutGrid";
import { CorrectionsPanel } from "../src/components/CorrectionsPanel";
import { Numpad } from "../src/components/Numpad";
import { OrderTicket } from "../src/components/OrderTicket";
import { categoryBranchIds, departmentButtonAction, isWeighedProduct, scaleQuantity } from "../src/lib/departmentEntry";
import { computeLineAmounts, computeOrderTotals, createDepartmentLine, getPriceForLevel } from "../src/lib/pricing";
import type { Category, LayoutButton, NumpadMode, Order, OrderLine, Product } from "../src/types";
import { overrideReading } from "./scale-native-bridge.fixture";
import { useHardware } from "../src/hooks/useHardware";
import HardwareConfigPage from "../src/pages/HardwareConfigPage";
import ScaleBar from "../src/components/ScaleBar";

// Isolated component-test data. No terminal pairing, real payments, or real hardware.
const categories: Category[] = [
  { id: "fruit", server_id: "fruit", name: "Fruits", vat_rate: 5, active: true },
  { id: "veg", server_id: "veg", name: "Vegetables", vat_rate: 5, active: true },
  { id: "bread", server_id: "bread", name: "Bakery", vat_rate: 19, active: true },
  { id: "ice-bags", server_id: "ice-bags", name: "Ice / Bags", vat_rate: 19, active: true },
  { id: "citrus", server_id: "citrus", name: "Citrus", parent_id: "fruit", vat_rate: 5, active: true },
];
const names = ["Bananas", "Apples", "Oranges", "Pears", "Peaches", "Grapes"];
const products: Product[] = Array.from({ length: 280 }, (_, i) => ({
  id: `local-${i}`, server_id: `item-${i}`, name: `${names[i % names.length]} ${i || ""}`.trim(),
  sku: i === 0 ? "4011" : `PLU-${String(i).padStart(3, "0")}`, category_id: i === 279 ? "veg" : i === 278 ? "citrus" : "fruit",
  price1: 2.99, price2: 3.49, price3: 0, price4: 4, price5: 5, cost_price: 1,
  vat_rate: 5, unit_type: i === 0 ? "kg" : "pcs", pack_size: 1, stock_quantity: 100, active: true,
  image_url: i === 1 ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQXcAAAAASUVORK5CYII=" : null,
}));
for (const [index, name] of ["Croissants", "French Baguette", "Donuts", "Paper Bag", "Plastic Bag", "Ice Bag"].entries()) {
  products.push({ ...products[1], id: `extra-${index}`, server_id: `extra-${index}`,
    name, sku: `500${index}`, category_id: index < 3 ? "bread" : "ice-bags" });
}
const buttons: LayoutButton[] = categories.slice(0, 4).map((c, i) => ({
  position: i, label: c.name, color: "#15803d", button_type: "category", category_id: c.id,
}));
buttons.push({ position: 25, label: "Refund", color: "#9333ea", button_type: "action", action_code: "REFUND" });
buttons.push({ position: 26, label: "Shift report", color: "#0369a1", button_type: "action", action_code: "REPORT_X" });

function Fixture() {
  const fresh = new URLSearchParams(location.search).has("fresh");
  const hw = useHardware();
  const [settings, setSettings] = useState(new URLSearchParams(location.search).has("settings"));
  const held = useRef<OrderLine[] | null>(null);
  const [category, setCategory] = useState<string | null>("fruit");
  const [fastKeys, setFastKeys] = useState(true);
  const [plu, setPlu] = useState("");
  const [digits, setDigits] = useState("");
  const digitsRef = useRef("");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [cols, setCols] = useState(fresh ? 3 : 6);
  const [showControls, setShowControls] = useState(!fresh);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<NumpadMode | null>(null);
  const [confirmed, setConfirmed] = useState<number | null>(null);
  const sequence = useRef(0);
  const actions = useRef<string[]>([]);
  function entry(value: string) { digitsRef.current = value; setDigits(value); }
  function choose(id: string | null) {
    if (!id) { entry(""); setCategory(null); setPage(0); setFastKeys(false); setPlu(""); return true; }
    try {
      const action = departmentButtonAction(id, digitsRef.current, categories);
      if (action.type === "sale") {
        entry("");
        const line = createDepartmentLine(action.category, action.amount, "fixture", `dept-${++sequence.current}`);
        setLines(existing => [...existing, line]);
        setSelectedLineId(line.id);
        return false;
      }
      setCategory(action.category.server_id); setPage(0); setFastKeys(true); setPlu(""); return true;
    } catch (e) { setError(String(e)); return false; }
  }
  async function add(product: Product) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(product.server_id); setError("");
    try {
       const qty = isWeighedProduct(product) ? scaleQuantity(product, await hw.readWeight()) : 1;
      const partial: Omit<OrderLine, "line_total" | "vat_amount"> = {
        id: `item-line-${++sequence.current}`, order_id: "fixture", product_id: product.server_id,
        description: product.name, qty, unit_price: getPriceForLevel(product, 1),
        vat_rate: product.vat_rate, line_discount_pct: 0, line_discount_fixed: 0,
        line_surcharge_pct: 0, voided: false,
      };
      const amounts = computeLineAmounts(partial);
      const line = { ...partial, line_total: amounts.lineTotal, vat_amount: amounts.vatAmount };
      setLines(existing => [...existing, line]); setSelectedLineId(line.id);
    } catch (e) { setError(String(e)); }
    finally { busyRef.current = false; setBusy(null); }
  }
  const selected = lines.find(line => line.id === selectedLineId) ?? null;
  const totals = computeOrderTotals(lines, 0, 0);
  const order: Order = {
    id: "fixture", order_number: "TEST", status: "active", cashier_id: "test", cashier_name: "Test",
    price_level: 1, order_discount_pct: 0, order_discount_fixed: 0, surcharge_pct: 0,
    surcharge_amount: totals.surchargeAmount, subtotal: totals.subtotal, discount_amount: totals.discountAmount,
    vat_amount: totals.vatAmount, total: totals.total, created_at: "2026-10-04T12:00:00Z",
  };
  const branch = category ? categoryBranchIds(categories, category) : new Set<string>();
  const matching = products.filter(p => p.category_id && branch.has(p.category_id));
  (window as any).posFixture = {
    lines, digits, category, confirmed, error,
    setReading: overrideReading,
  };
  if (settings) return <HardwareConfigPage onClose={() => { void hw.loadConfig(); setSettings(false); }} />;
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc", color: "#0f172a" }}>
    <header style={{ padding: "8px 16px", borderBottom: "1px solid #cbd5e1" }}>
      <strong>{fresh ? "GlobiPOS · Fresh layout" : "GlobiPOS grocery component check"}</strong> · Test data only — no real transactions or scale
      {fresh && <button data-testid="fresh-controls" style={{ marginLeft: 12 }} onClick={() => setShowControls(value => !value)}>Keypad & functions</button>}
      <button style={{ marginLeft: 18 }} onClick={() => setModal("cash_in")}>Test money keypad</button>
      <button style={{ marginLeft: 12 }} onClick={() => setModal("qty")}>Test quantity keypad</button>
       <button style={{ marginLeft: 12 }} onClick={() => setSettings(true)}>Scale settings</button>
       <button style={{ marginLeft: 12 }} onClick={() => { held.current = structuredClone(lines); setLines([]); }}>Hold test order</button>
       <button style={{ marginLeft: 12 }} onClick={() => { if (held.current) setLines(structuredClone(held.current)); }}>Recall test order</button>
      {error && <span data-testid="fixture-error" style={{ color: "#b91c1c", marginLeft: 12 }}>{error}</span>}
    </header>
     <ScaleBar weight={hw.scaleWeight} error={hw.scaleError} onTare={hw.tare} simulated={hw.config?.scale_mode === "simulated"} />
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      <OrderTicket order={order} lines={lines} selectedLineId={selectedLineId} onSelectLine={setSelectedLineId}
        onAddQty={() => {}} onSubQty={() => {}} onRemoveLine={() => {}} onVoidLine={() => {}}
        onPay={() => {}} onClear={() => { setLines([]); setSelectedLineId(null); entry(""); }} theme="light" />
       {showControls && <CorrectionsPanel selectedLine={selected} hasLines={!!lines.length} theme="light"
        departmentEntry={digits} onDepartmentEntryChange={entry}
        onSetQty={() => {}} onSetPriceOverride={() => {}} onSetLineDiscountPct={() => {}}
        onRemoveLine={() => {}} onVoidLine={() => {}} onHold={() => {}} onRecall={() => {}}
        onRepeatLast={() => {}} onVoidOrder={() => {}} onLineNote={() => {}} onPromoCode={() => {}}
         onRemoveDiscount={() => {}} onDeptSale={() => {}} onPriceCheck={() => {}} />}
      <LayoutGrid buttons={buttons} products={category ? matching.slice(page * cols * 4, (page + 1) * cols * 4) : products}
        columns={fresh ? 3 : 6} rows={4} priceLevel={1} colorTheme={fresh ? "fresh" : "light"} categories={categories}
        selectedCategoryId={category} busyProductId={busy} groceryPage={page} groceryTotal={matching.length}
        fastKeysOpen={fastKeys} onOpenFastKeys={() => { setFastKeys(true); setCategory("fruit"); setPage(0); }}
        pluQuery={plu} onPluQueryChange={setPlu}
        pluProduct={products.find(product => product.sku === plu.trim()) ?? null}
        searchProducts={fresh && plu.trim() ? products.filter(product => product.name.toLowerCase().includes(plu.trim().toLowerCase())) : []}
        onGroceryPageChange={(p, c) => { setPage(p); setCols(c); }} onItemButton={add}
        onCategoryButton={choose} onActionButton={code => { actions.current.push(code); (window as any).posActions = actions.current; }}
        paymentsEnabled={lines.some(line => !line.voided && line.line_total > 0)} />
    </div>
    {modal && <Numpad mode={modal} theme="light" onClose={() => setModal(null)} onConfirm={setConfirmed} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);