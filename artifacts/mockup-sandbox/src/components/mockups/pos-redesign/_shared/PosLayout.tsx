import { useState } from "react";
import "../_group.css";

// Shared POS layout used by both VariantBright (light) and VariantDark (dark).
// Numpad + function keys sit to the RIGHT of the order journal (not below it),
// the journal scrolls independently, and tapping a line arms the numpad for
// quick corrections (qty / price / discount) on that specific line.

const CATEGORIES = ["All", "Red Wine", "White Wine", "Spirits", "Beer", "Soft Drinks"];

type Product = { id: string; name: string; unit: string; price: number; emoji: string; tone: Tone };
type Tone = "red" | "white" | "spirit" | "spirit2" | "beer" | "soft" | "water";

const PRODUCTS: Product[] = [
  { id: "p1", name: "Château Margaux", unit: "750ml", price: 89.9, emoji: "🍷", tone: "red" },
  { id: "p2", name: "Malbec Reserve", unit: "750ml", price: 14.5, emoji: "🍷", tone: "red" },
  { id: "p3", name: "Chianti Classico", unit: "750ml", price: 18.2, emoji: "🍷", tone: "red" },
  { id: "p4", name: "Sauvignon Blanc", unit: "750ml", price: 12.9, emoji: "🥂", tone: "white" },
  { id: "p5", name: "Chardonnay Reserve", unit: "750ml", price: 16.4, emoji: "🥂", tone: "white" },
  { id: "p6", name: "Grey Goose Vodka", unit: "1L", price: 32.0, emoji: "🍸", tone: "spirit" },
  { id: "p7", name: "Hendrick's Gin", unit: "700ml", price: 28.5, emoji: "🍸", tone: "spirit" },
  { id: "p8", name: "Jameson Whiskey", unit: "700ml", price: 24.0, emoji: "🥃", tone: "spirit2" },
  { id: "p9", name: "Keo Lager", unit: "330ml", price: 1.8, emoji: "🍺", tone: "beer" },
  { id: "p10", name: "Heineken 6-Pack", unit: "6x330ml", price: 7.9, emoji: "🍺", tone: "beer" },
  { id: "p11", name: "Coca-Cola", unit: "1.5L", price: 2.2, emoji: "🥤", tone: "soft" },
  { id: "p12", name: "Sparkling Water", unit: "500ml", price: 1.1, emoji: "💧", tone: "water" },
];

type CartLine = { id: string; name: string; unit: string; qty: number; price: number; discountPct?: number; note?: string };

const INITIAL: CartLine[] = [
  { id: "l1", name: "Château Margaux", unit: "750ml", qty: 1, price: 89.9 },
  { id: "l2", name: "Grey Goose Vodka", unit: "1L", qty: 2, price: 32.0 },
  { id: "l3", name: "Sparkling Water", unit: "500ml", qty: 6, price: 1.1, discountPct: 10 },
  { id: "l4", name: "Hendrick's Gin", unit: "700ml", qty: 1, price: 28.5 },
  { id: "l5", name: "Jameson Whiskey", unit: "700ml", qty: 2, price: 24.0, discountPct: 5 },
  { id: "l6", name: "Keo Lager", unit: "330ml", qty: 12, price: 1.8 },
  { id: "l7", name: "Malbec Reserve", unit: "750ml", qty: 3, price: 14.5 },
  { id: "l8", name: "Chardonnay Reserve", unit: "750ml", qty: 2, price: 16.4 },
  { id: "l9", name: "Coca-Cola", unit: "1.5L", qty: 4, price: 2.2 },
  { id: "l10", name: "Heineken 6-Pack", unit: "6x330ml", qty: 1, price: 7.9 },
];

const money = (n: number) => `€${n.toFixed(2)}`;

const NUMPAD_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"];

type NumMode = "qty" | "price" | "discount";

