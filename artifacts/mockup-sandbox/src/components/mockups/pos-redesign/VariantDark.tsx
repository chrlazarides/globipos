import { useState } from "react";
import "./_group.css";

// Dark, multi-column POS with vivid category pills and photo-style item cards —
// inspired by the French "logiciel de caisse" reference.

const TOOLBAR = [
  { label: "Direct", color: "bg-sky-500" },
  { label: "Table", color: "bg-slate-700" },
  { label: "Held (2)", color: "bg-slate-700" },
  { label: "Sync", color: "bg-emerald-600" },
  { label: "Reset", color: "bg-slate-700" },
  { label: "Print", color: "bg-blue-600" },
  { label: "Correct", color: "bg-amber-500" },
  { label: "Close Shift", color: "bg-rose-600" },
];

const CATEGORIES = [
  { name: "All", color: "#0284c7" },
  { name: "Red Wine", color: "#be123c" },
  { name: "White Wine", color: "#ca8a04" },
  { name: "Rosé", color: "#db2777" },
  { name: "Spirits", color: "#0369a1" },
  { name: "Beer", color: "#c2410c" },
  { name: "Soft Drinks", color: "#0d9488" },
  { name: "Snacks", color: "#4d7c0f" },
  { name: "Cigars", color: "#7c2d12" },
  { name: "Gifts", color: "#7e22ce" },
];

type Product = { id: string; name: string; sub?: string; price: number; badge?: string; color: string };

const PRODUCTS: Product[] = [
  { id: "p1", name: "Château Margaux 2018", sub: "750ml", price: 89.9, color: "#7f1d1d" },
  { id: "p2", name: "Malbec Reserve", sub: "750ml", price: 14.5, badge: "-10%", color: "#991b1b" },
  { id: "p3", name: "Chianti Classico", sub: "750ml", price: 18.2, color: "#7f1d1d" },
  { id: "p4", name: "Sauvignon Blanc", sub: "750ml", price: 12.9, color: "#854d0e" },
  { id: "p5", name: "Chardonnay Reserve", sub: "750ml", price: 16.4, color: "#854d0e" },
  { id: "p6", name: "Grey Goose Vodka", sub: "1L", price: 32.0, color: "#075985" },
  { id: "p7", name: "Hendrick's Gin", sub: "700ml", price: 28.5, color: "#075985" },
  { id: "p8", name: "Jameson Whiskey", sub: "700ml", price: 24.0, badge: "-15%", color: "#0c4a6e" },
  { id: "p9", name: "Keo Lager", sub: "330ml", price: 1.8, color: "#9a3412" },
  { id: "p10", name: "Heineken 6-Pack", sub: "6x330ml", price: 7.9, color: "#9a3412" },
  { id: "p11", name: "Coca-Cola", sub: "1.5L", price: 2.2, color: "#115e59" },
  { id: "p12", name: "Sparkling Water", sub: "500ml", price: 1.1, color: "#115e59" },
  { id: "p13", name: "Mixed Nuts", sub: "200g", price: 3.5, color: "#3f6212" },
  { id: "p14", name: "Cuban Cigar", sub: "single", price: 22.0, color: "#78350f" },
  { id: "p15", name: "Gift Box Set", sub: "wine + glasses", price: 45.0, color: "#6b21a8" },
];

type CartLine = { id: string; name: string; sub?: string; qty: number; price: number; note?: string };

const INITIAL: CartLine[] = [
  { id: "l1", name: "Château Margaux 2018", sub: "750ml", qty: 1, price: 89.9 },
  { id: "l2", name: "Grey Goose Vodka", sub: "1L", qty: 2, price: 32.0, note: "Gift wrap" },
  { id: "l3", name: "Sparkling Water", sub: "500ml", qty: 6, price: 1.1 },
];

const money = (n: number) => `€${n.toFixed(2)}`;

