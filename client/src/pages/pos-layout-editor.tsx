import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, Save, Loader2, LayoutGrid, Trash2, Package,
  Tag, Zap, EyeOff, Settings2, RefreshCw, CheckCircle2
} from "lucide-react";
import type { PosLayoutSet, PosLayoutButton } from "@shared/schema";

const PRESET_COLORS = [
  "#6b7280", // gray
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#84cc16", // lime
];

const ACTION_OPTIONS = [
  { code: "pay_cash", label: "Pay Cash" },
  { code: "pay_card", label: "Pay Card" },
  { code: "void_sale", label: "Void Sale" },
  { code: "hold_sale", label: "Hold Sale" },
  { code: "new_sale", label: "New Sale" },
  { code: "discount", label: "Discount" },
  { code: "no_sale", label: "No Sale (Open Drawer)" },
  { code: "reprint", label: "Reprint Receipt" },
];

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

function typeIcon(type: ButtonType) {
  if (type === "item") return <Package className="w-3 h-3" />;
  if (type === "category") return <Tag className="w-3 h-3" />;
  if (type === "action") return <Zap className="w-3 h-3" />;
  return <EyeOff className="w-3 h-3" />;
}

function typeColor(type: ButtonType) {
  if (type === "item") return "bg-blue-100 text-blue-700";
  if (type === "category") return "bg-purple-100 text-purple-700";
  if (type === "action") return "bg-amber-100 text-amber-700";
  return "bg-gray-100 text-gray-400";
}

// ── Button slot on the grid ───────────────────────────────────────────────────
function GridButton({
  slot, onClick, isSelected,
}: {
  slot: SlotData;
  onClick: () => void;
  isSelected: boolean;
}) {
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
          <span className={`absolute bottom-1 left-1 text-[9px] px-1 py-0.5 rounded ${typeColor(slot.buttonType)} opacity-80`}>
            {slot.buttonType}
          </span>
        </>
      ) : (
        <span className="text-gray-300 text-xs">+</span>
      )}
      <span className="absolute top-1 right-1 text-[10px] text-white/60 font-mono">
        {slot.position + 1}
      </span>
    </button>
  );
}

