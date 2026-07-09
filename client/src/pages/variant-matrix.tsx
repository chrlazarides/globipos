import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import JsBarcode from "jsbarcode";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Grid3x3, Printer, X, Save, LayoutTemplate, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Item, Color, Size, ItemVariant, VariantTemplate } from "@shared/schema";
import QRCode from "qrcode";

type LabelFormat = "CODE128" | "CODE39" | "QR";

function BarcodeCanvas({ value, format }: { value: string; format: LabelFormat }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (format === "QR") {
      QRCode.toCanvas(canvasRef.current, value, { width: 96, margin: 1 }).catch(() => {});
    } else {
      try {
        JsBarcode(canvasRef.current, value, {
          format,
          width: 1.6,
          height: 40,
          fontSize: 12,
          displayValue: true,
          margin: 4,
        });
      } catch {
        // ignore render errors for invalid characters in a given symbology
      }
    }
  }, [value, format]);

  return <canvas ref={canvasRef} data-testid={`canvas-barcode-${value}`} />;
}

const NO_QUALITY = "__none__";

export default function VariantMatrixPage() {
  const { toast } = useToast();
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [season, setSeason] = useState("");
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [qualities, setQualities] = useState<string[]>([]);
  const [newQuality, setNewQuality] = useState("");
  const [activeQuality, setActiveQuality] = useState<string>(NO_QUALITY);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [labelFormat, setLabelFormat] = useState<LabelFormat>("CODE128");
  const [generatedVariants, setGeneratedVariants] = useState<ItemVariant[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateName, setTemplateName] = useState("");

  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"], staleTime: 30000 });
  const { data: colors = [] } = useQuery<Color[]>({ queryKey: ["/api/colors"], staleTime: 30000 });
  const { data: sizes = [] } = useQuery<Size[]>({ queryKey: ["/api/sizes"], staleTime: 30000 });
  const { data: templates = [] } = useQuery<VariantTemplate[]>({ queryKey: ["/api/variant-templates"], staleTime: 10000 });

  const sortedColors = useMemo(() => [...colors].filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)), [colors]);
  const sortedSizes = useMemo(() => [...sizes].filter(s => s.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [sizes]);

  const filteredItems = items.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.sku.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 50);

  const selectedItem = items.find(i => i.id === selectedItemId);

  const cellKey = (colorId: string, sizeId: string, quality: string) => `${colorId}::${sizeId}::${quality}`;

  const toggleColor = (id: string) => {
    setSelectedColorIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleSize = (id: string) => {
    setSelectedSizeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const addQuality = () => {
    const q = newQuality.trim();
    if (!q || qualities.includes(q)) return;
    setQualities(prev => [...prev, q]);
    setNewQuality("");
    if (activeQuality === NO_QUALITY) setActiveQuality(q);
  };
  const removeQuality = (q: string) => {
    setQualities(prev => prev.filter(x => x !== q));
    if (activeQuality === q) setActiveQuality(NO_QUALITY);
  };

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    setSelectedColorIds(template.colorIds.filter(id => sortedColors.some(c => c.id === id)));
    setSelectedSizeIds(template.sizeIds.filter(id => sortedSizes.some(s => s.id === id)));
    const tplQualities = template.qualities || [];
    setQualities(tplQualities);
    setActiveQuality(tplQualities.length > 0 ? tplQualities[0] : NO_QUALITY);
    setQuantities({});
    toast({ title: `Applied "${template.name}" set` });
  };

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!templateName.trim()) throw new Error("Enter a name for this set");
      if (selectedColorIds.length === 0 || selectedSizeIds.length === 0) throw new Error("Select at least one color and size first");
      const res = await apiRequest("POST", "/api/variant-templates", {
        name: templateName.trim(),
        colorIds: selectedColorIds,
        sizeIds: selectedSizeIds,
        qualities: qualities.length > 0 ? qualities : null,
      });
      return res.json() as Promise<VariantTemplate>;
    },
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: ["/api/variant-templates"] });
      setTemplateName("");
      toast({ title: `Saved "${t.name}" as a reusable set` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/variant-templates/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variant-templates"] });
      toast({ title: "Set deleted" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const qualityList = qualities.length > 0 ? qualities : [NO_QUALITY];
      const cells = selectedColorIds.flatMap(colorId =>
        selectedSizeIds.flatMap(sizeId =>
          qualityList.map(quality => ({
            colorId,
            sizeId,
            quality: quality === NO_QUALITY ? null : quality,
            quantity: parseInt(quantities[cellKey(colorId, sizeId, quality)] || "0", 10) || 0,
          }))
        )
      ).filter(c => c.quantity > 0);

      if (cells.length === 0) throw new Error("Enter at least one quantity in the matrix");

      const res = await apiRequest("POST", `/api/items/${selectedItemId}/variants/matrix`, {
        season: season || null,
        qualities: qualities.length > 0 ? qualities : undefined,
        cells,
      });
      return res.json() as Promise<ItemVariant[]>;
    },
    onSuccess: (variants) => {
      setGeneratedVariants(variants);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/item-variants"] });
      toast({ title: `${variants.length} variant(s) generated with unique barcodes` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePrintLabels = () => {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow || !selectedItem) return;

    const labelsHtml = generatedVariants.map(v => {
      const variantLine = [v.option1Value, v.option2Value, v.option3Value].filter(Boolean).join(" / ");
      return `<div class="label">
        <div class="label-name">${selectedItem.name}</div>
        <div class="label-variant">${variantLine}</div>
        <canvas id="bc-${v.id}"></canvas>
        <div class="label-sku">${v.sku}</div>
      </div>`;
    }).join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Labels</title>
          <style>
            body { font-family: sans-serif; margin: 0; padding: 10px; }
            .label { display: inline-block; border: 1px dashed #999; padding: 8px; margin: 4px; text-align: center; width: 160px; }
            .label-name { font-size: 11px; font-weight: bold; }
            .label-variant { font-size: 10px; color: #444; margin-bottom: 4px; }
            .label-sku { font-size: 9px; color: #666; margin-top: 2px; }
            @media print { .label { break-inside: avoid; } }
          </style>
        </head>
        <body>${labelsHtml}</body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onload = () => {
      (async () => {
        for (const v of generatedVariants) {
          const canvas = printWindow.document.getElementById(`bc-${v.id}`) as HTMLCanvasElement | null;
          if (!canvas) continue;
          if (labelFormat === "QR") {
            await QRCode.toCanvas(canvas, v.barcode || v.sku, { width: 80, margin: 1 });
          } else {
            try {
              JsBarcode(canvas, v.barcode || v.sku, { format: labelFormat, width: 1.4, height: 36, fontSize: 10, displayValue: true, margin: 2 });
            } catch {
              // skip invalid barcode render
            }
          }
        }
        printWindow.focus();
        printWindow.print();
      })();
    };
  };

  const activeQualityKey = qualities.length > 0 ? activeQuality : NO_QUALITY;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Variant Matrix & Label Barcodes"
        description="Optional add-on for garments, shoes, and other variant-based items — enter quantities per color/size(/quality) and auto-generate unique barcodes ready for label printers"
        icon={<Grid3x3 className="w-5 h-5" />}
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2 min-w-[240px]">
              <Label>Load a saved Set/Template</Label>
              <Select value={selectedTemplateId} onValueChange={applyTemplate} data-testid="select-variant-template">
                <SelectTrigger>
                  <SelectValue placeholder="Choose a Color+Size set…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.colorIds.length} colors × {t.sizeIds.length} sizes{t.qualities?.length ? ` × ${t.qualities.length} qualities` : ""})
                    </SelectItem>
                  ))}
                  {templates.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No sets saved yet</div>}
                </SelectContent>
              </Select>
            </div>
            {selectedTemplateId && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteTemplateMutation.mutate(selectedTemplateId)}
                data-testid="button-delete-template"
                title="Delete this set"
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            )}
            <div className="flex items-end gap-2 ml-auto">
              <div className="space-y-2">
                <Label>Save current selection as a set</Label>
                <Input
                  placeholder="e.g. Men's Shoe Full Run"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  className="w-56"
                  data-testid="input-template-name"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => saveTemplateMutation.mutate()}
                disabled={saveTemplateMutation.isPending}
                data-testid="button-save-template"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Set
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Item</Label>
              <Input
                placeholder="Search item by name or SKU…"
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
                data-testid="input-matrix-item-search"
              />
              <Select value={selectedItemId} onValueChange={setSelectedItemId} data-testid="select-matrix-item">
                <SelectTrigger>
                  <SelectValue placeholder="Select an item…" />
                </SelectTrigger>
                <SelectContent>
                  {filteredItems.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Season</Label>
              <Input
                placeholder="e.g. Spring/Summer 2026"
                value={season}
                onChange={e => setSeason(e.target.value)}
                data-testid="input-matrix-season"
              />
            </div>
          </div>

          {selectedItem && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
              <div className="space-y-2">
                <Label>Colors</Label>
                <div className="flex flex-wrap gap-3 max-h-40 overflow-y-auto p-2 border rounded-md">
                  {sortedColors.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`label-color-${c.id}`}>
                      <Checkbox
                        checked={selectedColorIds.includes(c.id)}
                        onCheckedChange={() => toggleColor(c.id)}
                        data-testid={`checkbox-color-${c.id}`}
                      />
                      {c.hexCode && <span className="inline-block w-3 h-3 rounded-full border" style={{ backgroundColor: c.hexCode }} />}
                      {c.name}
                    </label>
                  ))}
                  {sortedColors.length === 0 && <span className="text-xs text-muted-foreground">No colors defined yet — add them in Colors & Sizes.</span>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Sizes</Label>
                <div className="flex flex-wrap gap-3 max-h-40 overflow-y-auto p-2 border rounded-md">
                  {sortedSizes.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer" data-testid={`label-size-${s.id}`}>
                      <Checkbox
                        checked={selectedSizeIds.includes(s.id)}
                        onCheckedChange={() => toggleSize(s.id)}
                        data-testid={`checkbox-size-${s.id}`}
                      />
                      {s.name}
                    </label>
                  ))}
                  {sortedSizes.length === 0 && <span className="text-xs text-muted-foreground">No sizes defined yet — add them in Colors & Sizes.</span>}
                </div>
              </div>
            </div>
          )}

          {selectedItem && (
            <div className="space-y-2 pt-2 border-t">
              <Label>Quality / Grade (optional — e.g. Standard, Premium, 1st/2nd grade)</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Type a quality/grade and press Add"
                  value={newQuality}
                  onChange={e => setNewQuality(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addQuality(); } }}
                  className="w-64"
                  data-testid="input-new-quality"
                />
                <Button type="button" variant="outline" onClick={addQuality} data-testid="button-add-quality">Add</Button>
              </div>
              {qualities.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {qualities.map(q => (
                    <Badge key={q} variant="secondary" className="gap-1 pr-1" data-testid={`badge-quality-${q}`}>
                      {q}
                      <button onClick={() => removeQuality(q)} data-testid={`button-remove-quality-${q}`}>
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedItem && selectedColorIds.length > 0 && selectedSizeIds.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm font-medium">Quantity Matrix — rows are sizes, columns are colors</p>
              {qualities.length > 0 && (
                <Tabs value={activeQualityKey} onValueChange={setActiveQuality}>
                  <TabsList>
                    {qualities.map(q => (
                      <TabsTrigger key={q} value={q} data-testid={`tab-quality-${q}`}>{q}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Size \ Color</TableHead>
                    {selectedColorIds.map(cid => {
                      const c = sortedColors.find(x => x.id === cid);
                      return <TableHead key={cid} className="text-center">{c?.name}</TableHead>;
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedSizeIds.map(sid => {
                    const s = sortedSizes.find(x => x.id === sid);
                    return (
                      <TableRow key={sid}>
                        <TableCell className="font-medium">{s?.name}</TableCell>
                        {selectedColorIds.map(cid => {
                          const key = cellKey(cid, sid, activeQualityKey);
                          return (
                            <TableCell key={cid} className="text-center">
                              <Input
                                type="number"
                                min={0}
                                className="w-20 mx-auto text-center"
                                value={quantities[key] || ""}
                                onChange={e => setQuantities(prev => ({ ...prev, [key]: e.target.value }))}
                                data-testid={`input-qty-${key}`}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate-matrix"
              >
                {generateMutation.isPending ? "Generating…" : "Generate Variants & Barcodes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {generatedVariants.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm font-medium">Generated Variants ({generatedVariants.length})</p>
              <div className="flex items-center gap-2">
                <Select value={labelFormat} onValueChange={v => setLabelFormat(v as LabelFormat)} data-testid="select-label-format">
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CODE128">Code 128</SelectItem>
                    <SelectItem value="CODE39">Code 39</SelectItem>
                    <SelectItem value="QR">QR Code</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={handlePrintLabels} data-testid="button-print-labels">
                  <Printer className="w-4 h-4 mr-2" />
                  Print Labels
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {generatedVariants.map(v => (
                <div key={v.id} className="border rounded-lg p-3 flex items-center gap-3" data-testid={`card-variant-${v.id}`}>
                  <BarcodeCanvas value={v.barcode || v.sku} format={labelFormat} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{[v.option1Value, v.option2Value, v.option3Value].filter(Boolean).join(" / ")}</p>
                    <p className="text-xs text-muted-foreground truncate">{v.sku}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">{v.stockQuantity} pcs</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