export default function VariantDark() {
  const [cat, setCat] = useState("All");
  const [lines, setLines] = useState(INITIAL);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const vat = subtotal * 0.19;
  const total = subtotal + vat;

  function addQty(id: string, d: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  }
  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
  }

  return (
    <div className="pos-mockup-root min-h-screen w-full flex flex-col bg-[#0b0f19]" style={{ height: "100vh" }}>
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 flex-shrink-0 overflow-x-auto">
        <span className="text-white font-bold text-sm mr-1 flex-shrink-0">GlobiPOS</span>
        {TOOLBAR.map((t) => (
          <button key={t.label} className={`flex-shrink-0 ${t.color} text-white text-xs font-semibold px-3 py-1.5 rounded-lg active:scale-95 transition-transform`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <span className="text-white/40 text-xs">Christoforos · Terminal 01</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Cart panel */}
        <div className="w-[340px] flex-shrink-0 flex flex-col bg-[#10141f] border-r border-white/5">
          <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
            <span className="text-white font-bold text-sm">🛒 Cart</span>
            <span className="text-white/40 text-xs">{lines.length} items</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="bg-white/5 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold truncate">{l.name}</div>
                    {l.sub && <div className="text-white/40 text-[11px]">{l.sub} · {money(l.price)}</div>}
                  </div>
                  <button onClick={() => removeLine(l.id)} className="w-6 h-6 rounded-full bg-white/10 hover:bg-rose-600 flex items-center justify-center flex-shrink-0 text-white/60 text-xs">✕</button>
                </div>
                {l.note && (
                  <div className="text-amber-400 text-[11px] mt-1">📝 {l.note}</div>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => addQty(l.id, -1)} className="w-6 h-6 rounded-full bg-white/10 text-white text-xs">−</button>
                    <span className="text-white text-xs font-semibold w-5 text-center">{l.qty}</span>
                    <button onClick={() => addQty(l.id, 1)} className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs">+</button>
                  </div>
                  <span className="text-white text-sm font-bold">{money(l.qty * l.price)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-white/5 px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-xs text-white/40">
              <span>Subtotal (HT)</span><span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-white/40">
              <span>VAT</span><span>{money(vat)}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="text-white font-bold">Total (TTC)</span>
              <span className="text-emerald-400 text-2xl font-extrabold">{money(total)}</span>
            </div>
          </div>
          <div className="px-4 pb-3 grid grid-cols-3 gap-2">
            <button className="bg-white/10 text-white text-xs font-semibold rounded-lg py-2.5">Client</button>
            <button className="bg-pink-600 text-white text-xs font-semibold rounded-lg py-2.5">Discount</button>
            <button className="bg-sky-600 text-white text-xs font-semibold rounded-lg py-2.5">Card</button>
          </div>
          <div className="px-4 pb-4">
            <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-[#0b0f19] font-extrabold rounded-xl py-3.5 text-base active:scale-[0.98] transition-transform">
              Validate · {money(total)}
            </button>
          </div>
        </div>

        {/* Categories + grid */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="px-3 py-2.5 flex items-center gap-3 border-b border-white/5">
            <div className="flex-1 flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2">
              <span className="text-white/30">🔍</span>
              <span className="text-white/30 text-sm">Search a product…</span>
            </div>
          </div>
          <div className="px-3 py-2.5 flex flex-wrap gap-2 border-b border-white/5">
            {CATEGORIES.map((c) => {
              const active = cat === c.name;
              return (
                <button
                  key={c.name}
                  onClick={() => setCat(c.name)}
                  className="px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                  style={{ backgroundColor: active ? c.color : c.color + "22", color: active ? "#fff" : c.color, boxShadow: active ? "0 2px 10px rgba(0,0,0,0.35)" : "none" }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-5 gap-3">
              {PRODUCTS.map((p) => (
                <button key={p.id} className="relative flex flex-col rounded-xl overflow-hidden bg-white/5 hover:bg-white/10 transition-colors active:scale-95">
                  <div className="h-16 w-full flex items-center justify-center text-2xl" style={{ backgroundColor: p.color }}>
                    🍾
                  </div>
                  {p.badge && (
                    <span className="absolute top-1.5 left-1.5 bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">{p.badge}</span>
                  )}
                  <div className="px-2.5 py-2 text-left">
                    <div className="text-white text-xs font-semibold pos-line-clamp-2 leading-tight">{p.name}</div>
                    {p.sub && <div className="text-white/30 text-[10px] mb-1">{p.sub}</div>}
                    <div className="text-emerald-400 text-sm font-bold">{money(p.price)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
