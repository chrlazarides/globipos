import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPosLocationSchema } from "@shared/schema";
import type { PosLocation } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { MapPin, Plus, Pencil, Trash2, Loader2, Building2 } from "lucide-react";

const formSchema = insertPosLocationSchema.extend({
  name: z.string().min(1, "Name required"),
  code: z.string().min(1, "Code required"),
});
type FormValues = z.infer<typeof formSchema>;

function LocationForm({ initial, onClose }: { initial?: PosLocation; onClose: () => void }) {
  const { toast } = useToast();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initial?.name ?? "",
      code: initial?.code ?? "",
      address: initial?.address ?? "",
      phone: initial?.phone ?? "",
      timezone: initial?.timezone ?? "Europe/Nicosia",
      currencyCode: initial?.currencyCode ?? "EUR",
      active: initial?.active ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      if (initial) {
        const res = await apiRequest("PUT", `/api/pos/locations/${initial.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/pos/locations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/locations"] });
      toast({ title: initial ? "Location updated" : "Location created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="Head Office" data-testid="input-location-name" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} placeholder="HO" data-testid="input-location-code" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="address" render={({ field }) => (
          <FormItem><FormLabel>Address</FormLabel><FormControl><Input {...field} placeholder="123 Main St, Nicosia" /></FormControl><FormMessage /></FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} placeholder="+357 22 000000" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="currencyCode" render={({ field }) => (
            <FormItem><FormLabel>Currency</FormLabel><FormControl><Input {...field} placeholder="EUR" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="timezone" render={({ field }) => (
          <FormItem><FormLabel>Timezone</FormLabel><FormControl><Input {...field} placeholder="Europe/Nicosia" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="active" render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            <FormLabel className="!mt-0">Active</FormLabel>
          </FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-location">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initial ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function PosLocations() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosLocation | undefined>();

  const { data: locations = [], isLoading } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/pos/locations/${id}`);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pos/locations"] }); toast({ title: "Location deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => { setEditing(undefined); setOpen(true); };
  const openEdit = (loc: PosLocation) => { setEditing(loc); setOpen(true); };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapPin className="w-6 h-6" />POS Locations</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage store locations for GlobiPOS terminals</p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-location"><Plus className="w-4 h-4 mr-2" />Add Location</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No locations yet</p>
            <p className="text-sm mt-1">Add your first POS location to get started.</p>
            <Button className="mt-4" onClick={openCreate}>Add Location</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map(loc => (
            <Card key={loc.id} data-testid={`card-location-${loc.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{loc.name}</CardTitle>
                    <code className="text-xs text-muted-foreground">{loc.code}</code>
                  </div>
                  <Badge variant={loc.active ? "default" : "secondary"}>{loc.active ? "Active" : "Inactive"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1 text-muted-foreground">
                {loc.address && <p className="truncate">{loc.address}</p>}
                {loc.phone && <p>{loc.phone}</p>}
                <p>{loc.currencyCode} · {loc.timezone}</p>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(loc)} data-testid={`button-edit-location-${loc.id}`}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate(loc.id)} data-testid={`button-delete-location-${loc.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); setEditing(undefined); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Location" : "New Location"}</DialogTitle></DialogHeader>
          <LocationForm initial={editing} onClose={() => { setOpen(false); setEditing(undefined); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
