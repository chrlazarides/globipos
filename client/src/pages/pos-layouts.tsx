import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPosLayoutSetSchema } from "@shared/schema";
import type { PosLayoutSet, PosLocation, PosTerminal } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLocation } from "wouter";
import { LayoutGrid, Plus, Pencil, Trash2, Loader2, Wand2, MapPin, Monitor } from "lucide-react";

const formSchema = insertPosLayoutSetSchema.extend({
  name: z.string().min(1, "Name required"),
});
type FormValues = z.infer<typeof formSchema>;

function LayoutForm({ initial, onClose }: { initial?: PosLayoutSet; onClose: () => void }) {
  const { toast } = useToast();
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      locationId: initial?.locationId ?? undefined,
      columns: initial?.columns ?? 4,
      rows: initial?.rows ?? 5,
      active: initial?.active ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      if (initial) {
        const res = await apiRequest("PUT", `/api/pos/layouts/${initial.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/pos/layouts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/layouts"] });
      toast({ title: initial ? "Layout updated" : "Layout created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Bar Layout" data-testid="input-layout-name" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Optional description" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="locationId" render={({ field }) => (
          <FormItem>
            <FormLabel>Location (optional)</FormLabel>
            <Select value={field.value ?? "none"} onValueChange={v => field.onChange(v === "none" ? undefined : v)}>
              <FormControl><SelectTrigger><SelectValue placeholder="No location filter" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="none">No location filter</SelectItem>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="columns" render={({ field }) => (
            <FormItem><FormLabel>Columns</FormLabel><FormControl><Input {...field} type="number" min={1} max={10} onChange={e => field.onChange(parseInt(e.target.value) || 4)} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="rows" render={({ field }) => (
            <FormItem><FormLabel>Rows</FormLabel><FormControl><Input {...field} type="number" min={1} max={20} onChange={e => field.onChange(parseInt(e.target.value) || 5)} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="active" render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            <FormLabel className="!mt-0">Active</FormLabel>
          </FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-layout">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initial ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function PosLayouts() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosLayoutSet | undefined>();

  const { data: layouts = [], isLoading } = useQuery<PosLayoutSet[]>({ queryKey: ["/api/pos/layouts"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });
  const { data: terminals = [] } = useQuery<PosTerminal[]>({ queryKey: ["/api/pos/terminals"] });

  const locationMap = Object.fromEntries(locations.map(l => [l.id, l.name]));
  const terminalsByLayout = terminals.reduce<Record<string, number>>((acc, t) => {
    if (t.layoutSetId) acc[t.layoutSetId] = (acc[t.layoutSetId] || 0) + 1;
    return acc;
  }, {});

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/pos/layouts/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pos/layouts"] }); toast({ title: "Layout deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid className="w-6 h-6" />POS Layouts</h1>
          <p className="text-sm text-muted-foreground mt-1">Button grid layouts for GlobiPOS terminals</p>
        </div>
        <Button onClick={() => { setEditing(undefined); setOpen(true); }} data-testid="button-add-layout">
          <Plus className="w-4 h-4 mr-2" />New Layout
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : layouts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <LayoutGrid className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No layouts yet</p>
            <p className="text-sm mt-1">Create a button grid layout and assign it to terminals.</p>
            <Button className="mt-4" onClick={() => { setEditing(undefined); setOpen(true); }}>New Layout</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {layouts.map(layout => {
            const assignedTerminals = terminalsByLayout[layout.id] ?? 0;
            const locationName = layout.locationId ? locationMap[layout.locationId] : null;
            return (
              <Card key={layout.id} data-testid={`card-layout-${layout.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{layout.name}</CardTitle>
                    <Badge variant={layout.active ? "default" : "secondary"}>{layout.active ? "Active" : "Inactive"}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm space-y-1.5 text-muted-foreground">
                  {layout.description && <p>{layout.description}</p>}
                  <p>{layout.columns} × {layout.rows} grid ({layout.columns * layout.rows} buttons)</p>
                  {locationName && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />{locationName}
                    </p>
                  )}
                  <p className="flex items-center gap-1.5">
                    <Monitor className="w-3.5 h-3.5" />
                    {assignedTerminals === 0 ? "No terminals assigned" : `${assignedTerminals} terminal${assignedTerminals > 1 ? "s" : ""} assigned`}
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(layout); setOpen(true); }} data-testid={`button-edit-layout-${layout.id}`}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => navigate(`/pos/layouts/${layout.id}/edit`)}
                      data-testid={`button-designer-layout-${layout.id}`}
                    >
                      <Wand2 className="w-3.5 h-3.5 mr-1" />Edit Buttons
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate(layout.id)} data-testid={`button-delete-layout-${layout.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); setEditing(undefined); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Layout" : "New Layout"}</DialogTitle></DialogHeader>
          <LayoutForm initial={editing} onClose={() => { setOpen(false); setEditing(undefined); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
