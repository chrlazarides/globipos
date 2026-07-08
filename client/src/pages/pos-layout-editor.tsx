import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, Save, Loader2, LayoutGrid, Trash2, Package,
  Tag, Zap, EyeOff, Settings2, CheckCircle2,
  CreditCard, Banknote, Receipt, RotateCcw, Users, Search,
  Calculator, Printer, BookOpen, ShieldAlert, Clock,
  ChevronUp, ChevronDown, AlignLeft, Wallet, Minus,
  DoorOpen, FileText, BarChart2, TrendingDown,
  Smartphone, Tablet, Monitor, Tv, Layers, Circle,
  Square, Plus, Minus as MinusIcon, Info, GripVertical,
} from "lucide-react";
import type { PosLayoutSet, PosLayoutButton } from "@shared/schema";

// ── Color palette ──────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#1e293b","#374151","#6b7280","#ef4444","#dc2626","#f97316",
  "#ea580c","#f59e0b","#eab308","#84cc16","#22c55e","#16a34a",
  "#14b8a6","#06b6d4","#0ea5e9","#3b82f6","#1d4ed8","#8b5cf6",
  "#7c3aed","#ec4899","#be185d","#9f1239","#7f1d1d","#78350f",
];

// ── Action groups ──────────────────────────────────────────────────────────────
interface ActionDef { code: string; label: string; icon: any; description?: string }
interface ActionGroup { group: string; icon: any; color: string; actions: ActionDef[] }

