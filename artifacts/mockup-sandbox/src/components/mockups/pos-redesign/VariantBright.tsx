import { useState } from "react";
import "./_group.css";

// Bright, tablet-style retail POS — inspired by grocery/tablet POS references.
// Light card-based UI, item table on the left, category-tabbed image grid on the right,
// colorful numpad + function keys along the bottom-left.

const CATEGORIES = ["All", "Red Wine", "White Wine", "Spirits", "Beer", "Soft Drinks"];

type Product = { id: string; name: string; unit: string; price: number; emoji: string; grad: string };

const PRODUCTS: Product[] = [
  { id: "p1", name: "Château Margaux", unit: "750ml", price: 89.9, emoji: "🍷", grad: "from-rose-200 to-rose-400" },
  { id: "p2", name: "Malbec Reserve", unit: "750ml", price: 14.5, emoji: "🍷", grad: "from-rose-200 to-rose-400" },
  { id: "p3", name: "Chianti Classico", unit: "750ml", price: 18.2, emoji: "🍷", grad: "from-rose-200 to-rose-400" },
  { id: "p4", name: "Sauvignon Blanc", unit: "750ml", price: 12.9, emoji: "🥂", grad: "from-amber-100 to-amber-300" },
  { id: "p5", name: "Chardonnay Reserve", unit: "750ml", price: 16.4, emoji: "🥂", grad: "from-amber-100 to-amber-300" },
  { id: "p6", name: "Grey Goose Vodka", unit: "1L", price: 32.0, emoji: "🍸", grad: "from-sky-100 to-sky-300" },
  { id: "p7", name: "Hendrick's Gin", unit: "700ml", price: 28.5, emoji: "🍸", grad: "from-sky-100 to-sky-300" },
  { id: "p8", name: "Jameson Whiskey", unit: "700ml", price: 24.0, emoji: "🥃", grad: "from-orange-100 to-orange-300" },
  { id: "p9", name: "Keo Lager", unit: "330ml", price: 1.8, emoji: "🍺", grad: "from-yellow-100 to-yellow-300" },
  { id: "p10", name: "Heineken 6-Pack", unit: "6x330ml", price: 7.9, emoji: "🍺", grad: "from-yellow-100 to-yellow-300" },
  { id: "p11", name: "Coca-Cola", unit: "1.5L", price: 2.2, emoji: "🥤", grad: "from-red-100 to-red-300" },
  { id: "p12", name: "Sparkling Water", unit: "500ml", price: 1.1, emoji: "💧", grad: "from-cyan-100 to-cyan-300" },
];

type CartLine = { id: string; name: string; unit: string; qty: number; price: number };

const INITIAL: CartLine[] = [
  { id: "l1", name: "Château Margaux", unit: "750ml", qty: 1, price: 89.9 },
  { id: "l2", name: "Grey Goose Vodka", unit: "1L", qty: 2, price: 32.0 },
  { id: "l3", name: "Sparkling Water", unit: "500ml", qty: 6, price: 1.1 },
];

const money = (n: number) => `€${n.toFixed(2)}`;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "00"];

const FUNCTION_KEYS = [
  { label: "Customer", className: "bg-fuchsia-500" },
  { label: "Promo", className: "bg-pink-400" },
  { label: "Delete Item", className: "bg-rose-400" },
  { label: "Discount", className: "bg-indigo-500" },
  { label: "Settings", className: "bg-slate-400" },
  { label: "Suspend", className: "bg-sky-500" },
];

export default function VariantBright() {
  const [cat, setCat] = useState("All");
  const [lines, setLines] = useState(INITIAL);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = subtotal * 0.19;
  const total = subtotal + tax;

  function addQty(id: string, d: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  }

  return (
    <div className="pos-mockup-root min-h-screen w-full flex bg-slate-200 p-3 gap-3" style={{ height: "100vh" }}>
      {/* Left: ticket + numpad */}
      <div className="flex flex-col w-[420px] flex-shrink-0 gap-3">
        <div className="bg-white rounded-2xl shadow-sm flex-1 flex flex-col overflow-hidden">
          <div className="grid grid-cols-[1fr_60px_40px_60px] gap-2 px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
            <span>Item</span>
            <span className="text-right">Price</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Total</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {lines.map((l) => (
              <div key={l.id} className="grid grid-cols-[1fr_60px_40px_60px] gap-2 px-4 py-2.5 items-center hover:bg-slate-50">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{l.name}</div>
                  <div className="text-[11px] text-slate-400">{l.unit}</div>
                </div>
                <span className="text-right text-sm text-slate-600">{money(l.price)}</span>
                <div className="flex items-center justify-center gap-1">
                  <button onClick={() => addQty(l.id, -1)} className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs">−</button>
                  <span className="text-sm font-semibold text-slate-800 w-4 text-center">{l.qty}</span>
                  <button onClick={() => addQty(l.id, 1)} className="w-5 h-5 rounded-full bg-emerald-500 text-white text-xs">+</button>
                </div>
                <span className="text-right text-sm font-bold text-slate-900">{money(l.qty * l.price)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 px-4 py-3 space-y-1.5 bg-slate-50">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Subtotal</span><span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Tax (19%)</span><span>{money(tax)}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className="text-sm font-bold text-slate-700">Total</span>
              <span className="text-2xl font-extrabold text-emerald-600">{money(total)}</span>
            </div>
          </div>
        </div>

        {/* Function keys + numpad */}
        <div className="bg-white rounded-2xl shadow-sm p-3 grid grid-cols-4 gap-2">
          {FUNCTION_KEYS.map((f) => (
            <button key={f.label} className={`col-span-1 ${f.className} text-white text-xs font-bold rounded-xl py-3 active:scale-95 transition-transform`}>
              {f.label}
            </button>
          ))}
          {KEYS.map((k) => (
            <button key={k} className="col-span-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-lg font-bold rounded-xl py-3 active:scale-95 transition-transform">
              {k}
            </button>
          ))}
          <button className="col-span-2 bg-amber-400 text-white text-sm font-bold rounded-xl py-3 active:scale-95 transition-transform">Hold</button>
          <button className="col-span-2 bg-emerald-500 text-white text-sm font-bold rounded-xl py-3 active:scale-95 transition-transform">Charge {money(total)}</button>
        </div>
      </div>

      {/* Right: search + categories + product grid */}
      <div className="flex flex-col flex-1 min-w-0 gap-3">
        <div className="bg-white rounded-2xl shadow-sm px-4 py-3 flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
            <span className="text-slate-400">🔍</span>
            <span className="text-slate-400 text-sm">Search product or scan barcode…</span>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Cashier</div>
            <div className="text-sm font-semibold text-slate-700">Christoforos</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm px-3 py-2.5 flex gap-2 overflow-x-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                cat === c ? "bg-sky-500 text-white shadow" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm flex-1 p-3 overflow-hidden">
          <div className="grid grid-cols-4 gap-3 h-full overflow-y-auto content-start">
            {PRODUCTS.map((p) => (
              <button key={p.id} className="flex flex-col rounded-xl overflow-hidden border border-slate-100 hover:shadow-md transition-shadow bg-white active:scale-95">
                <div className={`h-20 w-full bg-gradient-to-br ${p.grad} flex items-center justify-center text-3xl`}>
                  {p.emoji}
                </div>
                <div className="px-2.5 py-2 text-left">
                  <div className="text-xs font-semibold text-slate-800 pos-line-clamp-2 leading-tight">{p.name}</div>
                  <div className="text-[10px] text-slate-400 mb-1">{p.unit}</div>
                  <div className="text-sm font-bold text-emerald-600">{money(p.price)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
