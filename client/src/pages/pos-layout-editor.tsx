import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, Save, Loader2, LayoutGrid, Trash2, Package,
  Tag, Zap, EyeOff, Settings2, RefreshCw, CheckCircle2,
  CreditCard, Banknote, Receipt, RotateCcw, Users, Search,
  Calculator, Printer, BookOpen, ShieldAlert, Clock,
  ChevronUp, ChevronDown, AlignLeft, Wallet, Minus,
  DoorOpen, FileText, BarChart2, TrendingDown,
} from "lucide-react";
import type { PosLayoutSet, PosLayoutButton } from "@shared/schema";

// ── Color palette ─────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#1e293b", // slate-900
  "#374151", // gray-700
  "#6b7280", // gray-500
  "#ef4444", // red
  "#dc2626", // red-600
  "#f97316", // orange
  "#ea580c", // orange-600
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#16a34a", // green-600
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#1d4ed8", // blue-700
  "#8b5cf6", // violet
  "#7c3aed", // violet-700
  "#ec4899", // pink
  "#be185d", // pink-700
  "#9f1239", // rose-800 (wine)
  "#7f1d1d", // red-900 (burgundy)
  "#78350f", // amber-900 (brown)
];

// ── Comprehensive action groups ───────────────────────────────────────────────
interface ActionDef {
  code: string;
  label: string;
  icon: any;
  description?: string;
}

interface ActionGroup {
  group: string;
  icon: any;
  color: string;
  actions: ActionDef[];
}

