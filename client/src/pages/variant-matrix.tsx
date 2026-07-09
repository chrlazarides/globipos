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
import { Grid3x3, Printer, Barcode as BarcodeIcon, QrCode } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Item, Color, Size, ItemVariant } from "@shared/schema";
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

export default function VariantMatrixPage() {
  const { toast } = useToast();
  const [itemSearch, setItemSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [season, setSeason] = useState("");
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [labelFormat, setLabelFormat] = useState<LabelFormat>("CODE128");
  const [generatedVariants, setGeneratedVariants] = useState<ItemVariant[]>([]);

  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"], staleTime: 30000 });
  const { data: colors = [] } = useQuery<Color[]>({ queryKey: ["/api/colors"], staleTime: 30000 });
  const { data: sizes = [] } = useQuery<Size[]>({ queryKey: ["/api/sizes"], staleTime: 30000 });

  const sortedColors = useMemo(() => [...colors].filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)), [colors]);
  const sortedSizes = useMemo(() => [...sizes].filter(s => s.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [sizes]);

  const filteredItems = items.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.sku.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 50);

  const selectedItem = items.find(i => i.id === selectedItemId);

  const cellKey = (colorId: string, sizeId: string) => `${colorId}::${sizeId}`;

  const toggleColor = (id: string) => {
    setSelectedColorIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleSize = (id: string) => {
    setSelectedSizeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      const cells = selectedColorIds.flatMap(colorId =>
        selectedSizeIds.map(sizeId => ({
          colorId,
          sizeId,
          quantity: parseInt(quantities[cellKey(colorId, sizeId)] || "0", 10) || 0,
        }))
      ).filter(c => c.quantity > 0);

      if (cells.length === 0) throw new Error("Enter at least one quantity in the matrix");

      const res = await apiRequest("POST", `/api/items/${selectedItemId}/variants/matrix`, { season: season || null, cells });
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
      return `<div class="label">
        <div class="label-name">${selectedItem.name}</div>
        <div class="label-variant">${v.option1Value || ""} / ${v.option2Value || ""}</div>
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
      const script = printWindow.document.createElement("script");
      script.textContent = generatedVariants.map(v => {
        if (labelFormat === "QR") {
          return `window.__qr_${v.id.replace(/-/g, "")} = true;`;
        }
        return "";
      }).join("");
      printWindow.document.body.appendChild(script);

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

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Variant Matrix & Label Barcodes"
        description="Enter quantities per color/size combination and auto-generate unique barcodes ready for label printers"
        icon={<Grid3x3 className="w-5 h-5" />}
      />

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
        </CardContent>
      </Card>

      {selectedItem && selectedColorIds.length > 0 && selectedSizeIds.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <p className="text-sm font-medium">Quantity Matrix — rows are sizes, columns are colors</p>
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
                          const key = cellKey(cid, sid);
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
                    <p className="text-sm font-medium truncate">{v.option1Value} / {v.option2Value}</p>
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