const ACTION_GROUPS: ActionGroup[] = [
  {
    group: "Payments", icon: CreditCard, color: "text-green-600",
    actions: [
      { code: "PAY_CASH",         label: "Pay Cash",             icon: Banknote,     description: "Accept cash, calculate change" },
      { code: "PAY_CARD",         label: "Pay Card",             icon: CreditCard,   description: "Process card via connected terminal" },
      { code: "PAY_SPLIT",        label: "Split Payment",        icon: Wallet,       description: "Split across cash and card" },
      { code: "PAY_ACCOUNT",      label: "Charge to Account",    icon: AlignLeft,    description: "Post to customer account / credit" },
      { code: "PAY_VOUCHER",      label: "Redeem Voucher",       icon: Receipt,      description: "Accept a gift voucher or coupon code" },
      { code: "PAY_LAYAWAY",      label: "Layaway / Deposit",    icon: Wallet,       description: "Take partial payment, hold order" },
    ],
  },
  {
    group: "Sale Management", icon: Receipt, color: "text-blue-600",
    actions: [
      { code: "NEW_SALE",         label: "New Sale",             icon: Receipt,      description: "Clear current order and start fresh" },
      { code: "HOLD",             label: "Hold Sale",            icon: Receipt,      description: "Park current order, serve another customer" },
      { code: "RECALL",           label: "Recall Held Sale",     icon: Receipt,      description: "Bring back a parked order" },
      { code: "VOID_LINE",        label: "Void Line",            icon: Minus,        description: "Remove currently selected line" },
      { code: "VOID_SALE",        label: "Void Sale",            icon: RotateCcw,    description: "Cancel the entire current order" },
      { code: "REFUND",           label: "Refund / Return",      icon: RotateCcw,    description: "Process a return against a prior sale" },
      { code: "EXCHANGE",         label: "Exchange",             icon: RotateCcw,    description: "Swap an item for another" },
      { code: "SUSPEND_SALE",     label: "Suspend Sale",         icon: Receipt,      description: "Save order without payment" },
    ],
  },
  {
    group: "Price & Modifiers", icon: Calculator, color: "text-amber-600",
    actions: [
      { code: "QTY",              label: "Enter Quantity",       icon: Calculator,   description: "Numeric keypad to set line quantity" },
      { code: "DISCOUNT_PCT",     label: "Line Discount %",      icon: TrendingDown, description: "Percentage discount on selected line" },
      { code: "DISCOUNT_FIXED",   label: "Line Discount (Fixed)",icon: TrendingDown, description: "Fixed-amount discount on selected line" },
      { code: "ORDER_DISCOUNT_PCT",label:"Order Discount %",     icon: TrendingDown, description: "Percentage discount on whole order" },
      { code: "PRICE_OVERRIDE",   label: "Price Override",       icon: Calculator,   description: "Manually set the price of a line" },
      { code: "PRICE_CHECK",      label: "Price Check",          icon: Search,       description: "Look up item price by barcode" },
      { code: "WEIGHT",           label: "Enter Weight",         icon: Calculator,   description: "Input weight for sold-by-weight items" },
    ],
  },
  {
    group: "Customer", icon: Users, color: "text-purple-600",
    actions: [
      { code: "CUSTOMER_LOOKUP",  label: "Customer Lookup",      icon: Search,       description: "Attach a customer to this order" },
      { code: "CUSTOMER_CLEAR",   label: "Clear Customer",       icon: Users,        description: "Remove customer from current order" },
      { code: "LOYALTY_POINTS",   label: "Redeem Loyalty Points",icon: Users,        description: "Apply earned points as discount" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Balance",     icon: Wallet,       description: "Show customer account balance" },
      { code: "CUSTOMER_HISTORY", label: "Purchase History",     icon: FileText,     description: "View customer's recent purchases" },
    ],
  },
  {
    group: "Barcode & Search", icon: Search, color: "text-cyan-600",
    actions: [
      { code: "BARCODE_SCAN",     label: "Scan Barcode",         icon: Search,       description: "Activate barcode scanner input" },
      { code: "ITEM_SEARCH",      label: "Search Items",         icon: Search,       description: "Open text search for items" },
      { code: "PLU",              label: "PLU / Item Code",      icon: Search,       description: "Enter an item code directly" },
    ],
  },
  {
    group: "Cash Drawer & Journal", icon: DoorOpen, color: "text-orange-600",
    actions: [
      { code: "OPEN_DRAWER",      label: "Open Drawer",          icon: DoorOpen,     description: "Pop open the cash drawer" },
      { code: "NO_SALE",          label: "No Sale",              icon: DoorOpen,     description: "Open drawer without a transaction" },
      { code: "CASH_IN",          label: "Cash In",              icon: Banknote,     description: "Record cash added to drawer" },
      { code: "CASH_OUT",         label: "Cash Out",             icon: Banknote,     description: "Record cash removed from drawer" },
      { code: "PETTY_CASH",       label: "Petty Cash",           icon: Banknote,     description: "Record a petty cash expense" },
      { code: "DECLARE_CASH",     label: "Declare Cash",         icon: Banknote,     description: "Count and declare cash at shift end" },
    ],
  },
  {
    group: "Receipt & Print", icon: Printer, color: "text-gray-600",
    actions: [
      { code: "PRINT_RECEIPT",    label: "Print Receipt",        icon: Printer,      description: "Print receipt for last / current sale" },
      { code: "REPRINT",          label: "Reprint Receipt",      icon: Printer,      description: "Reprint the last printed receipt" },
      { code: "EMAIL_RECEIPT",    label: "Email Receipt",        icon: Receipt,      description: "Send receipt to customer via email" },
      { code: "GIFT_RECEIPT",     label: "Gift Receipt",         icon: Receipt,      description: "Print receipt without prices" },
    ],
  },
  {
    group: "Shift & Reports", icon: BarChart2, color: "text-indigo-600",
    actions: [
      { code: "CLOCK_IN",         label: "Clock In",             icon: Clock,        description: "Cashier clocks in at start of shift" },
      { code: "CLOCK_OUT",        label: "Clock Out",            icon: Clock,        description: "Cashier clocks out at end of shift" },
      { code: "REPORT_X",         label: "X Report (Interim)",   icon: BarChart2,    description: "Print mid-shift sales summary" },
      { code: "REPORT_Z",         label: "Z Report (End of Day)",icon: BarChart2,    description: "Print end-of-day report, reset counters" },
      { code: "SHIFT_START",      label: "Start Shift",          icon: Clock,        description: "Open a new cashier shift" },
      { code: "SHIFT_END",        label: "End Shift",            icon: Clock,        description: "Close current shift" },
    ],
  },
  {
    group: "Accounting / Journal", icon: BookOpen, color: "text-rose-600",
    actions: [
      { code: "JOURNAL_CASH_IN",     label: "Journal: Cash In",      icon: BookOpen,  description: "Post a cash-in journal entry to the bill" },
      { code: "JOURNAL_CASH_OUT",    label: "Journal: Cash Out",     icon: BookOpen,  description: "Post a cash-out journal entry to the bill" },
      { code: "JOURNAL_EXPENSE",     label: "Journal: Expense",      icon: BookOpen,  description: "Record a petty-cash expense in ledger" },
      { code: "JOURNAL_CORRECTION",  label: "Journal: Correction",   icon: BookOpen,  description: "Post a manual correction entry" },
      { code: "JOURNAL_TIP",         label: "Add Tip / Gratuity",    icon: BookOpen,  description: "Add a tip line to the bill" },
      { code: "JOURNAL_SERVICE_CHG", label: "Service Charge",        icon: BookOpen,  description: "Apply a service charge to the bill" },
      { code: "JOURNAL_COVER",       label: "Cover Charge",          icon: BookOpen,  description: "Add a per-head cover charge" },
      { code: "VAT_SUMMARY",         label: "VAT Summary",           icon: FileText,  description: "Show VAT collected for current shift" },
    ],
  },
  {
    group: "Navigation & Display", icon: LayoutGrid, color: "text-slate-600",
    actions: [
      { code: "PAGE_UP",          label: "Page Up",              icon: ChevronUp,    description: "Scroll the product grid up one page" },
      { code: "PAGE_DOWN",        label: "Page Down",            icon: ChevronDown,  description: "Scroll the product grid down one page" },
      { code: "SHOW_ALL_ITEMS",   label: "Show All Items",       icon: LayoutGrid,   description: "Clear category filter" },
      { code: "NUMPAD",           label: "Numeric Keypad",       icon: Calculator,   description: "Open the numeric input pad" },
      { code: "NOTES",            label: "Add Order Note",       icon: AlignLeft,    description: "Attach a free-text note to the order" },
    ],
  },
  {
    group: "Manager & Security", icon: ShieldAlert, color: "text-red-700",
    actions: [
      { code: "MANAGER_OVERRIDE", label: "Manager Override",     icon: ShieldAlert,  description: "Prompt for manager PIN to authorise" },
      { code: "LOCK_TERMINAL",    label: "Lock Terminal",        icon: ShieldAlert,  description: "Lock screen — requires PIN to resume" },
      { code: "CHANGE_CASHIER",   label: "Change Cashier",       icon: Users,        description: "Switch cashier without closing sale" },
      { code: "ADMIN_MENU",       label: "Admin Menu",           icon: Settings2,    description: "Access terminal administration options" },
    ],
  },
];

const ALL_ACTIONS = ACTION_GROUPS.flatMap(g => g.actions);

// Stable empty-array references for query defaults — using a fresh `[]` literal as a
// destructuring default creates a NEW array every render while the query is still
// loading, which can make it an unstable useEffect dependency and trigger a
// "Maximum update depth exceeded" render loop.
const EMPTY_LAYOUTS: PosLayoutSet[] = [];
const EMPTY_BUTTONS: PosLayoutButton[] = [];
const EMPTY_ITEMS: { id: string; name: string }[] = [];
const EMPTY_CATEGORIES: { id: string; name: string }[] = [];

// ── Types ──────────────────────────────────────────────────────────────────────
type ButtonType  = "item" | "category" | "action" | "sublayout" | "empty";
type CornerStyle = "rect" | "round"; // rect = rounded-xl, round = rounded-full (circle)

interface SlotData {
  position:    number;
  label:       string;
  color:       string;
  buttonType:  ButtonType;
  itemId?:     string;
  categoryId?: string;
  actionCode?: string;
  sublayoutId?:string;
  shape?:      CornerStyle; // visual corner style only
  colspan?:    number;      // 1–4, independent of rowspan
  rowspan?:    number;      // 1–4, independent of colspan
  icon?:       string;
}

// ── Screen resolution presets (inspired by IdealPOS's screen-resolution guide) ──
interface ResolutionPreset {
  id:      string;
  label:   string;
  note:    string;
  tier:    "desktop" | "large"; // which grid tier this preset drives (desktop = master columns/rows, large = colsLarge)
  columns: number;
  rows:    number;
  scaling?: string; // recommended Windows display scaling, if any
}

const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: "1024x768",         label: "1024×768 (4:3)",         note: "Default resolution — balanced grid.",              tier: "desktop", columns: 4, rows: 5 },
  { id: "1024x600",         label: "1024×600 (15:9)",        note: "Shorter screen — fewer rows fit.",                 tier: "desktop", columns: 4, rows: 4 },
  { id: "1280x800",         label: "1280×800 (16:10)",       note: "Wider desktop layout, more columns.",              tier: "desktop", columns: 5, rows: 5 },
  { id: "1366x768",         label: "1366×768 (16:9)",        note: "Common laptop resolution — longer button list.",   tier: "desktop", columns: 5, rows: 4 },
  { id: "1920x1080",        label: "1920×1080 (16:9)",       note: "Full HD monitor.",                                  tier: "large",   columns: 6, rows: 5, scaling: "125%" },
  { id: "1920x1080-retail", label: "1920×1080 Retail (16:9)",note: "Full-width sale window layout.",                    tier: "large",   columns: 7, rows: 5, scaling: "125%" },
  { id: "1920x1280",        label: "1920×1280 (3:2)",        note: "Surface Go 3 — use larger touch targets.",         tier: "large",   columns: 6, rows: 6, scaling: "125–150%" },
];