const FUNCTION_KEYS: { label: string; tone: string; icon: string }[] = [
  { label: "Customer", tone: "fuchsia", icon: "👤" },
  { label: "Promo", tone: "pink", icon: "🏷️" },
  { label: "Delete Item", tone: "rose", icon: "🗑️" },
  { label: "Discount", tone: "indigo", icon: "％" },
  { label: "Hold", tone: "amber", icon: "⏸️" },
  { label: "Suspend", tone: "sky", icon: "⏭️" },
  { label: "Void Order", tone: "red", icon: "⛔" },
  { label: "Settings", tone: "slate", icon: "⚙️" },
];

interface Palette {
  page: string;
  panel: string;
  panelHead: string;
  headerText: string;
  mutedText: string;
  faintText: string;
  divide: string;
  border: string;
  searchBg: string;
  searchText: string;
  catActive: string;
  catInactive: string;
  rowSelected: string;
  rowHover: string;
  cardBase: string;
  numKey: string;
  numKeyText: string;
  numDisplay: string;
  numDisplayText: string;
  toneMap: Record<Tone, string>;
  funcToneMap: Record<string, string>;
  totalAccent: string;
  chargeBtn: string;
  scrollHint: string;
}

const LIGHT: Palette = {
  page: "bg-slate-200",
  panel: "bg-white shadow-sm",
  panelHead: "text-slate-400",
  headerText: "text-slate-800",
  mutedText: "text-slate-500",
  faintText: "text-slate-400",
  divide: "divide-slate-100",
  border: "border-slate-100",
  searchBg: "bg-slate-100",
  searchText: "text-slate-400",
  catActive: "bg-sky-500 text-white shadow",
  catInactive: "bg-slate-100 text-slate-500 hover:bg-slate-200",
  rowSelected: "bg-sky-50 border-l-4 border-sky-400",
  rowHover: "hover:bg-slate-50 border-l-4 border-transparent",
  cardBase: "bg-white border border-slate-100 hover:shadow-md",
  numKey: "bg-slate-100 hover:bg-slate-200",
  numKeyText: "text-slate-800",
  numDisplay: "bg-slate-100",
  numDisplayText: "text-slate-800",
  toneMap: {
    red: "from-rose-200 to-rose-400",
    white: "from-amber-100 to-amber-300",
    spirit: "from-sky-100 to-sky-300",
    spirit2: "from-orange-100 to-orange-300",
    beer: "from-yellow-100 to-yellow-300",
    soft: "from-red-100 to-red-300",
    water: "from-cyan-100 to-cyan-300",
  },
  funcToneMap: {
    fuchsia: "bg-fuchsia-500 hover:bg-fuchsia-400",
    pink: "bg-pink-400 hover:bg-pink-300",
    rose: "bg-rose-400 hover:bg-rose-300",
    indigo: "bg-indigo-500 hover:bg-indigo-400",
    amber: "bg-amber-400 hover:bg-amber-300",
    sky: "bg-sky-500 hover:bg-sky-400",
    red: "bg-red-500 hover:bg-red-400",
    slate: "bg-slate-400 hover:bg-slate-300",
  },
  totalAccent: "text-emerald-600",
  chargeBtn: "bg-emerald-500 hover:bg-emerald-400 text-white",
  scrollHint: "text-slate-300",
};