const ACTION_GROUPS: ActionGroup[] = [
  {
    group: "Payments",
    icon: CreditCard,
    color: "text-green-600",
    actions: [
      { code: "pay_cash",      label: "Pay Cash",           icon: Banknote,    description: "Accept cash payment and calculate change" },
      { code: "pay_card",      label: "Pay Card",           icon: CreditCard,  description: "Process card via connected terminal" },
      { code: "pay_split",     label: "Split Payment",      icon: Wallet,      description: "Split across cash and card" },
      { code: "pay_account",   label: "Charge to Account",  icon: AlignLeft,   description: "Post to customer account / credit" },
      { code: "pay_voucher",   label: "Redeem Voucher",     icon: Receipt,     description: "Accept a gift voucher or coupon code" },
      { code: "pay_layaway",   label: "Layaway / Deposit",  icon: Wallet,      description: "Take partial payment, hold order" },
    ],
  },
  {
    group: "Sale Management",
    icon: Receipt,
    color: "text-blue-600",
    actions: [
      { code: "new_sale",      label: "New Sale",           icon: Receipt,     description: "Clear current order and start fresh" },
      { code: "hold_sale",     label: "Hold Sale",          icon: Receipt,     description: "Park current order, serve another customer" },
      { code: "recall_sale",   label: "Recall Held Sale",   icon: Receipt,     description: "Bring back a parked order" },
      { code: "void_line",     label: "Void Line",          icon: Minus,       description: "Remove the currently selected line" },
      { code: "void_sale",     label: "Void Sale",          icon: RotateCcw,   description: "Cancel the entire current order" },
      { code: "refund",        label: "Refund / Return",    icon: RotateCcw,   description: "Process a return against a prior sale" },
      { code: "exchange",      label: "Exchange",           icon: RotateCcw,   description: "Swap an item for another" },
      { code: "suspend_sale",  label: "Suspend Sale",       icon: Receipt,     description: "Save order without payment" },
    ],
  },
  {
    group: "Price & Quantity Modifiers",
    icon: Calculator,
    color: "text-amber-600",
    actions: [
      { code: "qty",               label: "Enter Quantity",        icon: Calculator, description: "Open numeric keypad to set line quantity" },
      { code: "discount_pct",      label: "Line Discount %",       icon: TrendingDown, description: "Apply percentage discount to selected line" },
      { code: "discount_fixed",    label: "Line Discount (Fixed)", icon: TrendingDown, description: "Apply fixed-amount discount to selected line" },
      { code: "order_discount_pct",label: "Order Discount %",      icon: TrendingDown, description: "Percentage discount on whole order" },
      { code: "price_override",    label: "Price Override",        icon: Calculator, description: "Manually set the price of a line" },
      { code: "price_check",       label: "Price Check",           icon: Search,     description: "Look up the price of an item by barcode" },
      { code: "weight",            label: "Enter Weight",          icon: Calculator, description: "Input weight for sold-by-weight items" },
    ],
  },
  {
    group: "Customer",
    icon: Users,
    color: "text-purple-600",
    actions: [
      { code: "customer_lookup",   label: "Customer Lookup",       icon: Search,     description: "Attach a customer to this order" },
      { code: "customer_clear",    label: "Clear Customer",        icon: Users,      description: "Remove customer from current order" },
      { code: "loyalty_points",    label: "Redeem Loyalty Points", icon: Users,      description: "Apply earned points as discount" },
      { code: "customer_account",  label: "Customer Balance",      icon: Wallet,     description: "Show customer account balance" },
      { code: "customer_history",  label: "Purchase History",      icon: FileText,   description: "View customer's recent purchases" },
    ],
  },
  {
    group: "Barcode & Search",
    icon: Search,
    color: "text-cyan-600",
    actions: [
      { code: "barcode_scan",   label: "Scan Barcode",         icon: Search,   description: "Activate barcode scanner input" },
      { code: "item_search",    label: "Search Items",         icon: Search,   description: "Open text search for items" },
      { code: "plu",            label: "PLU / Item Code",      icon: Search,   description: "Enter an item code directly" },
    ],
  },
  {
    group: "Cash Drawer & Journal",
    icon: DoorOpen,
    color: "text-orange-600",
    actions: [
      { code: "open_drawer",    label: "Open Drawer",          icon: DoorOpen,   description: "Pop open the cash drawer" },
      { code: "no_sale",        label: "No Sale",              icon: DoorOpen,   description: "Open drawer without a transaction" },
      { code: "cash_in",        label: "Cash In",              icon: Banknote,   description: "Record cash added to drawer (e.g. float top-up)" },
      { code: "cash_out",       label: "Cash Out",             icon: Banknote,   description: "Record cash removed from drawer (e.g. banking)" },
      { code: "petty_cash",     label: "Petty Cash",           icon: Banknote,   description: "Record a petty cash expense from drawer" },
      { code: "declare_cash",   label: "Declare Cash",         icon: Banknote,   description: "Count and declare the cash in drawer at shift end" },
    ],
  },
  {
    group: "Receipt & Print",
    icon: Printer,
    color: "text-gray-600",
    actions: [
      { code: "print_receipt",  label: "Print Receipt",        icon: Printer,  description: "Print receipt for last or current sale" },
      { code: "reprint",        label: "Reprint Receipt",      icon: Printer,  description: "Reprint the last printed receipt" },
      { code: "email_receipt",  label: "Email Receipt",        icon: Receipt,  description: "Send receipt to customer via email" },
      { code: "gift_receipt",   label: "Gift Receipt",         icon: Receipt,  description: "Print receipt without prices" },
    ],
  },
  {
    group: "Shift & Reports",
    icon: BarChart2,
    color: "text-indigo-600",
    actions: [
      { code: "clock_in",      label: "Clock In",             icon: Clock,      description: "Cashier clocks in at start of shift" },
      { code: "clock_out",     label: "Clock Out",            icon: Clock,      description: "Cashier clocks out at end of shift" },
      { code: "report_x",      label: "X Report (Interim)",   icon: BarChart2,  description: "Print mid-shift sales summary without resetting" },
      { code: "report_z",      label: "Z Report (End of Day)",icon: BarChart2,  description: "Print end-of-day report and reset counters" },
      { code: "shift_start",   label: "Start Shift",          icon: Clock,      description: "Open a new cashier shift" },
      { code: "shift_end",     label: "End Shift",            icon: Clock,      description: "Close current shift" },
    ],
  },
  {
    group: "Accounting / Journal",
    icon: BookOpen,
    color: "text-rose-600",
    actions: [
      { code: "journal_cash_in",   label: "Journal: Cash In",    icon: BookOpen,  description: "Post a cash-in journal entry to accounting" },
      { code: "journal_cash_out",  label: "Journal: Cash Out",   icon: BookOpen,  description: "Post a cash-out journal entry to accounting" },
      { code: "journal_expense",   label: "Journal: Expense",    icon: BookOpen,  description: "Record a petty-cash expense in the ledger" },
      { code: "journal_correction",label: "Journal: Correction", icon: BookOpen,  description: "Post a manual correction entry" },
      { code: "vat_summary",       label: "VAT Summary",         icon: FileText,  description: "Show VAT collected for current shift" },
    ],
  },
  {
    group: "Navigation & Display",
    icon: LayoutGrid,
    color: "text-slate-600",
    actions: [
      { code: "page_up",         label: "Page Up",              icon: ChevronUp,    description: "Scroll the product grid up one page" },
      { code: "page_down",       label: "Page Down",            icon: ChevronDown,  description: "Scroll the product grid down one page" },
      { code: "show_all_items",  label: "Show All Items",       icon: LayoutGrid,   description: "Clear category filter — show everything" },
      { code: "numpad",          label: "Numeric Keypad",       icon: Calculator,   description: "Open the numeric input pad" },
      { code: "notes",           label: "Add Order Note",       icon: AlignLeft,    description: "Attach a free-text note to the order" },
    ],
  },
  {
    group: "Manager & Security",
    icon: ShieldAlert,
    color: "text-red-700",
    actions: [
      { code: "manager_override", label: "Manager Override",    icon: ShieldAlert, description: "Prompt for manager PIN to authorise action" },
      { code: "lock_terminal",    label: "Lock Terminal",       icon: ShieldAlert, description: "Lock screen — requires PIN to resume" },
      { code: "change_cashier",   label: "Change Cashier",      icon: Users,       description: "Switch to a different cashier without closing sale" },
      { code: "admin_menu",       label: "Admin Menu",          icon: Settings2,   description: "Access terminal administration options" },
    ],
  },
];