function makeEmpty(position: number): SlotData {
  return { position, label: "", color: "#6b7280", buttonType: "empty", shape: "rect", colspan: 1, rowspan: 1 };
}

/** Positions consumed by spanning neighbours (not the anchor itself) */
function getConsumedPositions(slots: SlotData[], cols: number): Set<number> {
  const consumed = new Set<number>();
  if (cols <= 0) return consumed;
  for (const slot of slots) {
    const colspan = slot.colspan ?? 1;
    const rowspan = slot.rowspan ?? 1;
    if (colspan === 1 && rowspan === 1) continue;
    const col = slot.position % cols;
    const row = Math.floor(slot.position / cols);
    for (let r = 0; r < rowspan; r++) {
      for (let c = 0; c < colspan; c++) {
        if (r === 0 && c === 0) continue;
        consumed.add((row + r) * cols + (col + c));
      }
    }
  }
  return consumed;
}

function radiusClass(layoutRadius?: string | null, cornerStyle?: CornerStyle) {
  if (cornerStyle === "round") return "rounded-full";
  switch (layoutRadius) {
    case "round":  return "rounded-full";
    case "square": return "rounded-none";
    default:       return "rounded-xl";
  }
}

function typeChip(type: ButtonType) {
  const map: Record<ButtonType, string> = {
    item:      "bg-blue-100 text-blue-700",
    category:  "bg-purple-100 text-purple-700",
    action:    "bg-amber-100 text-amber-700",
    sublayout: "bg-teal-100 text-teal-700",
    empty:     "bg-gray-100 text-gray-400",
  };
  return map[type] ?? "bg-gray-100 text-gray-400";
}

// ── GridButton ─────────────────────────────────────────────────────────────────
function GridButton({
  slot, cols, onClick, isSelected, buttonRadius, allLayouts,
  draggable, isDragOver, isDragging, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: {
  slot: SlotData;
  cols: number;
  onClick: () => void;
  isSelected: boolean;
  buttonRadius?: string | null;
  allLayouts: PosLayoutSet[];
  draggable?: boolean;
  isDragOver?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLButtonElement>) => void;
}) {
  const isEmpty   = slot.buttonType === "empty" || !slot.label;
  const colspan   = slot.colspan ?? 1;
  const rowspan   = slot.rowspan ?? 1;
  const rc        = radiusClass(buttonRadius, slot.shape);
  const subName   = slot.sublayoutId ? allLayouts.find(l => l.id === slot.sublayoutId)?.name : null;
  const sizeLabel = (colspan > 1 || rowspan > 1) ? `${colspan}×${rowspan}` : null;
  const row = Math.floor(slot.position / cols);
  const col = slot.position % cols;

  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-testid={`grid-btn-${slot.position}`}
      style={{
        gridColumn:      `${col + 1} / span ${colspan}`,
        gridRow:         `${row + 1} / span ${rowspan}`,
        backgroundColor: isEmpty ? undefined : slot.color + "dd",
        borderColor:     isEmpty ? undefined : slot.color,
      }}
      className={`
        relative flex flex-col items-center justify-center border-2 text-center
        transition-all select-none overflow-hidden min-h-[4rem]
        ${rc}
        ${isSelected ? "ring-2 ring-primary ring-offset-2" : "hover:opacity-90"}
        ${isEmpty ? "border-dashed border-gray-200 bg-gray-50 hover:border-primary/40" : "border-transparent shadow-sm"}
        ${draggable ? "cursor-grab active:cursor-grabbing" : ""}
        ${isDragOver ? "ring-2 ring-blue-400 ring-offset-1 scale-[1.03] z-10" : ""}
        ${isDragging ? "opacity-40" : ""}
      `}
    >
      {!isEmpty ? (
        <>
          <span className="text-white font-semibold text-xs leading-tight px-1.5 max-h-14 overflow-hidden break-words line-clamp-3 text-center w-full">
            {slot.label}
          </span>
          <span className={`absolute bottom-1 left-1 text-[9px] px-1 py-0.5 rounded ${typeChip(slot.buttonType)} opacity-80`}>
            {slot.buttonType}
          </span>
          {sizeLabel && (
            <span className="absolute bottom-1 right-1 text-[9px] text-white/60 font-mono">{sizeLabel}</span>
          )}
          {subName && (
            <span className="absolute top-1 right-1 text-[9px] text-white/70 flex items-center gap-0.5">
              <Layers className="w-2.5 h-2.5" />{subName.slice(0, 8)}
            </span>
          )}
          {draggable && (
            <GripVertical className="absolute top-0.5 right-0.5 w-3 h-3 text-white/40" />
          )}
        </>
      ) : (
        <span className="text-gray-300 text-xs">+</span>
      )}
      <span className="absolute top-0.5 left-1 text-[9px] text-white/30 font-mono">{slot.position + 1}</span>
    </button>
  );
}

