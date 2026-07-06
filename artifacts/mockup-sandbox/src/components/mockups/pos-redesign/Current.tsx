import { useState } from "react";
import "./_group.css";

// ── Mock data (mirrors pos-app product/category/order shapes) ───────────────

const CATEGORIES = [
  { id: "wine-red", name: "Red Wine", color: "#7c2d44" },
  { id: "wine-white", name: "White Wine", color: "#a16207" },
  { id: "spirits", name: "Spirits", color: "#1e3a5f" },
  { id: "beer", name: "Beer", color: "#92400e" },
  { id: "soft", name: "Soft Drinks", color: "#0f766e" },
  { id: "snacks", name: "Snacks", color: "#4d7c0f" },
];

type Product = { id: string; name: string; price: number; color: string };

const PRODUCTS: Product[] = [
  { id: "p1", name: "Château Margaux 2018", price: 89.9, color: "#7c2d44" },
  { id: "p2", name: "Malbec Reserve 750ml", price: 14.5, color: "#7c2d44" },
  { id: "p3", name: "Chianti Classico", price: 18.2, color: "#7c2d44" },
  { id: "p4", name: "Sauvignon Blanc", price: 12.9, color: "#a16207" },
  { id: "p5", name: "Chardonnay Reserve", price: 16.4, color: "#a16207" },
  { id: "p6", name: "Grey Goose Vodka 1L", price: 32.0, color: "#1e3a5f" },
  { id: "p7", name: "Hendrick's Gin 700ml", price: 28.5, color: "#1e3a5f" },
  { id: "p8", name: "Jameson Whiskey 700ml", price: 24.0, color: "#1e3a5f" },
  { id: "p9", name: "Keo Lager 330ml", price: 1.8, color: "#92400e" },
  { id: "p10", name: "Heineken 6-Pack", price: 7.9, color: "#92400e" },
  { id: "p11", name: "Coca-Cola 1.5L", price: 2.2, color: "#0f766e" },
  { id: "p12", name: "Sparkling Water 500ml", price: 1.1, color: "#0f766e" },
  { id: "p13", name: "Mixed Nuts 200g", price: 3.5, color: "#4d7c0f" },
  { id: "p14", name: "Olives Jar 350g", price: 4.2, color: "#4d7c0f" },
];

type OrderLine = { id: string; name: string; qty: number; price: number; note?: string };

const INITIAL_LINES: OrderLine[] = [
  { id: "l1", name: "Château Margaux 2018", qty: 1, price: 89.9 },
  { id: "l2", name: "Grey Goose Vodka 1L", qty: 2, price: 32.0 },
  { id: "l3", name: "Sparkling Water 500ml", qty: 6, price: 1.1, note: "For the table" },
];

const money = (n: number) => `€${n.toFixed(2)}`;

const ACTIONS = [
  { label: "Hold", color: "text-gray-400" },
  { label: "Recall", color: "text-gray-400" },
  { label: "Void Order", color: "text-red-400" },
  { label: "Repeat", color: "text-gray-400" },
  { label: "Line Note", color: "text-gray-400" },
  { label: "Order Note", color: "text-gray-400" },
  { label: "Line %", color: "text-gray-400" },
  { label: "Order %", color: "text-gray-400" },
  { label: "Promo Code", color: "text-gray-400" },
  { label: "Refund", color: "text-amber-400" },
  { label: "Shift", color: "text-gray-400" },
];