// flat lookup for auto-label
const ALL_ACTIONS = ACTION_GROUPS.flatMap(g => g.actions);

type ButtonType = "item" | "category" | "action" | "empty";

interface SlotData {
  position: number;
  label: string;
  color: string;
  buttonType: ButtonType;
  itemId?: string;
  categoryId?: string;
  actionCode?: string;
  icon?: string;
}

function makeEmpty(position: number): SlotData {
  return { position, label: "", color: "#6b7280", buttonType: "empty" };
}

function typeChip(type: ButtonType) {
  const map: Record<ButtonType, string> = {
    item: "bg-blue-100 text-blue-700",
    category: "bg-purple-100 text-purple-700",
    action: "bg-amber-100 text-amber-700",
    empty: "bg-gray-100 text-gray-400",
  };
  return map[type];
}

// ── Grid button ───────────────────────────────────────────────────────────────
function GridButton({ slot, onClick, isSelected }: { slot: SlotData; onClick: () => void; isSelected: boolean }) {
  const isEmpty = slot.buttonType === "empty" || !slot.label;
  return (
    <button
      onClick={onClick}
      data-testid={`grid-btn-${slot.position}`}
      className={`
        relative flex flex-col items-center justify-center rounded-lg border-2
        text-center transition-all h-20 select-none overflow-hidden
        ${isSelected ? "ring-2 ring-primary ring-offset-2" : "hover:opacity-90"}
        ${isEmpty ? "border-dashed border-gray-200 bg-gray-50 hover:border-primary/40" : "border-transparent shadow-sm"}
      `}
      style={isEmpty ? {} : { backgroundColor: slot.color + "dd", borderColor: slot.color }}
    >
      {!isEmpty ? (
        <>
          <span className="text-white font-semibold text-xs leading-tight px-1 max-h-12 overflow-hidden break-words line-clamp-3">
            {slot.label}
          </span>
          <span className={`absolute bottom-1 left-1 text-[9px] px-1 py-0.5 rounded ${typeChip(slot.buttonType)} opacity-80`}>
            {slot.buttonType}
          </span>
        </>
      ) : (
        <span className="text-gray-300 text-xs">+</span>
      )}
      <span className="absolute top-0.5 right-1 text-[9px] text-white/50 font-mono">{slot.position + 1}</span>
    </button>
  );
}