// ── ActionGroupPicker ──────────────────────────────────────────────────────────
function ActionGroupPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const normalizedValue = value?.toUpperCase() ?? "";
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    const g = ACTION_GROUPS.find(g => g.actions.some(a => a.code === normalizedValue));
    return g?.group ?? ACTION_GROUPS[0].group;
  });

  return (
    <div className="border rounded-lg overflow-hidden">
      {ACTION_GROUPS.map(group => {
        const GroupIcon = group.icon;
        const isOpen = openGroup === group.group;
        const selectedInGroup = group.actions.find(a => a.code === normalizedValue);
        return (
          <div key={group.group}>
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : group.group)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium border-b transition-colors ${isOpen ? "bg-muted/60" : "bg-background hover:bg-muted/30"}`}
            >
              <span className="flex items-center gap-2">
                <GroupIcon className={`w-4 h-4 ${group.color}`} />
                {group.group}
                {selectedInGroup && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">{selectedInGroup.label}</Badge>
                )}
              </span>
              <span className="text-muted-foreground text-xs">{group.actions.length}</span>
            </button>
            {isOpen && (
              <div className="divide-y bg-muted/20">
                {group.actions.map(action => {
                  const ActionIcon = action.icon;
                  const isSel = normalizedValue === action.code;
                  return (
                    <button
                      key={action.code}
                      type="button"
                      onClick={() => onChange(action.code)}
                      data-testid={`action-${action.code}`}
                      className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${isSel ? "bg-primary/10 text-primary" : "hover:bg-muted/50"}`}
                    >
                      <ActionIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isSel ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none">{action.label}</p>
                        {action.description && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{action.description}</p>}
                      </div>
                      {isSel && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 ml-auto mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── SizePicker ─────────────────────────────────────────────────────────────────
// Visual W×H matrix + stepper fallback + corner-style toggle
const MAX_SPAN = 4;
const QUICK_SIZES: { w: number; h: number; label: string }[] = [
  { w:1, h:1, label:"1×1" }, { w:2, h:1, label:"2×1" }, { w:3, h:1, label:"3×1" }, { w:4, h:1, label:"4×1" },
  { w:1, h:2, label:"1×2" }, { w:2, h:2, label:"2×2" }, { w:3, h:2, label:"3×2" }, { w:4, h:2, label:"4×2" },
  { w:1, h:3, label:"1×3" }, { w:2, h:3, label:"2×3" }, { w:3, h:3, label:"3×3" }, { w:4, h:3, label:"4×3" },
  { w:1, h:4, label:"1×4" }, { w:2, h:4, label:"2×4" }, { w:3, h:4, label:"3×4" }, { w:4, h:4, label:"4×4" },
];

function SizePicker({
  colspan, rowspan, shape, color,
  onColspan, onRowspan, onShape,
}: {
  colspan: number; rowspan: number; shape: CornerStyle; color: string;
  onColspan: (n: number) => void; onRowspan: (n: number) => void; onShape: (s: CornerStyle) => void;
}) {
  const [hovered, setHovered] = useState<{ w: number; h: number } | null>(null);
  const previewW = hovered?.w ?? colspan;
  const previewH = hovered?.h ?? rowspan;

  return (
    <div className="space-y-4">
      {/* Visual matrix */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Click to set width × height</p>
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${MAX_SPAN}, 1fr)` }}>
          {QUICK_SIZES.map(({ w, h, label }) => {
            const isActive = w === colspan && h === rowspan;
            const isHighlighted = hovered ? w <= hovered.w && h <= hovered.h : w <= colspan && h <= rowspan;
            return (
              <button
                key={label}
                type="button"
                data-testid={`size-${w}x${h}`}
                onMouseEnter={() => setHovered({ w, h })}
                onMouseLeave={() => setHovered(null)}
                onClick={() => { onColspan(w); onRowspan(h); }}
                title={`${w}×${h}`}
                className={`w-9 h-9 rounded border-2 text-[10px] font-mono transition-all ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground font-bold"
                    : isHighlighted
                    ? "border-primary/60 bg-primary/20 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Steppers */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Width (columns)</p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onColspan(Math.max(1, colspan - 1))} disabled={colspan <= 1}
              className="w-7 h-7 rounded border flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors" data-testid="btn-colspan-minus">
              <MinusIcon className="w-3 h-3" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">{colspan}</span>
            <button type="button" onClick={() => onColspan(Math.min(MAX_SPAN, colspan + 1))} disabled={colspan >= MAX_SPAN}
              className="w-7 h-7 rounded border flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors" data-testid="btn-colspan-plus">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Height (rows)</p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onRowspan(Math.max(1, rowspan - 1))} disabled={rowspan <= 1}
              className="w-7 h-7 rounded border flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors" data-testid="btn-rowspan-minus">
              <MinusIcon className="w-3 h-3" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums">{rowspan}</span>
            <button type="button" onClick={() => onRowspan(Math.min(MAX_SPAN, rowspan + 1))} disabled={rowspan >= MAX_SPAN}
              className="w-7 h-7 rounded border flex items-center justify-center disabled:opacity-40 hover:bg-muted transition-colors" data-testid="btn-rowspan-plus">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Corner style */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Corner Style</p>
        <div className="flex gap-2">
          {([
            { id: "rect"  as CornerStyle, label: "Rounded", cls: "rounded-lg" },
            { id: "round" as CornerStyle, label: "Circle",  cls: "rounded-full" },
          ]).map(s => (
            <button key={s.id} type="button" onClick={() => onShape(s.id)} data-testid={`corner-${s.id}`}
              className={`flex-1 py-2.5 text-xs font-medium border transition-all ${s.cls} ${shape === s.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50"}`}>
              {s.label}
            </button>
          ))}
        </div>
        {shape === "round" && (
          <p className="text-[10px] text-muted-foreground mt-1.5 flex gap-1">
            <Circle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Circle works best with equal width & height (e.g. 1×1, 2×2)
          </p>
        )}
      </div>

      {/* Live preview */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Preview ({previewW}×{previewH})</p>
        <div className="bg-muted/30 rounded-lg p-3 flex items-center justify-center" style={{ minHeight: "80px" }}>
          <div
            className={`flex items-center justify-center text-white text-xs font-semibold shadow transition-all ${radiusClass(undefined, shape)}`}
            style={{
              backgroundColor: color,
              width:  `${previewW * 44}px`,
              height: `${previewH * 44}px`,
              maxWidth: "200px",
              maxHeight: "200px",
            }}
          >
            {previewW}×{previewH}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ButtonDialog ───────────────────────────────────────────────────────────────
function ButtonDialog({
  slot, onSave, onClear, onClose, items, categories, allLayouts, currentLayoutId,
}: {
  slot: SlotData;
  onSave: (s: SlotData) => void;
  onClear: () => void;
  onClose: () => void;
  items: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  allLayouts: PosLayoutSet[];
  currentLayoutId: string;
}) {
  const [draft, setDraft] = useState<SlotData>({ shape: "rect", colspan: 1, rowspan: 1, ...slot });
  const [itemSearch, setItemSearch] = useState("");
  const set = (patch: Partial<SlotData>) => setDraft(d => ({ ...d, ...patch }));

  // Auto-label on selection
  useEffect(() => {
    if (draft.buttonType === "item" && draft.itemId) {
      const item = items.find(i => i.id === draft.itemId);
      if (item) set({ label: item.name.slice(0, 30) });
    }
  }, [draft.itemId]);
  useEffect(() => {
    if (draft.buttonType === "category" && draft.categoryId) {
      const cat = categories.find(c => c.id === draft.categoryId);
      if (cat) set({ label: cat.name.slice(0, 30) });
    }
  }, [draft.categoryId]);
  useEffect(() => {
    if (draft.buttonType === "action" && draft.actionCode) {
      const act = ALL_ACTIONS.find(a => a.code === draft.actionCode?.toUpperCase());
      if (act) set({ label: act.label });
    }
  }, [draft.actionCode]);
  useEffect(() => {
    if (draft.buttonType === "sublayout" && draft.sublayoutId) {
      const ly = allLayouts.find(l => l.id === draft.sublayoutId);
      if (ly && !draft.label) set({ label: ly.name.slice(0, 30) });
    }
  }, [draft.sublayoutId]);

  const filteredItems = itemSearch
    ? items.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase())).slice(0, 50)
    : items.slice(0, 80);

  const otherLayouts = allLayouts.filter(l => l.id !== currentLayoutId);

  const isValid =
    draft.buttonType === "empty" ||
    (draft.label.trim().length > 0 &&
      (draft.buttonType === "item"      ? !!draft.itemId :
       draft.buttonType === "category"  ? !!draft.categoryId :
       draft.buttonType === "action"    ? !!draft.actionCode :
       draft.buttonType === "sublayout" ? !!draft.sublayoutId : true));

  const colspan = draft.colspan ?? 1;
  const rowspan = draft.rowspan ?? 1;

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Configure Button #{slot.position + 1}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-0 flex-1 overflow-hidden">
          {/* Left panel — type + target */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Type selector */}
            <div>
              <Label className="mb-2 block text-sm">Button Type</Label>
              <Tabs
                value={draft.buttonType}
                onValueChange={v => set({ buttonType: v as ButtonType, itemId: undefined, categoryId: undefined, actionCode: undefined, sublayoutId: undefined, label: "" })}
              >
                <TabsList className="w-full grid grid-cols-5 h-auto">
                  <TabsTrigger value="item"      className="text-xs py-1.5" data-testid="tab-type-item">
                    <Package className="w-3.5 h-3.5 mr-1" />Product
                  </TabsTrigger>
                  <TabsTrigger value="category"  className="text-xs py-1.5" data-testid="tab-type-category">
                    <Tag className="w-3.5 h-3.5 mr-1" />Category
                  </TabsTrigger>
                  <TabsTrigger value="action"    className="text-xs py-1.5" data-testid="tab-type-action">
                    <Zap className="w-3.5 h-3.5 mr-1" />Function
                  </TabsTrigger>
                  <TabsTrigger value="sublayout" className="text-xs py-1.5" data-testid="tab-type-sublayout">
                    <Layers className="w-3.5 h-3.5 mr-1" />Sub-Menu
                  </TabsTrigger>
                  <TabsTrigger value="empty"     className="text-xs py-1.5" data-testid="tab-type-empty">
                    <EyeOff className="w-3.5 h-3.5 mr-1" />Empty
                  </TabsTrigger>
                </TabsList>

                {/* Product */}
                <TabsContent value="item" className="mt-3 space-y-2">
                  <Input placeholder="Search products…" value={itemSearch} onChange={e => setItemSearch(e.target.value)} data-testid="input-item-search" />
                  <ScrollArea className="h-44 border rounded-md">
                    <div className="p-1">
                      {filteredItems.map(i => (
                        <button key={i.id} type="button" onClick={() => set({ itemId: i.id })} data-testid={`item-option-${i.id}`}
                          className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center justify-between transition-colors ${draft.itemId === i.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"}`}>
                          <span className="truncate">{i.name}</span>
                          {draft.itemId === i.id && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                        </button>
                      ))}
                      {filteredItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No products found</p>}
                    </div>
                  </ScrollArea>
                  <p className="text-xs text-muted-foreground">{items.length} products available</p>
                </TabsContent>

                {/* Category */}
                <TabsContent value="category" className="mt-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    {categories.map(c => (
                      <button key={c.id} type="button" onClick={() => set({ categoryId: c.id })} data-testid={`cat-option-${c.id}`}
                        className={`text-left px-3 py-2 rounded border text-sm transition-colors ${draft.categoryId === c.id ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:bg-muted/50"}`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </TabsContent>

                {/* Action */}
                <TabsContent value="action" className="mt-3">
                  <ScrollArea className="h-64">
                    <ActionGroupPicker value={draft.actionCode ?? ""} onChange={code => set({ actionCode: code })} />
                  </ScrollArea>
                </TabsContent>

                {/* Sub-menu (condiments / modifier panel) */}
                <TabsContent value="sublayout" className="mt-3 space-y-3">
                  <div className="rounded-lg bg-teal-50 border border-teal-100 p-3 flex gap-2 text-xs text-teal-800">
                    <Layers className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-teal-600" />
                    <span>
                      <strong>Condiments / modifier panel.</strong> When the cashier taps this button an overlay shows the target layout — ideal for add-ons, cooking preferences, sizes, and extras. Common in hospitality.
                    </span>
                  </div>
                  {otherLayouts.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center space-y-1">
                      <p className="text-sm text-muted-foreground">No other layouts exist yet</p>
                      <p className="text-xs text-muted-foreground">Create a second layout (e.g. "Burger Add-ons") and it will appear here.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Select target layout</p>
                      {otherLayouts.map(l => (
                        <button key={l.id} type="button" onClick={() => set({ sublayoutId: l.id })}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${draft.sublayoutId === l.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/40"}`}>
                          <Layers className="w-4 h-4 flex-shrink-0 text-teal-600" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{l.name}</p>
                            {l.description && <p className="text-xs text-muted-foreground truncate">{l.description}</p>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {l.columns}×{l.rows}
                          </div>
                          {draft.sublayoutId === l.id && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="empty" className="mt-3">
                  <p className="text-sm text-muted-foreground">This slot will appear blank on the terminal — useful for visual spacing between buttons.</p>
                </TabsContent>
              </Tabs>
            </div>

            {draft.buttonType !== "empty" && (
              <>
                {/* Label */}
                <div>
                  <Label htmlFor="btn-label">Button Label</Label>
                  <Input id="btn-label" value={draft.label} onChange={e => set({ label: e.target.value })} placeholder="Text shown on the button" maxLength={30} data-testid="input-btn-label" />
                  <p className="text-xs text-muted-foreground mt-1">{draft.label.length}/30 characters</p>
                </div>

                {/* Color */}
                <div>
                  <Label>Button Color</Label>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {PRESET_COLORS.map(c => (
                      <button key={c} type="button" onClick={() => set({ color: c })}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${draft.color === c ? "border-foreground scale-110 shadow-md" : "border-transparent"}`}
                        style={{ backgroundColor: c }} title={c} />
                    ))}
                    <label className="w-6 h-6 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-primary relative" title="Custom color">
                      <input type="color" value={draft.color} onChange={e => set({ color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                      <span className="text-[9px] text-gray-400 pointer-events-none">+</span>
                    </label>
                  </div>
                </div>

                {/* Size & Shape */}
                <div>
                  <Label className="mb-2 block">Size & Shape</Label>
                  <SizePicker
                    colspan={colspan}
                    rowspan={rowspan}
                    shape={draft.shape ?? "rect"}
                    color={draft.color}
                    onColspan={n => set({ colspan: n })}
                    onRowspan={n => set({ rowspan: n })}
                    onShape={s => set({ shape: s })}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between px-5 py-3 border-t flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onClear} className="text-destructive hover:bg-destructive/10" data-testid="btn-clear-slot">
            <Trash2 className="w-3.5 h-3.5 mr-1" />Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => isValid && onSave(draft)} disabled={!isValid} data-testid="btn-save-slot">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Small device grid preview ─────────────────────────────────────────────────
function MiniGrid({ slots, cols, buttonRadius, label, icon: Icon, allLayouts }: {
  slots: SlotData[]; cols: number; buttonRadius?: string | null;
  label: string; icon: any; allLayouts: PosLayoutSet[];
}) {
  const consumed = getConsumedPositions(slots, cols);
  const totalSlots = Math.max(slots.length, cols * Math.ceil(slots.length / cols));
  const grid = Array.from({ length: totalSlots }, (_, i) => slots.find(s => s.position === i) ?? makeEmpty(i));

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />{label} — {cols} col
      </p>
      <div className="rounded-lg border bg-gray-50 p-1.5" style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "3px" }}>
        {grid.map((slot, idx) => {
          if (consumed.has(slot.position)) return null;
          const isEmpty = slot.buttonType === "empty" || !slot.label;
          const colspan = slot.colspan ?? 1;
          const rowspan = slot.rowspan ?? 1;
          const rc = radiusClass(buttonRadius, slot.shape);
          const row = Math.floor(slot.position / cols);
          const col = slot.position % cols;
          return (
            <div
              key={idx}
              style={{
                gridColumn: `${col + 1} / span ${colspan}`,
                gridRow:    `${row + 1} / span ${rowspan}`,
                backgroundColor: isEmpty ? "#f3f4f6" : slot.color + "cc",
                height: "18px",
              }}
              className={`${rc} transition-all`}
              title={slot.label}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PosLayoutEditor() {
  const [, params] = useRoute("/pos/layouts/:id/edit");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const layoutId = params?.id ?? "";

  const { data: allLayouts = EMPTY_LAYOUTS } = useQuery<PosLayoutSet[]>({ queryKey: ["/api/pos/layouts"] });
  const { data: layoutSet, isLoading: loadingSet } = useQuery<PosLayoutSet>({
    queryKey: ["/api/pos/layouts", layoutId],
    queryFn: () => apiRequest("GET", `/api/pos/layouts/${layoutId}`).then(r => r.json()),
    enabled: !!layoutId,
  });
  const { data: savedButtons = EMPTY_BUTTONS, isLoading: loadingBtns } = useQuery<PosLayoutButton[]>({
    queryKey: ["/api/pos/layouts", layoutId, "buttons"],
    queryFn: () => apiRequest("GET", `/api/pos/layouts/${layoutId}/buttons`).then(r => r.json()),
    enabled: !!layoutId,
  });
  const { data: items = EMPTY_ITEMS } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/items"] });
  const { data: categories = EMPTY_CATEGORIES } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/categories"] });

  // Layout meta
  const [name,         setName]         = useState("");
  const [description,  setDescription]  = useState("");
  const [columns,      setColumns]      = useState(4);
  const [colsTablet,   setColsTablet]   = useState(3);
  const [colsMobile,   setColsMobile]   = useState(2);
  const [colsLarge,    setColsLarge]    = useState(6);
  const [colsTV,       setColsTV]       = useState(8);
  const [rows,         setRows]         = useState(5);
  const [buttonRadius, setButtonRadius] = useState("rounded");
  const [colorTheme,   setColorTheme]   = useState<"standard" | "light">("standard");
  const [deviceView,   setDeviceView]   = useState<"desktop" | "tablet" | "phone" | "large" | "tv">("desktop");
  const [slots,        setSlots]        = useState<SlotData[]>([]);
  const [selected,     setSelected]     = useState<number | null>(null);
  const [dirty,        setDirty]        = useState(false);
  const [draggedPos,   setDraggedPos]   = useState<number | null>(null);
  const [dragOverPos,  setDragOverPos]  = useState<number | null>(null);

  // Seed from DB
  useEffect(() => {
    if (!layoutSet) return;
    setName(layoutSet.name ?? "");
    setDescription(layoutSet.description ?? "");
    setColumns(layoutSet.columns ?? 4);
    setColsTablet((layoutSet as any).colsTablet ?? 3);
    setColsMobile((layoutSet as any).colsMobile ?? 2);
    setColsLarge((layoutSet as any).colsLarge ?? 6);
    setColsTV((layoutSet as any).colsTV ?? 8);
    setRows(layoutSet.rows ?? 5);
    setButtonRadius((layoutSet as any).buttonRadius ?? "rounded");
    setColorTheme(((layoutSet as any).colorTheme ?? "standard") === "light" ? "light" : "standard");
  }, [layoutSet]);

  useEffect(() => {
    if (!layoutSet) return;
    const cols = layoutSet.columns ?? 4;
    const declaredRows = layoutSet.rows ?? 5;
    const maxButtonPos = savedButtons.length ? Math.max(...savedButtons.map(b => b.position)) : -1;
    const neededRows = Math.ceil((maxButtonPos + 1) / cols);
    const effectiveRows = Math.max(declaredRows, neededRows);
    if (effectiveRows > declaredRows) setRows(effectiveRows);
    const total = cols * effectiveRows;
    const arr = Array.from({ length: total }, (_, i) => {
      const b = savedButtons.find(b => b.position === i);
      if (!b) return makeEmpty(i);
      return {
        position:    b.position,
        label:       b.label,
        color:       b.color ?? "#6b7280",
        buttonType:  (b.buttonType as ButtonType) ?? "empty",
        itemId:      b.itemId ?? undefined,
        categoryId:  b.categoryId ?? undefined,
        actionCode:  b.actionCode ?? undefined,
        sublayoutId: (b as any).sublayoutId ?? undefined,
        shape:       ((b as any).shape as CornerStyle) ?? "rect",
        colspan:     (b as any).colspan ?? 1,
        rowspan:     (b as any).rowspan ?? 1,
        icon:        b.icon ?? undefined,
      } as SlotData;
    });
    setSlots(arr);
    setDirty(false);
  }, [savedButtons, layoutSet]);

  const activeColumns =
    deviceView === "phone"   ? colsMobile :
    deviceView === "tablet"  ? colsTablet :
    deviceView === "large"   ? colsLarge  :
    deviceView === "tv"      ? colsTV     :
    columns;

  const saveMeta = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/pos/layouts/${layoutId}`, {
      name, description, columns, colsTablet, colsMobile, colsLarge, colsTV, rows, buttonRadius, colorTheme,
    }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/pos/layouts"] }),
  });

  const saveButtons = useMutation({
    mutationFn: () => {
      const payload = slots
        .filter(s => s.buttonType !== "empty" && s.label.trim())
        .map(s => ({ ...s, layoutSetId: layoutId }));
      return apiRequest("PUT", `/api/pos/layouts/${layoutId}/buttons`, { buttons: payload }).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/layouts", layoutId, "buttons"] });
      setDirty(false);
      toast({ title: "Layout saved" });
    },
  });

  async function handleSave() {
    await saveMeta.mutateAsync();
    await saveButtons.mutateAsync();
  }

  function updateSlot(pos: number, updated: SlotData) {
    setSlots(prev => prev.map(s => s.position === pos ? updated : s));
    setDirty(true);
  }

  function clearSlot(pos: number) {
    setSlots(prev => prev.map(s => s.position === pos ? makeEmpty(pos) : s));
    setDirty(true);
  }

  function swapSlots(posA: number, posB: number) {
    if (posA === posB) return;
    setSlots(prev => {
      const a = prev.find(s => s.position === posA);
      const b = prev.find(s => s.position === posB);
      if (!a || !b) return prev;
      return prev.map(s => {
        if (s.position === posA) return { ...b, position: posA };
        if (s.position === posB) return { ...a, position: posB };
        return s;
      });
    });
    setDirty(true);
  }

  function resizeGrid(newCols: number, newRows: number) {
    const total = newCols * newRows;
    setSlots(prev => {
      if (total > prev.length) return [...prev, ...Array.from({ length: total - prev.length }, (_, i) => makeEmpty(prev.length + i))];
      return prev.slice(0, total);
    });
    setColumns(newCols);
    setRows(newRows);
    setDirty(true);
  }

  function applyResolutionPreset(preset: ResolutionPreset) {
    if (preset.tier === "desktop") {
      resizeGrid(preset.columns, preset.rows);
      setDeviceView("desktop");
    } else {
      setColsLarge(preset.columns);
      setRows(preset.rows);
      resizeGrid(columns, preset.rows);
      setDeviceView("large");
    }
    toast({ title: `Applied ${preset.label} preset` });
  }

  const consumed = getConsumedPositions(slots, activeColumns);
  const isSaving = saveMeta.isPending || saveButtons.isPending;
  const isLoading = loadingSet || loadingBtns;

  if (isLoading) {
    return <div className="flex items-center justify-center h-full py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between px-4 py-3 border-b bg-background gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/pos/layouts")} data-testid="btn-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate leading-none">{name || "Layout Editor"}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{slots.filter(s => s.buttonType !== "empty" && s.label).length} buttons · {columns}×{rows}</p>
          </div>
          {dirty && <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-50 flex-shrink-0">Unsaved</Badge>}
        </div>

        {/* Device size selector */}
        <div className="flex items-center border rounded-lg overflow-x-auto max-w-full">
          {([
            { id: "phone",   icon: Smartphone, label: `${colsMobile} col`, title: "Phone (<640px)" },
            { id: "tablet",  icon: Tablet,     label: `${colsTablet} col`, title: "Tablet (640-1023px)" },
            { id: "desktop", icon: Monitor,    label: `${columns} col`,   title: "Desktop (1024-1919px)" },
            { id: "large",   icon: Monitor,    label: `${colsLarge} col`, title: "Large (1920-2559px)" },
            { id: "tv",      icon: Tv,         label: `${colsTV} col`,    title: "4K/TV (2560px+)" },
          ] as const).map(d => {
            const Icon = d.icon;
            const active = deviceView === d.id;
            return (
              <button
                key={d.id}
                onClick={() => setDeviceView(d.id)}
                title={d.title}
                data-testid={`device-view-${d.id}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap flex-shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"}`}
              >
                <Icon className="w-3.5 h-3.5" />{d.label}
              </button>
            );
          })}
        </div>

        <Button onClick={handleSave} disabled={isSaving} data-testid="btn-save-layout" className="flex-shrink-0">
          {isSaving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          Save Layout
        </Button>
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        {/* ── Left settings panel ─────────────────────────────────────────── */}
        <div className="w-full md:w-64 max-h-64 md:max-h-none border-b md:border-b-0 md:border-r overflow-y-auto bg-muted/10 flex-shrink-0 min-h-0">
          <div className="p-4 space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layout Info</p>
              <div>
                <Label htmlFor="layout-name" className="text-xs">Name</Label>
                <Input id="layout-name" value={name} onChange={e => { setName(e.target.value); setDirty(true); }} className="mt-1" data-testid="input-layout-name" />
              </div>
              <div>
                <Label htmlFor="layout-desc" className="text-xs">Description</Label>
                <Input id="layout-desc" value={description} onChange={e => { setDescription(e.target.value); setDirty(true); }} placeholder="Optional" className="mt-1" data-testid="input-layout-desc" />
              </div>
            </div>

            <Separator />

            {/* Responsive column config */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5" />Grid Size
              </p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs flex items-center gap-1.5 mb-1">
                    <Smartphone className="w-3 h-3" />Phone <span className="text-muted-foreground font-normal">(&lt;640px)</span>
                  </Label>
                  <Select value={String(colsMobile)} onValueChange={v => { setColsMobile(Number(v)); setDirty(true); }}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-phone-cols-top">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1.5 mb-1">
                    <Tablet className="w-3 h-3" />Tablet <span className="text-muted-foreground font-normal">(640–1023px)</span>
                  </Label>
                  <Select value={String(colsTablet)} onValueChange={v => { setColsTablet(Number(v)); setDirty(true); }}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-tablet-cols">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2,3,4,5,6].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1.5 mb-1">
                    <Monitor className="w-3 h-3" />Desktop <span className="text-muted-foreground font-normal">(1024–1919px)</span>
                  </Label>
                  <Select value={String(columns)} onValueChange={v => resizeGrid(Number(v), rows)}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-desktop-cols">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2,3,4,5,6,7,8].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1.5 mb-1">
                    <Monitor className="w-3 h-3" />Large monitor <span className="text-muted-foreground font-normal">(1920+)</span>
                  </Label>
                  <Select value={String(colsLarge)} onValueChange={v => { setColsLarge(Number(v)); setDirty(true); }}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-large-cols">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[4,5,6,7,8,9,10,12].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs flex items-center gap-1.5 mb-1">
                    <Tv className="w-3 h-3" />4K / TV <span className="text-muted-foreground font-normal">(2560px+)</span>
                  </Label>
                  <Select value={String(colsTV)} onValueChange={v => { setColsTV(Number(v)); setDirty(true); }}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-tv-cols">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[6,7,8,9,10,12,14,16].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Rows</Label>
                  <Select value={String(rows)} onValueChange={v => resizeGrid(columns, Number(v))}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-rows">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2,3,4,5,6,7,8,10,12].map(n => <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Screen resolution presets */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5" />Screen Resolution
              </p>
              <p className="text-[11px] text-muted-foreground -mt-1.5">Pick the terminal's screen resolution to pre-fill a sensible grid size.</p>
              <div className="space-y-1.5">
                {RESOLUTION_PRESETS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyResolutionPreset(p)}
                    data-testid={`resolution-${p.id}`}
                    className="w-full text-left border rounded-lg px-2.5 py-1.5 hover:bg-muted/50 transition-colors border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{p.label}</span>
                      {p.scaling && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{p.scaling}</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{p.note}</p>
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Button appearance */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Appearance</p>
              <div>
                <Label className="text-xs mb-1.5 block">Default Button Shape</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { id: "square",  label: "Square",  cls: "rounded-none" },
                    { id: "rounded", label: "Rounded", cls: "rounded-lg" },
                    { id: "round",   label: "Pill",    cls: "rounded-full" },
                  ] as const).map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setButtonRadius(s.id); setDirty(true); }}
                      data-testid={`radius-${s.id}`}
                      className={`border py-2.5 text-xs font-medium transition-all ${s.cls} ${buttonRadius === s.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Color Theme</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { id: "standard", label: "Standard", hint: "Dark · low-light" },
                    { id: "light",    label: "Light",    hint: "Well-lit" },
                  ] as const).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setColorTheme(t.id); setDirty(true); }}
                      data-testid={`theme-${t.id}`}
                      className={`border rounded-lg py-2 text-xs font-medium transition-all flex flex-col items-center gap-0.5 ${colorTheme === t.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50"}`}
                    >
                      <span className={`w-full h-3 rounded-sm ${t.id === "light" ? "bg-gray-100 border border-gray-300" : "bg-gray-900"}`} />
                      {t.label}
                      <span className="text-[9px] text-muted-foreground font-normal">{t.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            {/* Mini device previews */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responsive Preview</p>
              <MiniGrid slots={slots} cols={colsMobile} buttonRadius={buttonRadius} label="Phone"   icon={Smartphone} allLayouts={allLayouts} />
              <MiniGrid slots={slots} cols={colsTablet} buttonRadius={buttonRadius} label="Tablet"  icon={Tablet}     allLayouts={allLayouts} />
              <MiniGrid slots={slots} cols={columns}    buttonRadius={buttonRadius} label="Desktop" icon={Monitor}    allLayouts={allLayouts} />
              <MiniGrid slots={slots} cols={colsLarge}  buttonRadius={buttonRadius} label="Large"   icon={Monitor}    allLayouts={allLayouts} />
              <MiniGrid slots={slots} cols={colsTV}     buttonRadius={buttonRadius} label="4K/TV"   icon={Tv}         allLayouts={allLayouts} />
            </div>

            <Separator />

            {/* Stats */}
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Stats</p>
              {(["item","category","action","sublayout","empty"] as ButtonType[]).map(t => {
                const count = slots.filter(s => s.buttonType === t).length;
                return count > 0 ? (
                  <div key={t} className="flex items-center justify-between">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${typeChip(t)}`}>{t}</span>
                    <span>{count}</span>
                  </div>
                ) : null;
              })}
              <div className="flex items-center justify-between pt-1 border-t font-medium text-foreground">
                <span>Total slots</span><span>{slots.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Main grid ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto p-4">
          {/* Device banner */}
          <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
            {deviceView === "phone"   && <><Smartphone className="w-3.5 h-3.5" />Phone &lt;640px — {colsMobile} columns</>}
            {deviceView === "tablet"  && <><Tablet  className="w-3.5 h-3.5" />Tablet 640–1023px — {colsTablet} columns</>}
            {deviceView === "desktop" && <><Monitor className="w-3.5 h-3.5" />Desktop 1024–1919px — {columns} columns</>}
            {deviceView === "large"   && <><Monitor className="w-3.5 h-3.5" />Large monitor 1920–2559px — {colsLarge} columns</>}
            {deviceView === "tv"      && <><Tv className="w-3.5 h-3.5" />4K/TV 2560px+ — {colsTV} columns</>}
            {deviceView !== "desktop" && (
              <Badge variant="outline" className="text-[10px] ml-1">Preview only — click Desktop to edit</Badge>
            )}
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: `repeat(${activeColumns}, minmax(0, 1fr))`, gap: "8px" }}
            data-testid="layout-grid"
          >
            {slots.map(slot => {
              if (consumed.has(slot.position)) return null;
              const isEmptySlot = slot.buttonType === "empty" || !slot.label;
              return (
                <GridButton
                  key={slot.position}
                  slot={slot}
                  cols={activeColumns}
                  isSelected={selected === slot.position}
                  onClick={() => setSelected(selected === slot.position ? null : slot.position)}
                  buttonRadius={buttonRadius}
                  allLayouts={allLayouts}
                  draggable={!isEmptySlot}
                  isDragging={draggedPos === slot.position}
                  isDragOver={dragOverPos === slot.position && draggedPos !== null && draggedPos !== slot.position}
                  onDragStart={(e) => {
                    setDraggedPos(slot.position);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(slot.position));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedPos !== null && draggedPos !== slot.position) setDragOverPos(slot.position);
                  }}
                  onDragLeave={() => {
                    setDragOverPos(prev => (prev === slot.position ? null : prev));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedPos !== null && draggedPos !== slot.position) {
                      swapSlots(draggedPos, slot.position);
                      toast({ title: "Buttons swapped" });
                    }
                    setDraggedPos(null);
                    setDragOverPos(null);
                  }}
                  onDragEnd={() => {
                    setDraggedPos(null);
                    setDragOverPos(null);
                  }}
                />
              );
            })}
          </div>

          {/* Help tip */}
          <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Click any button to configure it, or <strong>drag and drop</strong> a button onto another cell to swap their positions.
              <strong>Wide/Tall/Large</strong> buttons span multiple cells.
              Use <strong>Sub-Menu</strong> type to create condiment / modifier panels (hospitality style).
              Wide + Tall buttons absorb adjacent slots automatically.
            </span>
          </div>
        </div>
      </div>

      {/* ── Button edit dialog ─────────────────────────────────────────────── */}
      {selected !== null && (
        <ButtonDialog
          slot={slots.find(s => s.position === selected) ?? makeEmpty(selected)}
          onSave={s => { updateSlot(selected, s); setSelected(null); }}
          onClear={() => { clearSlot(selected); setSelected(null); }}
          onClose={() => setSelected(null)}
          items={items}
          categories={categories}
          allLayouts={allLayouts}
          currentLayoutId={layoutId}
        />
      )}
    </div>
  );
}