const DARK: Palette = {
  page: "bg-slate-950",
  panel: "bg-slate-900 border border-slate-800",
  panelHead: "text-slate-500",
  headerText: "text-slate-100",
  mutedText: "text-slate-400",
  faintText: "text-slate-500",
  divide: "divide-slate-800",
  border: "border-slate-800",
  searchBg: "bg-slate-800",
  searchText: "text-slate-500",
  catActive: "bg-sky-500 text-white shadow shadow-sky-900/50",
  catInactive: "bg-slate-800 text-slate-300 hover:bg-slate-700",
  rowSelected: "bg-sky-500/10 border-l-4 border-sky-400",
  rowHover: "hover:bg-slate-800/60 border-l-4 border-transparent",
  cardBase: "bg-slate-800/70 border border-slate-700/60 hover:border-slate-600 hover:bg-slate-800",
  numKey: "bg-slate-800 hover:bg-slate-700",
  numKeyText: "text-slate-100",
  numDisplay: "bg-slate-800",
  numDisplayText: "text-slate-100",
  toneMap: {
    red: "from-rose-900/70 to-rose-700/60",
    white: "from-amber-900/60 to-amber-700/50",
    spirit: "from-sky-900/60 to-sky-700/50",
    spirit2: "from-orange-900/60 to-orange-700/50",
    beer: "from-yellow-900/60 to-yellow-700/50",
    soft: "from-red-900/60 to-red-700/50",
    water: "from-cyan-900/60 to-cyan-700/50",
  },
  funcToneMap: {
    fuchsia: "bg-fuchsia-600 hover:bg-fuchsia-500",
    pink: "bg-pink-600 hover:bg-pink-500",
    rose: "bg-rose-600 hover:bg-rose-500",
    indigo: "bg-indigo-600 hover:bg-indigo-500",
    amber: "bg-amber-500 hover:bg-amber-400",
    sky: "bg-sky-600 hover:bg-sky-500",
    red: "bg-red-600 hover:bg-red-500",
    slate: "bg-slate-700 hover:bg-slate-600",
  },
  totalAccent: "text-emerald-400",
  chargeBtn: "bg-emerald-500 hover:bg-emerald-400 text-slate-950",
  scrollHint: "text-slate-700",
};