// ── Action group picker ───────────────────────────────────────────────────────
function ActionGroupPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    if (!value) return ACTION_GROUPS[0].group;
    const g = ACTION_GROUPS.find(g => g.actions.some(a => a.code === value));
    return g?.group ?? ACTION_GROUPS[0].group;
  });

  return (
    <div className="border rounded-lg overflow-hidden">
      {ACTION_GROUPS.map(group => {
        const GroupIcon = group.icon;
        const isOpen = openGroup === group.group;
        const selectedInGroup = group.actions.find(a => a.code === value);
        return (
          <div key={group.group}>
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : group.group)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium border-b transition-colors ${
                isOpen ? "bg-muted/60" : "bg-background hover:bg-muted/30"
              }`}
            >
              <span className="flex items-center gap-2">
                <GroupIcon className={`w-4 h-4 ${group.color}`} />
                {group.group}
                {selectedInGroup && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                    {selectedInGroup.label}
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground text-xs">{group.actions.length}</span>
            </button>
            {isOpen && (
              <div className="divide-y bg-muted/20">
                {group.actions.map(action => {
                  const ActionIcon = action.icon;
                  const isSelected = value === action.code;
                  return (
                    <button
                      key={action.code}
                      type="button"
                      onClick={() => onChange(action.code)}
                      data-testid={`action-${action.code}`}
                      className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <ActionIcon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-none">{action.label}</p>
                        {action.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{action.description}</p>
                        )}
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 ml-auto mt-0.5" />}
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

// ── Button editor dialog ──────────────────────────────────────────────────────
function ButtonDialog({
  slot, onSave, onClear, onClose, items, categories,
}: {
  slot: SlotData;
  onSave: (s: SlotData) => void;
  onClear: () => void;
  onClose: () => void;
  items: { id: string; name: string }[];
  categories: { id: string; name: string }[];
}) {
  const [draft, setDraft] = useState<SlotData>({ ...slot });
  const set = (patch: Partial<SlotData>) => setDraft(d => ({ ...d, ...patch }));
  const [itemSearch, setItemSearch] = useState("");

  // Auto-fill label on selection
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
      const act = ALL_ACTIONS.find(a => a.code === draft.actionCode);
      if (act) set({ label: act.label });
    }
  }, [draft.actionCode]);

  const filteredItems = itemSearch
    ? items.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase())).slice(0, 50)
    : items.slice(0, 80);

  const isValid =
    draft.buttonType === "empty" ||
    (draft.label.trim().length > 0 &&
      (draft.buttonType === "item" ? !!draft.itemId :
       draft.buttonType === "category" ? !!draft.categoryId :
       draft.buttonType === "action" ? !!draft.actionCode : true));

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Configure Button #{slot.position + 1}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          {/* Type selector */}
          <div>
            <Label className="mb-2 block text-sm">Button Type</Label>
            <Tabs
              value={draft.buttonType}
              onValueChange={v => set({ buttonType: v as ButtonType, itemId: undefined, categoryId: undefined, actionCode: undefined, label: "" })}
            >
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="item" data-testid="tab-type-item">
                  <Package className="w-3.5 h-3.5 mr-1" />Product
                </TabsTrigger>
                <TabsTrigger value="category" data-testid="tab-type-category">
                  <Tag className="w-3.5 h-3.5 mr-1" />Category
                </TabsTrigger>
                <TabsTrigger value="action" data-testid="tab-type-action">
                  <Zap className="w-3.5 h-3.5 mr-1" />Function
                </TabsTrigger>
                <TabsTrigger value="empty" data-testid="tab-type-empty">
                  <EyeOff className="w-3.5 h-3.5 mr-1" />Empty
                </TabsTrigger>
              </TabsList>

              {/* Product picker */}
              <TabsContent value="item" className="mt-3 space-y-2">
                <Input
                  placeholder="Search products…"
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  data-testid="input-item-search"
                  className="mb-1"
                />
                <ScrollArea className="h-48 border rounded-md">
                  <div className="p-1">
                    {filteredItems.map(i => (
                      <button
                        key={i.id}
                        type="button"
                        onClick={() => set({ itemId: i.id })}
                        data-testid={`item-option-${i.id}`}
                        className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between transition-colors ${
                          draft.itemId === i.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60"
                        }`}
                      >
                        <span className="truncate">{i.name}</span>
                        {draft.itemId === i.id && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                      </button>
                    ))}
                    {filteredItems.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
                    )}
                  </div>
                </ScrollArea>
                <p className="text-xs text-muted-foreground">{items.length} products available</p>
              </TabsContent>

              {/* Category picker */}
              <TabsContent value="category" className="mt-3">
                <div className="grid grid-cols-2 gap-1.5">
                  {categories.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => set({ categoryId: c.id })}
                      data-testid={`cat-option-${c.id}`}
                      className={`text-left px-3 py-2 rounded border text-sm transition-colors ${
                        draft.categoryId === c.id
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </TabsContent>

              {/* Function / action picker */}
              <TabsContent value="action" className="mt-3">
                <ScrollArea className="h-72">
                  <ActionGroupPicker
                    value={draft.actionCode ?? ""}
                    onChange={code => set({ actionCode: code })}
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="empty" className="mt-3">
                <p className="text-sm text-muted-foreground">This slot will appear blank on the terminal — useful for visual spacing.</p>
              </TabsContent>
            </Tabs>
          </div>

          {draft.buttonType !== "empty" && (
            <>
              {/* Label */}
              <div>
                <Label htmlFor="btn-label">Button Label</Label>
                <Input
                  id="btn-label"
                  value={draft.label}
                  onChange={e => set({ label: e.target.value })}
                  placeholder="Text shown on the button"
                  maxLength={30}
                  data-testid="input-btn-label"
                />
                <p className="text-xs text-muted-foreground mt-1">{draft.label.length}/30 characters</p>
              </div>

              {/* Color */}
              <div>
                <Label>Button Color</Label>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set({ color: c })}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        draft.color === c ? "border-foreground scale-110 shadow-md" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                  <label
                    className="w-7 h-7 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-primary relative"
                    title="Custom color"
                  >
                    <input
                      type="color"
                      value={draft.color}
                      onChange={e => set({ color: e.target.value })}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                    <span className="text-[9px] text-gray-400 pointer-events-none">+</span>
                  </label>
                </div>

                {/* Live preview */}
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="w-28 h-16 rounded-lg flex items-center justify-center text-white font-semibold text-xs text-center px-2 shadow-sm leading-tight"
                    style={{ backgroundColor: draft.color }}
                  >
                    {draft.label || "Preview"}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Hex: <code className="bg-muted px-1 rounded">{draft.color}</code></p>
                    <p>Type: <span className={`px-1 py-0.5 rounded text-[10px] ${typeChip(draft.buttonType)}`}>{draft.buttonType}</span></p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex justify-between pt-3 border-t flex-shrink-0">
          <Button variant="outline" size="sm" onClick={onClear} className="text-destructive hover:bg-destructive/10" data-testid="btn-clear-slot">
            <Trash2 className="w-3.5 h-3.5 mr-1" />Clear Slot
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => isValid && onSave(draft)} disabled={!isValid} data-testid="btn-save-slot">
              <CheckCircle2 className="w-4 h-4 mr-1.5" />Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────
export default function PosLayoutEditor() {
  const [, params] = useRoute("/pos/layouts/:id/edit");
  const [, navigate] = useLocation();
  const layoutId = params?.id ?? "";
  const { toast } = useToast();

  const [slots, setSlots] = useState<SlotData[]>([]);
  const [selectedPos, setSelectedPos] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: layout, isLoading: loadingLayout } = useQuery<PosLayoutSet>({
    queryKey: ["/api/pos/layouts", layoutId],
    queryFn: async () => {
      const res = await fetch(`/api/pos/layouts`);
      const all: PosLayoutSet[] = await res.json();
      return all.find(l => l.id === layoutId)!;
    },
    enabled: !!layoutId,
  });

  const { data: existingButtons = [], isLoading: loadingButtons } = useQuery<PosLayoutButton[]>({
    queryKey: ["/api/pos/layouts", layoutId, "buttons"],
    queryFn: async () => {
      const res = await fetch(`/api/pos/layouts/${layoutId}/buttons`);
      return res.json();
    },
    enabled: !!layoutId,
  });

  const { data: items = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/items"],
    select: (data: any[]) => data.map(i => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name)),
  });

  const { data: categories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/categories"],
    select: (data: any[]) => data.map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
  });

  // Build grid from saved buttons
  useEffect(() => {
    if (!layout) return;
    const total = layout.columns * layout.rows;
    const grid: SlotData[] = Array.from({ length: total }, (_, i) => makeEmpty(i));
    for (const b of existingButtons) {
      if (b.position >= 0 && b.position < total) {
        grid[b.position] = {
          position: b.position,
          label: b.label,
          color: b.color ?? "#6b7280",
          buttonType: (b.buttonType ?? "empty") as ButtonType,
          itemId: b.itemId ?? undefined,
          categoryId: b.categoryId ?? undefined,
          actionCode: b.actionCode ?? undefined,
          icon: b.icon ?? undefined,
        };
      }
    }
    setSlots(grid);
    setDirty(false);
  }, [layout, existingButtons]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nonEmpty = slots.filter(s => s.buttonType !== "empty" && s.label.trim());
      const res = await apiRequest("PUT", `/api/pos/layouts/${layoutId}/buttons`, { buttons: nonEmpty });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/layouts", layoutId, "buttons"] });
      setDirty(false);
      toast({ title: "Layout saved", description: "Changes will sync to terminals within 5 minutes." });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateSlot = useCallback((updated: SlotData) => {
    setSlots(prev => prev.map(s => s.position === updated.position ? updated : s));
    setDirty(true);
    setSelectedPos(null);
  }, []);

  const clearSlot = useCallback((position: number) => {
    setSlots(prev => prev.map(s => s.position === position ? makeEmpty(position) : s));
    setDirty(true);
    setSelectedPos(null);
  }, []);

  const selectedSlot = selectedPos !== null ? slots.find(s => s.position === selectedPos) : null;
  const filled = slots.filter(s => s.buttonType !== "empty" && s.label).length;
  const total = slots.length;

  if (loadingLayout || loadingButtons) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!layout) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>Layout not found.</p>
        <Button variant="link" onClick={() => navigate("/pos/layouts")}>← Back to Layouts</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate("/pos/layouts")} data-testid="btn-back">
            <ArrowLeft className="w-4 h-4 mr-1" />Layouts
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="min-w-0">
            <h1 className="font-semibold truncate flex items-center gap-1.5">
              <LayoutGrid className="w-4 h-4 text-primary flex-shrink-0" />
              {layout.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {layout.columns} × {layout.rows} grid · {filled}/{total} buttons configured
            </p>
          </div>
          {dirty && <Badge variant="secondary" className="text-xs animate-pulse">Unsaved</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost" size="sm"
            onClick={() => {
              if (!layout) return;
              setSlots(Array.from({ length: layout.columns * layout.rows }, (_, i) => makeEmpty(i)));
              setDirty(true);
            }}
            data-testid="btn-reset-all"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />Clear All
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dirty}
            data-testid="btn-save-layout"
          >
            {saveMutation.isPending
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Save className="w-4 h-4 mr-2" />
            }
            Save Layout
          </Button>
        </div>
      </div>

      <div className="flex flex-1 gap-6 p-6">
        {/* Button grid */}
        <div className="flex-1">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}
            data-testid="layout-grid"
          >
            {slots.map(slot => (
              <GridButton
                key={slot.position}
                slot={slot}
                isSelected={selectedPos === slot.position}
                onClick={() => setSelectedPos(selectedPos === slot.position ? null : slot.position)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">Click any slot to configure it</p>
        </div>

        {/* Sidebar info */}
        <div className="w-56 flex-shrink-0 space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-semibold">Button Types</p>
            <div className="space-y-1.5 text-xs">
              {([
                ["item", "Product shortcut — adds item to order instantly"],
                ["category", "Filter the product list to a category"],
                ["action", "POS function (pay, discount, open drawer…)"],
                ["empty", "Blank spacer slot"],
              ] as const).map(([type, desc]) => (
                <div key={type} className="flex items-start gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] flex-shrink-0 ${typeChip(type)}`}>{type}</span>
                  <span className="text-muted-foreground leading-snug">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground text-sm">Function groups</p>
            {ACTION_GROUPS.map(g => {
              const GIcon = g.icon;
              return (
                <div key={g.group} className="flex items-center gap-1.5">
                  <GIcon className={`w-3 h-3 ${g.color}`} />
                  <span>{g.group} ({g.actions.length})</span>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-0.5">
            <p className="font-medium text-sm mb-1">Stats</p>
            <p>Total slots: <strong>{total}</strong></p>
            <p>Configured: <strong>{filled}</strong></p>
            <p>Empty: <strong>{total - filled}</strong></p>
          </div>
        </div>
      </div>

      {/* Config dialog */}
      {selectedPos !== null && selectedSlot && (
        <ButtonDialog
          slot={selectedSlot}
          onSave={updateSlot}
          onClear={() => clearSlot(selectedPos)}
          onClose={() => setSelectedPos(null)}
          items={items}
          categories={categories}
        />
      )}
    </div>
  );
}