export default function Current() {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [lines, setLines] = useState(INITIAL_LINES);
  const [selectedLine, setSelectedLine] = useState<string | null>("l1");

  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const vat = subtotal * 0.19;
  const total = subtotal + vat;

  function addQty(id: string, delta: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  }
  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
  }

  return (
    <div className="pos-mockup-root min-h-screen w-full flex flex-col bg-gray-950 overflow-hidden" style={{ height: "100vh" }}>
      {/* Sync header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <span className="text-gray-500 text-xs">Terminal 01 · Christoforos</span>
        <span className="text-green-500 text-xs flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Synced
        </span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: categories + grid */}
        <div className="flex flex-col flex-1 min-h-0">
          {/* Category nav */}
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-gray-800 flex-shrink-0">
            <button
              onClick={() => setSelectedCat(null)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${
                selectedCat === null
                  ? "bg-burgundy-700 text-white border-burgundy-600 shadow-md"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700 border-gray-700"
              }`}
            >
              All
            </button>
            {CATEGORIES.map((c) => {
              const active = selectedCat === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCat(active ? null : c.id)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all"
                  style={{
                    backgroundColor: active ? c.color : c.color + "33",
                    borderColor: c.color,
                    color: active ? "#fff" : c.color,
                  }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>

          {/* Product grid */}
          <div className="flex-1 grid grid-cols-5 grid-rows-4 gap-1.5 p-2 overflow-hidden">
            {PRODUCTS.map((p) => (
              <button
                key={p.id}
                style={{ backgroundColor: p.color }}
                className="rounded-xl p-2 text-left flex flex-col justify-between transition-all hover:brightness-110 active:scale-95 min-h-0 overflow-hidden"
              >
                <span className="text-white text-xs font-semibold leading-tight pos-line-clamp-3 flex-1">
                  {p.name}
                </span>
                <span className="text-white/75 text-xs mt-1 font-medium">{money(p.price)}</span>
              </button>
            ))}
          </div>

          {/* Action bar */}
          <div className="border-t border-gray-800 bg-gray-900 px-3 py-2 flex items-center gap-1.5 overflow-x-auto flex-shrink-0">
            {ACTIONS.map((a) => (
              <button
                key={a.label}
                className={`flex-shrink-0 flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-800 ${a.color}`}
              >
                <div className="w-4 h-4 rounded-sm bg-current opacity-40" />
                <span className="whitespace-nowrap">{a.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Order ticket */}
        <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 w-80 min-w-[300px] flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-800 flex items-center justify-between">
            <div>
              <span className="text-gray-400 text-xs">Order</span>
              <span className="text-gray-500 text-xs ml-1">#00184</span>
            </div>
            <button className="text-gray-600 hover:text-red-400 text-xs">Clear</button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0divide-y divide-gray-800">
            {lines.map((line) => {
              const isSelected = line.id === selectedLine;
              return (
                <div
                  key={line.id}
                  onClick={() => setSelectedLine(line.id)}
                  className={`px-3 py-2.5 cursor-pointer border-b border-gray-800 ${
                    isSelected ? "bg-burgundy-900/40 border-l-2 border-burgundy-500" : "hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-white text-sm font-medium leading-tight flex-1 truncate">{line.name}</span>
                    <span className="text-white text-sm font-semibold flex-shrink-0">{money(line.qty * line.price)}</span>
                  </div>
                  {line.note && <div className="text-amber-400 text-xs mb-1.5">📝 {line.note}</div>}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); addQty(line.id, -1); }}
                        className="w-6 h-6 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center"
                      >
                        <span className="text-gray-300 text-xs">−</span>
                      </button>
                      <span className="text-gray-300 text-xs font-semibold w-6 text-center">{line.qty}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); addQty(line.id, 1); }}
                        className="w-6 h-6 rounded-full bg-green-800 hover:bg-green-700 flex items-center justify-center"
                      >
                        <span className="text-green-100 text-xs">+</span>
                      </button>
                      <span className="text-gray-600 text-xs ml-1">× {money(line.price)}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeLine(line.id); }}
                      className="w-6 h-6 rounded-full bg-gray-800 hover:bg-red-900 flex items-center justify-center"
                    >
                      <span className="text-gray-500 text-xs">🗑</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-gray-800 px-3 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500">
              <span>VAT</span>
              <span>{money(vat)}</span>
            </div>
            <div className="flex justify-between text-white font-bold text-lg border-t border-gray-800 pt-2 mt-2">
              <span>TOTAL</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <div className="px-3 pb-3">
            <button className="w-full bg-green-700 hover:bg-green-600 text-white font-bold py-3.5 rounded-xl text-lg active:scale-[0.98] flex items-center justify-center gap-2">
              PAY {money(total)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
