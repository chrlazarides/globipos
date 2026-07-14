import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import JsBarcode from "jsbarcode";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Printer, Trash2, Plus, Minus, Barcode as BarcodeIcon, Tag, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Item, ItemVariant } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface QueueLine {
  key: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  qty: number;
}

type PrintMode = "thermal" | "a4";

interface ThermalPreset { id: string; label: string; w: number; h: number }
interface A4Preset { id: string; label: string; cols: number; rows: number; labelW: number; labelH: number; marginTop: number; marginLeft: number; gapX: number; gapY: number }

const THERMAL_PRESETS: ThermalPreset[] = [
  { id: "40x30", label: "40 × 30 mm", w: 40, h: 30 },
  { id: "50x30", label: "50 × 30 mm", w: 50, h: 30 },
  { id: "58x40", label: "58 × 40 mm", w: 58, h: 40 },
  { id: "60x40", label: "60 × 40 mm", w: 60, h: 40 },
  { id: "custom", label: "Custom size…", w: 50, h: 30 },
];

const A4_PRESETS: A4Preset[] = [
  { id: "3x8", label: "3 × 8 (24/sheet) — 64.6 × 33.8 mm", cols: 3, rows: 8, labelW: 64.6, labelH: 33.8, marginTop: 12.9, marginLeft: 7.1, gapX: 2.5, gapY: 0 },
  { id: "3x7", label: "3 × 7 (21/sheet) — 63.5 × 38.1 mm", cols: 3, rows: 7, labelW: 63.5, labelH: 38.1, marginTop: 15.1, marginLeft: 7.2, gapX: 2.5, gapY: 0 },
  { id: "2x7", label: "2 × 7 (14/sheet) — 99.1 × 38.1 mm", cols: 2, rows: 7, labelW: 99.1, labelH: 38.1, marginTop: 15.1, marginLeft: 4.7, gapX: 2.5, gapY: 0 },
  { id: "4x10", label: "4 × 10 (40/sheet) — 48.5 × 25.4 mm", cols: 4, rows: 10, labelW: 48.5, labelH: 25.4, marginTop: 21.5, marginLeft: 8, gapX: 0, gapY: 0 },
];

function detectFormat(code: string): string {
  if (/^\d{13}$/.test(code)) return "EAN13";
  if (/^\d{8}$/.test(code)) return "EAN8";
  return "CODE128";
}

function barcodeDataUrl(code: string, heightPx: number): string | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, code, {
      format: detectFormat(code),
      displayValue: false,
      height: heightPx,
      width: 2,
      margin: 0,
    });
    return canvas.toDataURL("image/png");
  } catch {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, code, { format: "CODE128", displayValue: false, height: heightPx, width: 2, margin: 0 });
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }
}

function variantLabel(v: ItemVariant, itemName: string): string {
  const parts = [v.option1Value, v.option2Value, v.option3Value].filter(Boolean);
  return parts.length ? `${itemName} — ${parts.join(" / ")}` : itemName;
}

// ── Live preview of a single label ────────────────────────────────────────────
function LabelPreview({ line, opts }: { line: QueueLine | undefined; opts: FieldOpts & { w: number; h: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !line?.barcode) return;
    try {
      JsBarcode(ref.current, line.barcode, {
        format: detectFormat(line.barcode),
        displayValue: false,
        height: 40,
        width: 1.6,
        margin: 0,
      });
    } catch {
      try { JsBarcode(ref.current, line.barcode, { format: "CODE128", displayValue: false, height: 40, width: 1.6, margin: 0 }); } catch { /* ignore */ }
    }
  }, [line?.barcode]);

  if (!line) {
    return <div className="border-2 border-dashed rounded-md flex items-center justify-center text-xs text-muted-foreground h-32">Add an item to preview its label</div>;
  }
  const scale = 3.2; // mm → px approx for preview
  return (
    <div
      className="border rounded-md bg-white text-black mx-auto flex flex-col items-center justify-center overflow-hidden px-1"
      style={{ width: opts.w * scale, height: opts.h * scale }}
      data-testid="label-preview"
    >
      {opts.showName && <div className="text-[10px] font-semibold leading-tight text-center truncate w-full">{line.name}</div>}
      {opts.showSku && line.sku && <div className="text-[9px] leading-tight">{line.sku}</div>}
      <canvas ref={ref} className="max-w-full" style={{ maxHeight: opts.h * scale * 0.45 }} />
      {opts.showBarcodeText && <div className="text-[9px] tracking-wider leading-tight">{line.barcode}</div>}
      {opts.showPrice && <div className="text-[11px] font-bold leading-tight">€{Number(line.price || 0).toFixed(2)}</div>}
    </div>
  );
}

