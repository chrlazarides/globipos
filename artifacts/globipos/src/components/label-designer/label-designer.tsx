import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";

export type LabelElement = {
  id: string; type?: string; field?: string; x: number; y: number; w: number; h: number;
  fontSize: number; fontWeight: number; textAlign: "left" | "center" | "right"; visible: boolean;
};
export const DEFAULT_ELEMENTS: LabelElement[] = [
  { id: "name", field: "name", type: "text", x: 5, y: 4, w: 90, h: 13, fontSize: 9, fontWeight: 600, textAlign: "center", visible: true },
  { id: "barcode", field: "barcode", type: "barcode", x: 8, y: 19, w: 84, h: 32, fontSize: 7, fontWeight: 400, textAlign: "center", visible: true },
  { id: "barcodeText", field: "barcodeText", type: "text", x: 8, y: 51, w: 84, h: 9, fontSize: 7, fontWeight: 400, textAlign: "center", visible: true },
  { id: "price", field: "price", type: "price", x: 5, y: 62, w: 90, h: 18, fontSize: 14, fontWeight: 700, textAlign: "center", visible: true },
  { id: "unitPrice", field: "unitPrice", type: "text", x: 5, y: 81, w: 90, h: 10, fontSize: 7, fontWeight: 600, textAlign: "center", visible: true },
];
const names: Record<string, string> = { name: "Item name", barcode: "Barcode", barcodeText: "Barcode number", price: "Sale price", unitPrice: "Unit / reference price", sku: "SKU", priorPrice: "Prior price", offer: "Promotion", garment: "Garment details" };

type Props = { elements: LabelElement[]; onChange: (next: LabelElement[]) => void; onReset: () => void; kind: "barcode" | "shelf"; };
export function LabelDesigner({ elements, onChange, onReset, kind }: Props) {
  const [selected, setSelected] = useState<string | null>(elements[0]?.id ?? null);
  const board = useRef<HTMLDivElement>(null);
  const active = elements.find(e => e.id === selected);
  const mandatory = kind === "shelf" && ["price", "unitPrice", "priorPrice", "priorUnitPrice", "offer"].includes(active?.field || "");
  const update = (id: string, patch: Partial<LabelElement>) => onChange(elements.map(e => e.id === id ? { ...e, ...patch } : e));
  const pointer = (event: React.PointerEvent, id: string, resize = false) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = elements.find(e => e.id === id); const rect = board.current?.getBoundingClientRect();
    if (!start || !rect) return;
    const sx = event.clientX, sy = event.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width * 100, dy = (ev.clientY - sy) / rect.height * 100;
      update(id, resize ? { w: Math.max(8, Math.min(100 - start.x, start.w + dx)), h: Math.max(6, Math.min(100 - start.y, start.h + dy)) } : { x: Math.max(0, Math.min(100 - start.w, start.x + dx)), y: Math.max(0, Math.min(100 - start.h, start.y + dy)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const add = () => {
    const id = `element-${Date.now()}`;
    onChange([...elements, { id, field: "sku", type: "text", x: 10, y: 10, w: 80, h: 10, fontSize: 7, fontWeight: 400, textAlign: "center", visible: true }]); setSelected(id);
  };
  return <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_240px]">
    <div className="rounded-2xl border border-slate-200 bg-[#f7f8f5] p-5">
      <div className="mb-4 flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-slate-500">Canvas</p><p className="text-xs text-slate-500">Select, drag, and resize label elements</p></div><Button size="sm" variant="outline" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" />Reset</Button></div>
      <div ref={board} className="relative mx-auto aspect-[5/3] max-w-[420px] overflow-hidden rounded-lg border-2 border-dashed border-[#b4bcae] bg-[#fffef9] shadow-inner">
        {elements.filter(e => e.visible).map(e => <div key={e.id} onPointerDown={ev => { setSelected(e.id); pointer(ev, e.id); }} className={`absolute cursor-move select-none rounded border bg-white/75 px-1 transition-shadow ${selected === e.id ? "z-10 border-[#d6a74e] shadow-[0_0_0_2px_rgba(214,167,78,.24)]" : "border-transparent hover:border-slate-300"}`} style={{ left: `${e.x}%`, top: `${e.y}%`, width: `${e.w}%`, height: `${e.h}%`, fontSize: `${Math.max(5, e.fontSize * .72)}px`, fontWeight: e.fontWeight, textAlign: e.textAlign, lineHeight: 1.1 }}>
          <span className="pointer-events-none block truncate">{names[e.field || e.type || ""] || "Custom element"}</span>{selected === e.id && <span onPointerDown={ev => { ev.stopPropagation(); pointer(ev, e.id, true); }} className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-[#d6a74e]" />}
        </div>)}
      </div>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-slate-800">Element properties</p><Button size="icon" variant="ghost" onClick={add} aria-label="Add element"><Plus className="h-4 w-4" /></Button></div>
      <div className="space-y-3">
        {elements.map(e => <button key={e.id} onClick={() => setSelected(e.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${selected === e.id ? "bg-[#f1eadb] text-slate-900" : "hover:bg-slate-50"}`}><GripVertical className="h-3.5 w-3.5 text-slate-400" /><span className="flex-1 truncate">{names[e.field || ""] || "Custom element"}</span><span className="text-slate-400">{e.visible ? "" : "Hidden"}</span></button>)}
      </div>
      {active && <div className="mt-4 space-y-3 border-t pt-4">
        <Label className="text-xs">Typography</Label><div className="grid grid-cols-2 gap-2"><Input type="number" min={5} max={30} value={active.fontSize} onChange={e => update(active.id, { fontSize: Number(e.target.value) })} aria-label="Font size" /><Select value={String(active.fontWeight)} onValueChange={v => update(active.id, { fontWeight: Number(v) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="400">Regular</SelectItem><SelectItem value="600">Semibold</SelectItem><SelectItem value="700">Bold</SelectItem></SelectContent></Select></div>
        <Select value={active.textAlign} onValueChange={v => update(active.id, { textAlign: v as LabelElement["textAlign"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="left">Align left</SelectItem><SelectItem value="center">Align center</SelectItem><SelectItem value="right">Align right</SelectItem></SelectContent></Select>
        <div className="flex gap-2"><Button className="flex-1" size="sm" variant="outline" disabled={mandatory} onClick={() => update(active.id, { visible: !active.visible })}>{active.visible ? <EyeOff /> : <Eye />} {active.visible ? "Hide" : "Show"}</Button><Button size="sm" variant="destructive" disabled={mandatory} onClick={() => { onChange(elements.filter(e => e.id !== active.id)); setSelected(null); }}><Trash2 /></Button></div>
        {mandatory && <p className="text-[11px] leading-relaxed text-amber-700">Required shelf-label content is protected while this field is applicable.</p>}
      </div>}
    </div>
  </div>;
}