// ── Button editor dialog ─────────────────────────────────────────────────────
function ButtonDialog({
  slot,
  onSave,
  onClear,
  onClose,
  items,
  categories,
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

  // Auto-fill label when item/category/action selected
  useEffect(() => {
    if (draft.buttonType === "item" && draft.itemId) {
      const item = items.find(i => i.id === draft.itemId);
      if (item && !draft.label) set({ label: item.name.slice(0, 30) });
    }
  }, [draft.itemId]);

  useEffect(() => {
    if (draft.buttonType === "category" && draft.categoryId) {
      const cat = categories.find(c => c.id === draft.categoryId);
      if (cat && !draft.label) set({ label: cat.name.slice(0, 30) });
    }
  }, [draft.categoryId]);

  useEffect(() => {
    if (draft.buttonType === "action" && draft.actionCode) {
      const act = ACTION_OPTIONS.find(a => a.code === draft.actionCode);
      if (act && !draft.label) set({ label: act.label });
    }
  }, [draft.actionCode]);

  const isValid =
    draft.buttonType === "empty" ||
    (draft.label.trim().length > 0 &&
      (draft.buttonType === "item" ? !!draft.itemId :
       draft.buttonType === "category" ? !!draft.categoryId :
       draft.buttonType === "action" ? !!draft.actionCode : true));

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-4 h-4" />
            Configure Button #{slot.position + 1}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Type tabs */}
          <div>
            <Label className="mb-2 block">Button Type</Label>
            <Tabs value={draft.buttonType} onValueChange={v => set({ buttonType: v as ButtonType, itemId: undefined, categoryId: undefined, actionCode: undefined, label: "" })}>
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="item" data-testid="tab-type-item"><Package className="w-3.5 h-3.5 mr-1" />Item</TabsTrigger>
                <TabsTrigger value="category" data-testid="tab-type-category"><Tag className="w-3.5 h-3.5 mr-1" />Category</TabsTrigger>
                <TabsTrigger value="action" data-testid="tab-type-action"><Zap className="w-3.5 h-3.5 mr-1" />Action</TabsTrigger>
                <TabsTrigger value="empty" data-testid="tab-type-empty"><EyeOff className="w-3.5 h-3.5 mr-1" />Empty</TabsTrigger>
              </TabsList>

              {/* Item picker */}
              <TabsContent value="item" className="mt-3 space-y-3">
                <div>
                  <Label>Product</Label>
                  <Select value={draft.itemId ?? ""} onValueChange={v => set({ itemId: v })}>
                    <SelectTrigger data-testid="select-item"><SelectValue placeholder="Choose a product…" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {/* Category picker */}
              <TabsContent value="category" className="mt-3 space-y-3">
                <div>
                  <Label>Category</Label>
                  <Select value={draft.categoryId ?? ""} onValueChange={v => set({ categoryId: v })}>
                    <SelectTrigger data-testid="select-category"><SelectValue placeholder="Choose a category…" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {/* Action picker */}
              <TabsContent value="action" className="mt-3 space-y-3">
                <div>
                  <Label>Action</Label>
                  <Select value={draft.actionCode ?? ""} onValueChange={v => set({ actionCode: v })}>
                    <SelectTrigger data-testid="select-action"><SelectValue placeholder="Choose an action…" /></SelectTrigger>
                    <SelectContent>
                      {ACTION_OPTIONS.map(a => <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="empty" className="mt-3">
                <p className="text-sm text-muted-foreground">This slot will appear blank on the terminal.</p>
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
                  placeholder="Short name shown on button"
                  maxLength={30}
                  data-testid="input-btn-label"
                />
                <p className="text-xs text-muted-foreground mt-1">{draft.label.length}/30 chars</p>
              </div>

              {/* Color */}
              <div>
                <Label>Button Color</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => set({ color: c })}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${draft.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                      data-testid={`color-${c}`}
                      title={c}
                    />
                  ))}
                  <label className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary" title="Custom color">
                    <input type="color" value={draft.color} onChange={e => set({ color: e.target.value })} className="opacity-0 absolute" />
                    <span className="text-[10px] text-gray-400">+</span>
                  </label>
                </div>

                {/* Preview */}
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="w-24 h-14 rounded-lg flex items-center justify-center text-white font-semibold text-xs text-center px-1 shadow"
                    style={{ backgroundColor: draft.color }}
                  >
                    {draft.label || "Preview"}
                  </div>
                  <span className="text-xs text-muted-foreground">Button preview</span>
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <Button variant="outline" size="sm" onClick={onClear} className="text-destructive hover:bg-destructive/10" data-testid="btn-clear-slot">
              <Trash2 className="w-3.5 h-3.5 mr-1" />Clear slot
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => isValid && onSave(draft)} disabled={!isValid} data-testid="btn-save-slot">
                <CheckCircle2 className="w-4 h-4 mr-1" />Apply
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main editor page ─────────────────────────────────────────────────────────
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
    select: (data: any[]) => data.map(i => ({ id: i.id, name: i.name })),
  });

  const { data: categories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/categories"],
    select: (data: any[]) => data.map(c => ({ id: c.id, name: c.name })),
  });

  // Initialize slots from existing buttons whenever layout+buttons load
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

  const resetAll = () => {
    if (!layout) return;
    const total = layout.columns * layout.rows;
    setSlots(Array.from({ length: total }, (_, i) => makeEmpty(i)));
    setDirty(true);
  };

  const filled = slots.filter(s => s.buttonType !== "empty" && s.label).length;
  const total = slots.length;
  const selectedSlot = selectedPos !== null ? slots.find(s => s.position === selectedPos) : null;

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
    <div className="flex flex-col h-full min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate("/pos/layouts")} data-testid="btn-back">
            <ArrowLeft className="w-4 h-4 mr-1" />Back
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
          {dirty && <Badge variant="secondary" className="text-xs">Unsaved changes</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={resetAll} data-testid="btn-reset-all">
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
        {/* Grid */}
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
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Click any slot to configure it · Drag-and-drop coming soon
          </p>
        </div>

        {/* Legend */}
        <div className="w-56 flex-shrink-0 space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-sm font-semibold">Legend</p>
            <div className="space-y-2 text-xs">
              {[
                { type: "item" as ButtonType, label: "Product shortcut" },
                { type: "category" as ButtonType, label: "Category filter" },
                { type: "action" as ButtonType, label: "POS action" },
                { type: "empty" as ButtonType, label: "Empty slot" },
              ].map(({ type, label }) => (
                <div key={type} className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded flex items-center gap-1 ${typeColor(type)}`}>
                    {typeIcon(type)} {type}
                  </span>
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-2 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground text-sm">Tips</p>
            <p>• Click a slot to open the button editor</p>
            <p>• Labels are truncated to 30 chars on the terminal</p>
            <p>• Category buttons filter the product list</p>
            <p>• Changes sync to terminals within 5 minutes</p>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-1 text-xs">
            <p className="font-medium">Stats</p>
            <p>Total slots: <strong>{total}</strong></p>
            <p>Configured: <strong>{filled}</strong></p>
            <p>Empty: <strong>{total - filled}</strong></p>
          </div>
        </div>
      </div>

      {/* Button config dialog */}
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
