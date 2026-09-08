import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LabelDesigner, DEFAULT_ELEMENTS, type LabelElement } from "@/components/label-designer/label-designer";
import { Copy, Save, Star, Pencil, Layers3, LayoutTemplate, AlertTriangle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface QueueLine {
  key: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  unitPrice?: number;
  unitLabel?: string;
  previousPrice?: number;
  previousUnitPrice?: number;
  discountPercentage?: number;
  garmentDetails?: string;
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

function isQrCode(code: string): boolean {
  return code.startsWith("QR:");
}

async function barcodeDataUrl(code: string, heightPx: number): Promise<string | null> {
  if (isQrCode(code)) {
    try {
      return await QRCode.toDataURL(code, {
        errorCorrectionLevel: "M",
        width: Math.max(96, heightPx * 2),
        margin: 0,
      });
    } catch {
      return null;
    }
  }
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
function elementValue(line: QueueLine, field?: string): string {
  switch (field) {
    case "name": return line.name;
    case "sku": return line.sku;
    case "barcodeText": return line.barcode;
    case "price": return `${line.previousPrice != null ? "Τιμή Προσφοράς / Sale Price: " : ""}€${Number(line.price || 0).toFixed(2)}`;
    case "offer": return line.previousPrice != null ? `ΠΡΟΣΦΟΡΑ / OFFER · -${line.discountPercentage?.toFixed(0)}%` : "";
    case "priorPrice": return line.previousPrice != null ? `Προγενέστερη Τιμή / Prior Price: €${line.previousPrice.toFixed(2)}` : "";
    case "unitPrice": return line.unitPrice != null && line.unitLabel ? `Μοναδιαία Τιμή / Unit Price: €${line.unitPrice.toFixed(2)} ${line.unitLabel}` : "";
    case "priorUnitPrice": return line.previousUnitPrice != null && line.unitLabel ? `Προγενέστερη Μοναδιαία Τιμή / Prior Unit Price: €${line.previousUnitPrice.toFixed(2)} ${line.unitLabel}` : "";
    case "garment": return line.garmentDetails ?? "";
    default: return "";
  }
}

function elementAllowed(element: LabelElement, fields: FieldOpts): boolean {
  if (!element.visible) return false;
  if (element.field === "name") return fields.showName;
  if (element.field === "sku") return fields.showSku;
  if (element.field === "barcodeText") return fields.showBarcodeText;
  if (element.field === "price") return fields.showPrice;
  if (["unitPrice", "priorUnitPrice"].includes(element.field ?? "")) return fields.showUnitPrice;
  if (element.field === "garment") return fields.showGarmentDetails;
  return true;
}

function normalizedElements(value: unknown): LabelElement[] {
  if (!Array.isArray(value)) return DEFAULT_ELEMENTS;
  return value.map((element: any) => ({
    ...element,
    type: element.type ?? "text",
    field: element.field ?? element.id,
    x: Number(element.x ?? 5),
    y: Number(element.y ?? 5),
    w: Number(element.w ?? 90),
    h: Number(element.h ?? 10),
    fontSize: Number(element.fontSize ?? 7),
    fontWeight: Number(element.fontWeight ?? 400),
    textAlign: element.textAlign ?? "center",
    visible: element.visible !== false,
  }));
}

function LabelPreview({ line, opts, elements }: { line: QueueLine | undefined; opts: FieldOpts & { w: number; h: number }; elements: LabelElement[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current || !line?.barcode) return;
    if (isQrCode(line.barcode)) {
      QRCode.toDataURL(line.barcode, { errorCorrectionLevel: "M", width: 160, margin: 0 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
      return;
    }
    setQrDataUrl(null);
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
      className="relative border rounded-md bg-white text-black mx-auto overflow-hidden"
      style={{ width: opts.w * scale, height: opts.h * scale }}
      data-testid="label-preview"
    >
      {elements.filter(element => elementAllowed(element, opts)).map(element => {
        const style = { left: `${element.x}%`, top: `${element.y}%`, width: `${element.w}%`, height: `${element.h}%` };
        if (element.field === "barcode") {
          return qrDataUrl
            ? <img key={element.id} src={qrDataUrl} alt="QR code" className="absolute object-contain" style={style} />
            : <canvas key={element.id} ref={ref} className="absolute max-w-full" style={style} />;
        }
        const text = elementValue(line, element.field);
        if (!text) return null;
        return <div key={element.id} className="absolute overflow-hidden leading-tight" style={{ ...style, fontSize: `${element.fontSize}px`, fontWeight: element.fontWeight, textAlign: element.textAlign }}>{text}</div>;
      })}
    </div>
  );
}

interface FieldOpts {
  showName: boolean;
  showSku: boolean;
  showPrice: boolean;
  showBarcodeText: boolean;
  showUnitPrice: boolean;
  showGarmentDetails: boolean;
}
interface LabelProfile { id: string; name: string; kind: "barcode" | "shelf"; config: any; isDefault: boolean; isSystem: boolean; createdAt: string; updatedAt: string }
const profileConfig = (mode: PrintMode, thermalPresetId: string, customW: number, customH: number, a4PresetId: string, priceLevel: string, fields: FieldOpts, elements: LabelElement[]) => ({ version: 1, mode, thermalPresetId, customW, customH, a4PresetId, priceLevel, fields, elements });

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
  const [fields, setFields] = useState<FieldOpts>({
    showName: true,
    showSku: false,
    showPrice: true,
    showBarcodeText: true,
    showUnitPrice: true,
    showGarmentDetails: true,
  });
  const [expandItemId, setExpandItemId] = useState<string | null>(null);
  const [kind, setKind] = useState<"barcode" | "shelf">("barcode");
  const [elements, setElements] = useState<LabelElement[]>(DEFAULT_ELEMENTS);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [profileName, setProfileName] = useState("");
  const [profileDialog, setProfileDialog] = useState<"new" | "save" | "rename" | null>(null);

  const { data: items = [], isLoading } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: variants = [], isLoading: variantsLoading } = useQuery<ItemVariant[]>({
    queryKey: ["/api/items", expandItemId, "variants"],
    enabled: !!expandItemId,
  });
  const { data: profiles = [], isLoading: profilesLoading, isError: profilesError } = useQuery<LabelProfile[]>({ queryKey: ["/api/label-profiles"] });
  const profileMutation = async (method: string, url: string, body?: any) => { await apiRequest(method, url, body); await queryClient.invalidateQueries({ queryKey: ["/api/label-profiles"] }); };
  const selectedProfile = profiles.find(p => p.id === activeProfileId);
  const currentConfig = () => profileConfig(mode, thermalPresetId, customW, customH, a4PresetId, priceLevel, fields, elements);
  function applyProfile(p: LabelProfile) {
    const c = p.config || {}; setActiveProfileId(p.id); setKind(p.kind);
    if (c.mode) setMode(c.mode); if (c.thermalPresetId) setThermalPresetId(c.thermalPresetId); if (c.customW) setCustomW(c.customW); if (c.customH) setCustomH(c.customH); if (c.a4PresetId) setA4PresetId(c.a4PresetId); if (c.priceLevel) setPriceLevel(c.priceLevel); if (c.fields) setFields({ ...fields, ...c.fields }); setElements(normalizedElements(c.elements));
  }
  useEffect(() => { const p = profiles.find(x => x.isDefault) || profiles[0]; if (p && !activeProfileId) applyProfile(p); }, [profiles]);
  async function createOrSaveProfile() {
    const name = profileName.trim(); if (!name) return;
    const body = { name, kind, config: currentConfig() };
    try { const res = await apiRequest("POST", "/api/label-profiles", body); const p = await res.json(); setActiveProfileId(p.id); setProfileName(""); setProfileDialog(null); await queryClient.invalidateQueries({ queryKey: ["/api/label-profiles"] }); toast({ title: "Profile saved", description: `${name} is ready for quick retrieval.` }); } catch { toast({ title: "Could not save profile", variant: "destructive" }); }
  }
  async function saveCurrent() { if (!selectedProfile) return; try { await profileMutation("PUT", `/api/label-profiles/${selectedProfile.id}`, { config: currentConfig(), kind }); toast({ title: "Changes saved" }); } catch { toast({ title: "Could not save changes", variant: "destructive" }); } }
  async function duplicateProfile() { if (!selectedProfile) return; try { const r = await apiRequest("POST", `/api/label-profiles/${selectedProfile.id}/duplicate`); const p = await r.json(); await queryClient.invalidateQueries({ queryKey: ["/api/label-profiles"] }); setActiveProfileId(p.id); toast({ title: "Profile duplicated" }); } catch { toast({ title: "Could not duplicate profile", variant: "destructive" }); } }
  async function deleteProfile() { if (!selectedProfile || selectedProfile.isSystem || !window.confirm(`Delete ${selectedProfile.name}?`)) return; try { await profileMutation("DELETE", `/api/label-profiles/${selectedProfile.id}`); setActiveProfileId(""); toast({ title: "Profile deleted" }); } catch { toast({ title: "Could not delete profile", variant: "destructive" }); } }
  async function renameProfile() { if (!selectedProfile || !profileName.trim()) return; try { await profileMutation("PUT", `/api/label-profiles/${selectedProfile.id}`, { name: profileName.trim() }); setProfileDialog(null); setProfileName(""); toast({ title: "Profile renamed" }); } catch { toast({ title: "Could not rename profile", variant: "destructive" }); } }
  async function makeDefault() { if (!selectedProfile) return; try { await profileMutation("PUT", `/api/label-profiles/${selectedProfile.id}`, { isDefault: true }); toast({ title: "Default profile updated" }); } catch { toast({ title: "Could not update default", variant: "destructive" }); } }

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

  const labelDetails = (item: Item, price: string) => {
    const quantity = Number((item as any).shelfLabelQuantity || 0);
    const unit = String((item as any).shelfLabelUnit || "");
    let unitPrice: number | undefined;
    let unitLabel: string | undefined;
    const referencePrice = (numericPrice: number) => {
      if (unit === "g" || unit === "ml") return (numericPrice / quantity) * 1000;
      if (["kg", "L", "m", "pc", "m2", "m3"].includes(unit)) return numericPrice / quantity;
      return undefined;
    };
    if ((item as any).shelfLabelUomEnabled && quantity > 0 && unit) {
      unitPrice = referencePrice(Number(price || 0));
      if (unit === "g" || unit === "kg") unitLabel = "/ kg";
      else if (unit === "ml" || unit === "L") unitLabel = "/ L";
      else if (unit === "pc") unitLabel = "/ item";
      else if (unit === "m2") unitLabel = "/ m²";
      else if (unit === "m3") unitLabel = "/ m³";
      else unitLabel = "/ m";
    }
    const configuredPreviousPrice = Number((item as any).shelfLabelPreviousPrice || 0);
    const currentPrice = Number(price || 0);
    const discountApplies = priceLevel === "1"
      && currentPrice === Number(item.price1)
      && (item as any).shelfLabelDiscountEnabled
      && configuredPreviousPrice > currentPrice;
    const previousPrice = discountApplies ? configuredPreviousPrice : undefined;
    const previousUnitPrice = previousPrice != null && unitPrice != null ? referencePrice(previousPrice) : undefined;
    const discountPercentage = previousPrice != null ? ((previousPrice - currentPrice) / previousPrice) * 100 : undefined;
    const garmentDetails = (item as any).itemType === "garment"
      ? [(item as any).garmentGender, (item as any).garmentStyle, (item as any).garmentMaterial].filter(Boolean).join(" · ")
      : undefined;
    return { unitPrice, unitLabel, previousPrice, previousUnitPrice, discountPercentage, garmentDetails };
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
    const price = priceOf(item);
    addLine({ key: item.id, name: item.name, sku: item.sku ?? "", barcode: item.barcode ?? "", price, ...labelDetails(item, price) });
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
    const content = elements.filter(element => elementAllowed(element, fields)).map(element => {
      const style = `left:${element.x}%;top:${element.y}%;width:${element.w}%;height:${element.h}%;`;
      if (element.field === "barcode") return `<img class="el" src="${img}" style="${style}object-fit:contain;" />`;
      const text = elementValue(line, element.field);
      if (!text) return "";
      return `<div class="el" style="${style}font-size:${element.fontSize}pt;font-weight:${element.fontWeight};text-align:${element.textAlign};">${escapeHtml(text)}</div>`;
    }).join("");
    return `<div class="lbl" style="width:${w}mm;height:${h}mm;">${content}</div>`;
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function handlePrint() {
    if (queue.length === 0) {
      toast({ title: "Nothing to print", description: "Add items to the print queue first" });
      return;
    }
    if (!fields.showPrice && queue.some((line) => line.previousPrice != null)) {
      toast({ title: "Sale price required", description: "Promotional labels must show the current sale price.", variant: "destructive" });
      return;
    }
    if (!fields.showUnitPrice && queue.some((line) => line.previousUnitPrice != null)) {
      toast({ title: "Unit prices required", description: "Promotional labels for measured goods must show current and prior unit prices.", variant: "destructive" });
      return;
    }
    const promotionalLines = queue.filter((line) => line.previousPrice != null);
    if (promotionalLines.length) {
      const printWidth = mode === "thermal" ? labelW : a4.labelW;
      const printHeight = mode === "thermal" ? labelH : a4.labelH;
      const hasPromotionalUnitPrice = promotionalLines.some((line) => line.previousUnitPrice != null);
      const minimumWidth = hasPromotionalUnitPrice ? 58 : 50;
      const minimumHeight = hasPromotionalUnitPrice ? 40 : 30;
      if (printWidth < minimumWidth || printHeight < minimumHeight) {
        toast({
          title: "Label is too small for a compliant promotion",
          description: `Use at least ${minimumWidth} × ${minimumHeight} mm so the mandatory prior and current prices are not clipped.`,
          variant: "destructive",
        });
        return;
      }
    }
    const imgs = new Map<string, string>();
    for (const line of queue) {
      if (!imgs.has(line.barcode)) {
        const url = await barcodeDataUrl(line.barcode, 60);
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
      .lbl{position:relative;overflow:hidden;box-sizing:border-box;}
      .el{position:absolute;box-sizing:border-box;overflow:hidden;line-height:1.08;}
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

  const dirty = selectedProfile ? JSON.stringify(selectedProfile.config) !== JSON.stringify(currentConfig()) : false;
  return (
    <div className="min-h-[100dvh] bg-[#f4f5f1] p-4 text-slate-900 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.2em] text-[#9a7228]"><BarcodeIcon className="h-4 w-4" />GlobiPOS / production tools</div><h1 className="text-3xl font-semibold tracking-[-.035em] text-[#26312b]">Barcode labels</h1><p className="mt-1 max-w-xl text-sm text-slate-500">A predictable workspace for compliant shelf labels, barcode rolls, and A4 runs.</p></div>
          <Button onClick={handlePrint} disabled={totalLabels === 0} className="bg-[#28382f] text-[#f7f3e8] hover:bg-[#354c40]" data-testid="button-print-labels"><Printer className="h-4 w-4" />Print {totalLabels ? `${totalLabels} label${totalLabels > 1 ? "s" : ""}` : "labels"}</Button>
        </header>
        <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="rounded-2xl bg-[#28382f] p-4 text-[#f7f3e8] shadow-sm"><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.18em] text-[#c9d3b7]">Active format</p><p className="mt-1 text-lg font-semibold">{selectedProfile?.name || "Unsaved layout"}</p></div><Layers3 className="h-5 w-5 text-[#d6a74e]" /></div><div className="mt-4 flex items-center justify-between text-xs text-[#c9d3b7]"><span>{kind === "shelf" ? "Compliant shelf label" : "Barcode label"} · {mode === "thermal" ? `${labelW} × ${labelH} mm` : "A4 sheet"}</span><span className={dirty ? "text-[#f0c36d]" : "text-[#c9d3b7]"}>{dirty ? "Unsaved changes" : "Saved"}</span></div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-400">Queue</p><p className="mt-2 text-2xl font-semibold">{totalLabels}</p><p className="text-xs text-slate-500">{queue.length} product lines ready to print</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-400">Print guard</p><p className="mt-2 flex items-center gap-2 text-sm font-medium text-[#506c55]"><span className="h-2 w-2 rounded-full bg-[#718d6f]" />Mandatory fields enforced</p><p className="mt-1 text-xs text-slate-500">Sale, prior, and unit prices stay protected.</p></div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(38,49,43,.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><LayoutTemplate className="h-5 w-5 text-[#9a7228]" /><div><h2 className="font-semibold">Saved formats</h2><p className="text-xs text-slate-500">Retrieve the exact format your printer expects.</p></div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setProfileName(""); setProfileDialog("new"); }}><Plus className="h-3.5 w-3.5" />New profile</Button>{selectedProfile && <><Button size="sm" variant="outline" onClick={saveCurrent} disabled={!dirty}><Save className="h-3.5 w-3.5" />Save</Button><Button size="sm" variant="outline" onClick={duplicateProfile}><Copy className="h-3.5 w-3.5" />Duplicate</Button></>}</div></div>
          {profilesError ? <p className="mt-4 text-sm text-red-700">Profiles could not be loaded. Retry the page to reconnect.</p> : <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{profilesLoading ? [1,2,3].map(i => <div key={i} className="h-16 w-44 animate-pulse rounded-xl bg-slate-100" />) : profiles.map(p => <button key={p.id} onClick={() => applyProfile(p)} className={`min-w-[180px] rounded-xl border px-3 py-2.5 text-left transition-colors ${p.id === activeProfileId ? "border-[#d6a74e] bg-[#fbf5e9]" : "border-slate-200 hover:border-[#b4bcae]"}`}><span className="flex items-center justify-between gap-2 text-sm font-medium"><span className="truncate">{p.name}</span>{p.isDefault && <Star className="h-3.5 w-3.5 fill-[#d6a74e] text-[#d6a74e]" />}</span><span className="mt-1 block text-[11px] uppercase tracking-wider text-slate-400">{p.kind} · {p.isSystem ? "System" : "Custom"}</span></button>)}</div>}
          {selectedProfile && <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"><span className="text-xs text-slate-500">Manage “{selectedProfile.name}”</span><Button variant="ghost" size="sm" onClick={makeDefault} disabled={selectedProfile.isDefault}><Star className="h-3 w-3" />{selectedProfile.isDefault ? "Default" : "Make default"}</Button><Button variant="ghost" size="sm" onClick={() => { setProfileName(selectedProfile.name); setProfileDialog("rename"); }} disabled={selectedProfile.isSystem}><Pencil className="h-3 w-3" />Rename</Button><Button variant="ghost" size="sm" onClick={deleteProfile} disabled={selectedProfile.isSystem} className="text-red-700">{selectedProfile.isSystem ? "System profile" : "Delete"}</Button></div>}
        </section>
        {profileDialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h3 className="font-semibold">{profileDialog === "rename" ? "Rename profile" : profileDialog === "save" ? "Save as new profile" : "Create profile"}</h3><p className="mt-1 text-xs text-slate-500">Keep names short and specific to the printer or shelf run.</p><Input autoFocus className="mt-4" value={profileName} onChange={e => setProfileName(e.target.value)} onKeyDown={e => e.key === "Enter" && (profileDialog === "rename" ? renameProfile() : createOrSaveProfile())} placeholder="e.g. Front till · 50 × 30" /><div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setProfileDialog(null)}>Cancel</Button><Button onClick={profileDialog === "rename" ? renameProfile : createOrSaveProfile}>Save profile</Button></div></div></div>}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[310px_330px_minmax(0,1fr)]">
        <Card className="border-slate-200 shadow-sm">
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
                        onClick={() => {
                          const price = priceOf(v as any, item);
                          addLine({ key: v.id, name: variantLabel(v, item.name), sku: v.sku ?? "", barcode: v.barcode ?? "", price, ...labelDetails(item, price) });
                        }}
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
                        onClick={() => variants.forEach(v => {
                          if (!v.barcode) return;
                          const price = priceOf(v as any, item);
                          addLine({ key: v.id, name: variantLabel(v, item.name), sku: v.sku ?? "", barcode: v.barcode, price, ...labelDetails(item, price) });
                        })}
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

        <Card className="border-slate-200 shadow-sm">
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

        <Card className="border-slate-200 shadow-sm xl:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3. Label layout</CardTitle>
             <CardDescription>Choose output, price logic, and fields</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#f1f3ef] p-1">
              <button onClick={() => setKind("barcode")} className={`rounded-md px-2 py-2 text-xs font-medium ${kind === "barcode" ? "bg-white text-[#28382f] shadow-sm" : "text-slate-500"}`}>Barcode label</button>
              <button onClick={() => setKind("shelf")} className={`rounded-md px-2 py-2 text-xs font-medium ${kind === "shelf" ? "bg-white text-[#28382f] shadow-sm" : "text-slate-500"}`}>Shelf label</button>
            </div>
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
                ["showUnitPrice", "Unit/reference price (when enabled on item)"],
                ["showGarmentDetails", "Garment details (when applicable)"],
              ] as const).map(([k, lbl]) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={fields[k]} onCheckedChange={c => setFields(f => ({ ...f, [k]: !!c }))} data-testid={`checkbox-${k}`} />
                  {lbl}
                </label>
              ))}
            </div>

             <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><Tag className="w-3 h-3" /> Preview ({previewDims.w} × {previewDims.h} mm)</Label>
              <LabelPreview line={queue[0]} opts={{ ...fields, ...previewDims }} elements={elements} />
            </div>
           </CardContent>
         </Card>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Visual label designer</h2><p className="text-xs text-slate-500">The same saved configuration drives preview and print.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setProfileName(""); setProfileDialog("save"); }} disabled={!selectedProfile}><Save className="h-3.5 w-3.5" />Save as</Button><div className="rounded-lg bg-[#f1eadb] px-3 py-1.5 text-xs font-medium text-[#71531d]">{labelW} × {labelH} mm</div></div></div>
          <LabelDesigner kind={kind} elements={elements} onChange={setElements} onReset={() => setElements(selectedProfile?.config?.elements || DEFAULT_ELEMENTS)} />
        </section>
      </div>
    </div>
   );
}
