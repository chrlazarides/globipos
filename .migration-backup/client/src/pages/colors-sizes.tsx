import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Palette, Ruler } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Color, Size } from "@shared/schema";

function ColorForm({ onSubmit, isPending, defaultValues }: {
  onSubmit: (d: { name: string; hexCode: string; active: boolean }) => void;
  isPending: boolean;
  defaultValues?: { name: string; hexCode: string; active: boolean };
}) {
  const [name, setName] = useState(defaultValues?.name || "");
  const [hexCode, setHexCode] = useState(defaultValues?.hexCode || "#000000");
  const [active, setActive] = useState(defaultValues?.active ?? true);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Color Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Red, Navy Blue, Charcoal" data-testid="input-color-name" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Swatch</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(hexCode) ? hexCode : "#000000"}
            onChange={(e) => setHexCode(e.target.value)}
            className="h-9 w-14 rounded border cursor-pointer"
            data-testid="input-color-swatch"
          />
          <Input value={hexCode} onChange={(e) => setHexCode(e.target.value)} placeholder="#RRGGBB" data-testid="input-color-hex" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={active} onCheckedChange={setActive} data-testid="switch-color-active" />
        <span className="text-sm">Active</span>
      </div>
      <div className="flex justify-end pt-2">
        <Button
          disabled={isPending || !name.trim()}
          onClick={() => onSubmit({ name: name.trim(), hexCode, active })}
          data-testid="button-save-color"
        >
          {isPending ? "Saving..." : "Save Color"}
        </Button>
      </div>
    </div>
  );
}

function SizeForm({ onSubmit, isPending, defaultValues }: {
  onSubmit: (d: { name: string; sortOrder: number; active: boolean }) => void;
  isPending: boolean;
  defaultValues?: { name: string; sortOrder: number; active: boolean };
}) {
  const [name, setName] = useState(defaultValues?.name || "");
  const [sortOrder, setSortOrder] = useState(defaultValues?.sortOrder ?? 0);
  const [active, setActive] = useState(defaultValues?.active ?? true);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Size Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. S, M, L, XL, 38, 39, 40" data-testid="input-size-name" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Sort Order</label>
        <Input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
          placeholder="Lower numbers appear first"
          data-testid="input-size-sort-order"
        />
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={active} onCheckedChange={setActive} data-testid="switch-size-active" />
        <span className="text-sm">Active</span>
      </div>
      <div className="flex justify-end pt-2">
        <Button
          disabled={isPending || !name.trim()}
          onClick={() => onSubmit({ name: name.trim(), sortOrder, active })}
          data-testid="button-save-size"
        >
          {isPending ? "Saving..." : "Save Size"}
        </Button>
      </div>
    </div>
  );
}