interface FieldOpts { showName: boolean; showSku: boolean; showPrice: boolean; showBarcodeText: boolean }

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BarcodeLabelsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueLine[]>([]);
  const [mode, setMode] = useState<PrintMode>("thermal");
  const [thermalPresetId, setThermalPresetId] = useState("50x30");
  const [customW, setCustomW] = useState(50);
  const [customH, setCustomH] = useState(30);
  const [a4PresetId, setA4PresetId] = useState("3x8");
  const [priceLevel, setPriceLevel] = useState("1");
  const [fields, setFields] = useState<FieldOpts>({ showName: true, showSku: false, showPrice: true, showBarcodeText: true });
  const [expandItemId, setExpandItemId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: variants = [], isLoading: variantsLoading } = useQuery<ItemVariant[]>({
    queryKey: ["/api/items", expandItemId, "variants"],
    enabled: !!expandItemId,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 30);
    return items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.sku ?? "").toLowerCase().includes(q) ||
      (i.barcode ?? "").toLowerCase().includes(q)
    ).slice(0, 30);
  }, [items, search]);

  const priceOf = (obj: { [k: string]: any }, parent?: Item) => {
    const key = `price${priceLevel}`;
    return String(obj[key] ?? parent?.[key as keyof Item] ?? obj.price1 ?? parent?.price1 ?? "0");
  };

  function addLine(line: Omit<QueueLine, "qty">) {
    if (!line.barcode) {
      toast({ title: "No barcode", description: `${line.name} has no barcode set`, variant: "destructive" });
      return;
    }
    setQueue(prev => {
      const existing = prev.find(l => l.key === line.key);
      if (existing) return prev.map(l => l.key === line.key ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, { ...line, qty: 1 }];
    });
  }

  function addItem(item: Item) {
    if (item.hasVariants) {
      setExpandItemId(expandItemId === item.id ? null : item.id);
      return;
    }
    addLine({ key: item.id, name: item.name, sku: item.sku ?? "", barcode: item.barcode ?? "", price: priceOf(item) });
  }

  function setQty(key: string, qty: number) {
    setQueue(prev => qty <= 0 ? prev.filter(l => l.key !== key) : prev.map(l => l.key === key ? { ...l, qty } : l));
  }

  const totalLabels = queue.reduce((s, l) => s + l.qty, 0);

  const thermal = THERMAL_PRESETS.find(p => p.id === thermalPresetId)!;
  const labelW = thermalPresetId === "custom" ? customW : thermal.w;
  const labelH = thermalPresetId === "custom" ? customH : thermal.h;
  const a4 = A4_PRESETS.find(p => p.id === a4PresetId)!;

  const previewDims = mode === "thermal" ? { w: labelW, h: labelH } : { w: a4.labelW, h: a4.labelH };

  function labelHtml(line: QueueLine, img: string, w: number, h: number): string {
    const nameFs = Math.max(6, Math.min(9, w / 7));
    return `<div class="lbl" style="width:${w}mm;height:${h}mm;">
      ${fields.showName ? `<div class="nm" style="font-size:${nameFs}pt">${escapeHtml(line.name)}</div>` : ""}
      ${fields.showSku && line.sku ? `<div class="sk">${escapeHtml(line.sku)}</div>` : ""}
      <img src="${img}" style="max-width:${w - 4}mm;max-height:${h * 0.42}mm;" />
      ${fields.showBarcodeText ? `<div class="bc">${escapeHtml(line.barcode)}</div>` : ""}
      ${fields.showPrice ? `<div class="pr">€${Number(line.price || 0).toFixed(2)}</div>` : ""}
    </div>`;
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function handlePrint() {
    if (queue.length === 0) {
      toast({ title: "Nothing to print", description: "Add items to the print queue first" });
      return;
    }
    const imgs = new Map<string, string>();
    for (const line of queue) {
      if (!imgs.has(line.barcode)) {
        const url = barcodeDataUrl(line.barcode, 60);
        if (!url) {
          toast({ title: "Invalid barcode", description: `Cannot render "${line.barcode}" (${line.name})`, variant: "destructive" });
          return;
        }
        imgs.set(line.barcode, url);
      }
    }

    const flat: QueueLine[] = [];
    for (const line of queue) for (let i = 0; i < line.qty; i++) flat.push(line);

    let body = "";
    let pageCss = "";
    const common = `
      .lbl{display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;box-sizing:border-box;padding:1mm;text-align:center;}
      .nm{font-weight:600;line-height:1.05;max-height:2.2em;overflow:hidden;width:100%;}
      .sk{font-size:6.5pt;line-height:1.1;}
      .bc{font-size:6.5pt;letter-spacing:.06em;line-height:1.15;}
      .pr{font-size:9pt;font-weight:700;line-height:1.1;}
      body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;}
      img{display:block;}`;

    if (mode === "thermal") {
      pageCss = `@page{size:${labelW}mm ${labelH}mm;margin:0;}`;
      body = flat.map(l => `<div class="pg">${labelHtml(l, imgs.get(l.barcode)!, labelW, labelH)}</div>`).join("");
      pageCss += `.pg{page-break-after:always;width:${labelW}mm;height:${labelH}mm;overflow:hidden;}`;
    } else {
      pageCss = `@page{size:A4;margin:0;}
        .sheet{width:210mm;height:296mm;page-break-after:always;position:relative;box-sizing:border-box;padding:${a4.marginTop}mm 0 0 ${a4.marginLeft}mm;}
        .grid{display:grid;grid-template-columns:repeat(${a4.cols},${a4.labelW}mm);grid-auto-rows:${a4.labelH}mm;column-gap:${a4.gapX}mm;row-gap:${a4.gapY}mm;}`;
      const perSheet = a4.cols * a4.rows;
      const sheets: string[] = [];
      for (let i = 0; i < flat.length; i += perSheet) {
        const chunk = flat.slice(i, i + perSheet);
        sheets.push(`<div class="sheet"><div class="grid">${chunk.map(l => labelHtml(l, imgs.get(l.barcode)!, a4.labelW, a4.labelH)).join("")}</div></div>`);
      }
      body = sheets.join("");
    }

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      toast({ title: "Popup blocked", description: "Allow popups to print labels", variant: "destructive" });
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels</title><style>${pageCss}${common}</style></head><body>${body}<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>`);
    w.document.close();
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarcodeIcon className="w-6 h-6" /> Barcode Labels</h1>
          <p className="text-sm text-muted-foreground">Design and print barcode price labels — thermal roll or A4 sticker sheets</p>
        </div>
        <Button onClick={handlePrint} disabled={totalLabels === 0} data-testid="button-print-labels">
          <Printer className="w-4 h-4 mr-2" /> Print {totalLabels > 0 ? `${totalLabels} label${totalLabels > 1 ? "s" : ""}` : "labels"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Item picker */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Pick items</CardTitle>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input placeholder="Search name, SKU, or barcode…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8" data-testid="input-search-items" />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[520px] overflow-y-auto">
            {isLoading && <p className="text-sm text-muted-foreground">Loading items…</p>}
            {filtered.map(item => (
              <div key={item.id}>
                <button
                  onClick={() => addItem(item)}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted flex items-center justify-between gap-2 text-sm"
                  data-testid={`row-pick-item-${item.id}`}
                >
                  <span className="truncate">
                    {item.name}
                    {item.hasVariants && <Badge variant="secondary" className="ml-1.5 text-[10px]">variants</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0 font-mono">{item.barcode || (item.hasVariants ? "" : "no barcode")}</span>
                </button>
                {item.hasVariants && expandItemId === item.id && (
                  <div className="ml-3 border-l pl-2 space-y-0.5 py-1">
                    {variantsLoading && <p className="text-xs text-muted-foreground px-2">Loading variants…</p>}
                    {!variantsLoading && variants.length === 0 && <p className="text-xs text-muted-foreground px-2">No variants found</p>}
                    {variants.map(v => (
                      <button
                        key={v.id}
                        onClick={() => addLine({ key: v.id, name: variantLabel(v, item.name), sku: v.sku ?? "", barcode: v.barcode ?? "", price: priceOf(v as any, item) })}
                        className="w-full text-left px-2 py-1 rounded hover:bg-muted flex items-center justify-between gap-2 text-xs"
                        data-testid={`row-pick-variant-${v.id}`}
                      >
                        <span className="truncate">{[v.option1Value, v.option2Value, v.option3Value].filter(Boolean).join(" / ") || v.sku}</span>
                        <span className="font-mono text-muted-foreground flex-shrink-0">{v.barcode || "no barcode"}</span>
                      </button>
                    ))}
                    {variants.length > 0 && (
                      <Button
                        variant="ghost" size="sm" className="w-full h-7 text-xs"
                        onClick={() => variants.forEach(v => v.barcode && addLine({ key: v.id, name: variantLabel(v, item.name), sku: v.sku ?? "", barcode: v.barcode ?? "", price: priceOf(v as any, item) }))}
                        data-testid={`button-add-all-variants-${item.id}`}
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add all variants
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {!isLoading && filtered.length === 0 && <p className="text-sm text-muted-foreground">No items match</p>}
          </CardContent>
        </Card>

        {/* Print queue */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">2. Print queue <Badge variant="outline" className="ml-1">{totalLabels}</Badge></CardTitle>
            {queue.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setQueue([])} data-testid="button-clear-queue">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2 max-h-[520px] overflow-y-auto">
            {queue.length === 0 && <p className="text-sm text-muted-foreground">Click items on the left to add them here.</p>}
            {queue.map(l => (
              <div key={l.key} className="border rounded-md px-2 py-1.5 flex items-center gap-2" data-testid={`row-queue-${l.key}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{l.barcode} · €{Number(l.price || 0).toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => setQty(l.key, l.qty - 1)} data-testid={`button-qty-minus-${l.key}`}><Minus className="w-3 h-3" /></Button>
                  <Input
                    type="number" min={1} value={l.qty}
                    onChange={e => setQty(l.key, Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-6 w-14 text-center px-1"
                    data-testid={`input-qty-${l.key}`}
                  />
                  <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => setQty(l.key, l.qty + 1)} data-testid={`button-qty-plus-${l.key}`}><Plus className="w-3 h-3" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setQty(l.key, 0)} data-testid={`button-remove-${l.key}`}><X className="w-3 h-3" /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Label design */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3. Label layout</CardTitle>
            <CardDescription>Choose printer type, size, and what to show</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={v => setMode(v as PrintMode)}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="thermal" data-testid="tab-thermal">Thermal roll</TabsTrigger>
                <TabsTrigger value="a4" data-testid="tab-a4">A4 sheet</TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === "thermal" ? (
              <div className="space-y-2">
                <Label className="text-xs">Label size</Label>
                <Select value={thermalPresetId} onValueChange={setThermalPresetId}>
                  <SelectTrigger data-testid="select-thermal-size"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {THERMAL_PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {thermalPresetId === "custom" && (
                  <div className="flex gap-2 items-center">
                    <Input type="number" min={20} max={150} value={customW} onChange={e => setCustomW(Number(e.target.value) || 50)} className="w-20" data-testid="input-custom-width" />
                    <span className="text-xs text-muted-foreground">×</span>
                    <Input type="number" min={15} max={150} value={customH} onChange={e => setCustomH(Number(e.target.value) || 30)} className="w-20" data-testid="input-custom-height" />
                    <span className="text-xs text-muted-foreground">mm</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Sheet layout</Label>
                <Select value={a4PresetId} onValueChange={setA4PresetId}>
                  <SelectTrigger data-testid="select-a4-layout"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {A4_PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Price level</Label>
              <Select value={priceLevel} onValueChange={setPriceLevel}>
                <SelectTrigger data-testid="select-price-level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map(n => <SelectItem key={n} value={n}>Price {n}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Applies to items added after changing the level.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Show on label</Label>
              {([
                ["showName", "Item name"],
                ["showSku", "SKU"],
                ["showBarcodeText", "Barcode number"],
                ["showPrice", "Price"],
              ] as const).map(([k, lbl]) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={fields[k]} onCheckedChange={c => setFields(f => ({ ...f, [k]: !!c }))} data-testid={`checkbox-${k}`} />
                  {lbl}
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><Tag className="w-3 h-3" /> Preview ({previewDims.w} × {previewDims.h} mm)</Label>
              <LabelPreview line={queue[0]} opts={{ ...fields, ...previewDims }} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