export default function PosLayout({ theme, journalWide }: { theme: "light" | "dark"; journalWide?: boolean }) {
  const pal = theme === "dark" ? DARK : LIGHT;
  const journalWidth = journalWide ? 540 : 360; // +50% when journalWide
  const numpadWidth = 324;
  const panelGap = 12;
  const leftColWidth = journalWidth + numpadWidth + panelGap;
  const [cat, setCat] = useState("All");
  const [lines, setLines] = useState(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(lines[0]?.id ?? null);
  const [numMode, setNumMode] = useState<NumMode>("qty");
  const [display, setDisplay] = useState("");

  const selected = lines.find((l) => l.id === selectedId) ?? null;

  const subtotal = lines.reduce((s, l) => s + l.qty * l.price * (1 - (l.discountPct ?? 0) / 100), 0);
  const tax = subtotal * 0.19;
  const total = subtotal + tax;

  function addQty(id: string, d: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  }

  function removeLine(id: string) {
    setLines((ls) => ls.filter((l) => l.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function pressKey(k: string) {
    if (k === "⌫") {
      setDisplay((d) => d.slice(0, -1));
      return;
    }
    if (k === "." && display.includes(".")) return;
    setDisplay((d) => (d + k).slice(0, 8));
  }

  function applyCorrection() {
    if (!selected || !display) return;
    const val = parseFloat(display);
    if (isNaN(val)) return;
    setLines((ls) =>
      ls.map((l) => {
        if (l.id !== selected.id) return l;
        if (numMode === "qty") return { ...l, qty: Math.max(1, Math.round(val)) };
        if (numMode === "price") return { ...l, price: val };
        return { ...l, discountPct: Math.min(100, Math.max(0, val)) };
      })
    );
    setDisplay("");
  }

  function handleFunctionKey(label: string) {
    if (label === "Delete Item" && selected) removeLine(selected.id);
    if (label === "Discount" && selected) { setNumMode("discount"); setDisplay(""); }
  }

  return (
    <div className={`pos-mockup-root min-h-screen w-full flex ${pal.page} p-3 gap-3`} style={{ height: "100vh" }}>
      {/* Left: journal (scrollable) + numpad/corrections, side by side */}
      <div className="flex flex-shrink-0 gap-3" style={{ width: leftColWidth }}>
        {/* Journal */}
        <div className={`${pal.panel} rounded-2xl flex flex-col overflow-hidden min-h-0`} style={{ width: journalWidth }}>
          <div className={`grid grid-cols-[1fr_60px_36px_60px] gap-2 px-4 py-3 text-[11px] font-bold uppercase tracking-wide border-b ${pal.border} ${pal.panelHead}`}>
            <span>Item</span>
            <span className="text-right">Price</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Total</span>
          </div>
          <div className={`flex-1 overflow-y-auto divide-y ${pal.divide}`}>
            {lines.map((l) => {
              const isSelected = l.id === selectedId;
              const lineTotal = l.qty * l.price * (1 - (l.discountPct ?? 0) / 100);
              return (
                <div
                  key={l.id}
                  onClick={() => { setSelectedId(l.id); setNumMode("qty"); setDisplay(""); }}
                  className={`grid grid-cols-[1fr_60px_36px_60px] gap-2 px-4 py-2.5 items-center cursor-pointer transition-colors ${
                    isSelected ? pal.rowSelected : pal.rowHover
                  }`}
                >
                  <div>
                    <div className={`text-sm font-semibold ${pal.headerText}`}>{l.name}</div>
                    <div className={`text-[11px] ${pal.faintText} flex items-center gap-1`}>
                      {l.unit}
                      {l.discountPct ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedId(l.id); setNumMode("discount"); setDisplay(""); }}
                          className="text-emerald-500 font-semibold underline decoration-dotted hover:text-emerald-400"
                          title="Tap to correct discount"
                        >
                          -{l.discountPct}%
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedId(l.id); setNumMode("discount"); setDisplay(""); }}
                          className={`text-[10px] underline decoration-dotted ${pal.faintText} hover:text-emerald-500`}
                          title="Tap to add discount"
                        >
                          + disc
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setSelectedId(l.id); setNumMode("price"); setDisplay(""); }}
                    className={`text-right text-sm ${pal.mutedText} hover:text-sky-500 underline decoration-dotted`}
                    title="Tap to correct price"
                  >
                    {money(l.price)}
                  </button>
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); addQty(l.id, -1); }} className={`w-5 h-5 rounded-full ${pal.numKey} ${pal.numKeyText} text-xs`}>−</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedId(l.id); setNumMode("qty"); setDisplay(""); }}
                      className={`text-sm font-semibold w-4 text-center ${pal.headerText}`}
                      title="Tap to correct quantity"
                    >
                      {l.qty}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); addQty(l.id, 1); }} className="w-5 h-5 rounded-full bg-emerald-500 text-white text-xs">+</button>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeLine(l.id); }}
                    className={`text-right text-sm font-bold ${pal.headerText} hover:text-red-400`}
                    title="Tap to remove line"
                  >
                    {money(lineTotal)}
                  </button>
                </div>
              );
            })}
            {lines.length === 0 && (
              <div className={`flex flex-col items-center justify-center h-full py-16 gap-2 ${pal.faintText}`}>
                <span className="text-2xl">🧾</span>
                <span className="text-sm">Tap a product to start</span>
              </div>
            )}
          </div>
          <div className={`border-t ${pal.border} px-4 py-3 space-y-1.5 ${theme === "dark" ? "bg-slate-950/40" : "bg-slate-50"}`}>
            <div className={`flex justify-between text-xs ${pal.mutedText}`}>
              <span>Subtotal</span><span>{money(subtotal)}</span>
            </div>
            <div className={`flex justify-between text-xs ${pal.mutedText}`}>
              <span>Tax (19%)</span><span>{money(tax)}</span>
            </div>
            <div className="flex justify-between items-center pt-1">
              <span className={`text-sm font-bold ${pal.headerText}`}>Total</span>
              <span className={`text-2xl font-extrabold ${pal.totalAccent}`}>{money(total)}</span>
            </div>
          </div>
        </div>

        {/* Numpad + corrections + function keys */}
        <div className={`${pal.panel} rounded-2xl flex flex-col p-3 gap-3 overflow-y-auto`} style={{ width: 324 }}>
          {/* Correction context */}
          <div className={`rounded-xl px-3 py-2.5 ${theme === "dark" ? "bg-slate-800/60" : "bg-slate-50"}`}>
            {selected ? (
              <>
                <div className={`text-[11px] ${pal.faintText} mb-0.5`}>Editing line</div>
                <div className={`text-sm font-semibold truncate ${pal.headerText}`}>{selected.name}</div>
                <div className="flex gap-1.5 mt-2">
                  {(["qty", "price", "discount"] as NumMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => { setNumMode(m); setDisplay(""); }}
                      className={`flex-1 text-[11px] font-semibold rounded-lg py-1.5 capitalize transition-colors ${
                        numMode === m ? "bg-sky-500 text-white" : `${pal.numKey} ${pal.numKeyText}`
                      }`}
                    >
                      {m === "discount" ? "Disc %" : m}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={`text-xs ${pal.faintText}`}>Select a journal line to edit qty, price or discount</div>
            )}
          </div>

          {/* Function keys */}
          <div className="grid grid-cols-2 gap-2">
            {FUNCTION_KEYS.map((f) => (
              <button
                key={f.label}
                onClick={() => handleFunctionKey(f.label)}
                className={`text-white text-xs font-bold rounded-xl py-2.5 active:scale-95 transition-transform flex items-center justify-center gap-1.5 ${pal.funcToneMap[f.tone]}`}
              >
                <span>{f.icon}</span>
                {f.label}
              </button>
            ))}
          </div>

          {/* Numpad */}
          <div className={`rounded-xl px-3 py-2 text-right ${pal.numDisplay}`}>
            <span className={`text-xl font-mono font-bold tracking-tight ${pal.numDisplayText}`}>
              {numMode === "price" ? "€" : ""}{display || "0"}{numMode === "discount" ? "%" : ""}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {NUMPAD_KEYS.map((k) => (
              <button
                key={k}
                onClick={() => pressKey(k)}
                className={`${pal.numKey} ${pal.numKeyText} text-lg font-bold rounded-xl py-2.5 active:scale-95 transition-transform`}
              >
                {k}
              </button>
            ))}
          </div>
          <button
            onClick={applyCorrection}
            disabled={!selected || !display}
            className="bg-indigo-500 hover:bg-indigo-400 disabled:opacity-30 text-white text-sm font-bold rounded-xl py-2.5 transition-colors"
          >
            Apply to Line
          </button>

          <div className="flex-1" />

          <button className={`${pal.chargeBtn} text-base font-bold rounded-xl py-3.5 active:scale-[0.98] transition-transform`}>
            Charge {money(total)}
          </button>
        </div>
      </div>

      {/* Right: search + categories + product grid */}
      <div className="flex flex-col flex-1 min-w-0 gap-3">
        <div className={`${pal.panel} rounded-2xl px-4 py-3 flex items-center gap-3`}>
          <div className={`flex-1 flex items-center gap-2 ${pal.searchBg} rounded-xl px-3 py-2`}>
            <span className={pal.searchText}>🔍</span>
            <span className={`${pal.searchText} text-sm`}>Search product or scan barcode…</span>
          </div>
          <div className="text-right">
            <div className={`text-xs ${pal.faintText}`}>Cashier</div>
            <div className={`text-sm font-semibold ${pal.headerText}`}>Christoforos</div>
          </div>
        </div>

        <div className={`${pal.panel} rounded-2xl px-3 py-2.5 flex gap-2 overflow-x-auto`}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                cat === c ? pal.catActive : pal.catInactive
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className={`${pal.panel} rounded-2xl flex-1 p-3 overflow-hidden`}>
          <div className="grid grid-cols-4 gap-3 h-full overflow-y-auto content-start">
            {PRODUCTS.map((p) => (
              <button key={p.id} className={`flex flex-col rounded-xl overflow-hidden transition-shadow active:scale-95 ${pal.cardBase}`}>
                <div className={`h-20 w-full bg-gradient-to-br ${pal.toneMap[p.tone]} flex items-center justify-center text-3xl`}>
                  {p.emoji}
                </div>
                <div className="px-2.5 py-2 text-left">
                  <div className={`text-xs font-semibold pos-line-clamp-2 leading-tight ${pal.headerText}`}>{p.name}</div>
                  <div className={`text-[10px] mb-1 ${pal.faintText}`}>{p.unit}</div>
                  <div className={`text-sm font-bold ${pal.totalAccent}`}>{money(p.price)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