export default function ColorsSizesPage() {
  const { toast } = useToast();
  const [newColorOpen, setNewColorOpen] = useState(false);
  const [editingColor, setEditingColor] = useState<Color | null>(null);
  const [newSizeOpen, setNewSizeOpen] = useState(false);
  const [editingSize, setEditingSize] = useState<Size | null>(null);

  const { data: colors = [], isLoading: colorsLoading } = useQuery<Color[]>({ queryKey: ["/api/colors"] });
  const { data: sizes = [], isLoading: sizesLoading } = useQuery<Size[]>({ queryKey: ["/api/sizes"] });

  const createColor = useMutation({
    mutationFn: async (data: any) => (await apiRequest("POST", "/api/colors", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/colors"] });
      setNewColorOpen(false);
      toast({ title: "Color created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateColor = useMutation({
    mutationFn: async (data: any) => (await apiRequest("PATCH", `/api/colors/${editingColor!.id}`, data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/colors"] });
      setEditingColor(null);
      toast({ title: "Color updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteColor = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/colors/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/colors"] });
      toast({ title: "Color deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createSize = useMutation({
    mutationFn: async (data: any) => (await apiRequest("POST", "/api/sizes", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sizes"] });
      setNewSizeOpen(false);
      toast({ title: "Size created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateSize = useMutation({
    mutationFn: async (data: any) => (await apiRequest("PATCH", `/api/sizes/${editingSize!.id}`, data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sizes"] });
      setEditingSize(null);
      toast({ title: "Size updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteSize = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/sizes/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sizes"] });
      toast({ title: "Size deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Colors & Sizes"
        description="Master lists for textile, apparel and footwear variant options"
      />

      <Tabs defaultValue="colors">
        <TabsList>
          <TabsTrigger value="colors" data-testid="tab-colors">
            <Palette className="w-4 h-4 mr-1.5" /> Colors
          </TabsTrigger>
          <TabsTrigger value="sizes" data-testid="tab-sizes">
            <Ruler className="w-4 h-4 mr-1.5" /> Sizes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="colors" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setNewColorOpen(true)} data-testid="button-new-color">
              <Plus className="w-4 h-4 mr-1" /> New Color
            </Button>
          </div>
          <Card>
            <CardContent className="p-4">
              {colorsLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Loading colors...</div>
              ) : colors.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <Palette className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No colors yet. Create your first one.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Swatch</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[140px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {colors.map((c) => (
                      <TableRow key={c.id} data-testid={`row-color-${c.id}`}>
                        <TableCell>
                          <div
                            className="w-6 h-6 rounded border"
                            style={{ backgroundColor: c.hexCode || "#e5e5e5" }}
                            data-testid={`swatch-color-${c.id}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>
                          <Badge variant={c.active ? "default" : "secondary"}>{c.active ? "Active" : "Inactive"}</Badge>
                        </TableCell>
                        <TableCell className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setEditingColor(c)} data-testid={`button-edit-color-${c.id}`}>
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-destructive"
                            onClick={() => { if (confirm(`Delete color "${c.name}"?`)) deleteColor.mutate(c.id); }}
                            data-testid={`button-delete-color-${c.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sizes" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setNewSizeOpen(true)} data-testid="button-new-size">
              <Plus className="w-4 h-4 mr-1" /> New Size
            </Button>
          </div>
          <Card>
            <CardContent className="p-4">
              {sizesLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Loading sizes...</div>
              ) : sizes.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <Ruler className="w-10 h-10 mx-auto text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No sizes yet. Create your first one.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Sort Order</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[140px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sizes.map((s) => (
                      <TableRow key={s.id} data-testid={`row-size-${s.id}`}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-muted-foreground">{s.sortOrder}</TableCell>
                        <TableCell>
                          <Badge variant={s.active ? "default" : "secondary"}>{s.active ? "Active" : "Inactive"}</Badge>
                        </TableCell>
                        <TableCell className="flex gap-1 justify-end">
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setEditingSize(s)} data-testid={`button-edit-size-${s.id}`}>
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-destructive"
                            onClick={() => { if (confirm(`Delete size "${s.name}"?`)) deleteSize.mutate(s.id); }}
                            data-testid={`button-delete-size-${s.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={newColorOpen} onOpenChange={setNewColorOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Color</DialogTitle></DialogHeader>
          <ColorForm onSubmit={(d) => createColor.mutate(d)} isPending={createColor.isPending} />
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingColor} onOpenChange={(o) => { if (!o) setEditingColor(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Color</DialogTitle></DialogHeader>
          {editingColor && (
            <ColorForm
              onSubmit={(d) => updateColor.mutate(d)}
              isPending={updateColor.isPending}
              defaultValues={{ name: editingColor.name, hexCode: editingColor.hexCode || "#000000", active: editingColor.active }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={newSizeOpen} onOpenChange={setNewSizeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Size</DialogTitle></DialogHeader>
          <SizeForm onSubmit={(d) => createSize.mutate(d)} isPending={createSize.isPending} />
        </DialogContent>
      </Dialog>
      <Dialog open={!!editingSize} onOpenChange={(o) => { if (!o) setEditingSize(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Size</DialogTitle></DialogHeader>
          {editingSize && (
            <SizeForm
              onSubmit={(d) => updateSize.mutate(d)}
              isPending={updateSize.isPending}
              defaultValues={{ name: editingSize.name, sortOrder: editingSize.sortOrder, active: editingSize.active }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
