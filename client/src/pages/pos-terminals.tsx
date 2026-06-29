import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPosTerminalSchema } from "@shared/schema";
import type { PosTerminal, PosLocation, PosLayoutSet } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Monitor, Plus, Pencil, Trash2, Loader2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const formSchema = insertPosTerminalSchema.extend({
  name: z.string().min(1, "Name required"),
  code: z.string().min(1, "Code required"),
  locationId: z.string().min(1, "Location required"),
});
type FormValues = z.infer<typeof formSchema>;

function TerminalForm({ initial, onClose }: { initial?: PosTerminal; onClose: () => void }) {
  const { toast } = useToast();
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });
  const { data: layouts = [] } = useQuery<PosLayoutSet[]>({ queryKey: ["/api/pos/layouts"] });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initial?.name ?? "",
      code: initial?.code ?? "",
      locationId: initial?.locationId ?? "",
      description: initial?.description ?? "",
      hardwareType: initial?.hardwareType ?? "desktop",
      layoutSetId: initial?.layoutSetId ?? undefined,
      active: initial?.active ?? true,
      outboxQueueSize: initial?.outboxQueueSize ?? 0,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormValues) => {
      if (initial) {
        const res = await apiRequest("PUT", `/api/pos/terminals/${initial.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/pos/terminals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/terminals"] });
      toast({ title: initial ? "Terminal updated" : "Terminal created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>Terminal Name</FormLabel><FormControl><Input {...field} placeholder="Checkout 1" data-testid="input-terminal-name" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} placeholder="T001" data-testid="input-terminal-code" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="locationId" render={({ field }) => (
          <FormItem>
            <FormLabel>Location</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger data-testid="select-terminal-location"><SelectValue placeholder="Select location" /></SelectTrigger></FormControl>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="hardwareType" render={({ field }) => (
          <FormItem>
            <FormLabel>Hardware Type</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField control={form.control} name="layoutSetId" render={({ field }) => (
          <FormItem>
            <FormLabel>Layout Set (optional)</FormLabel>
            <Select value={field.value ?? ""} onValueChange={v => field.onChange(v || undefined)}>
              <FormControl><SelectTrigger><SelectValue placeholder="No layout assigned" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="">No layout</SelectItem>
                {layouts.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} placeholder="Optional description" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="active" render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            <FormLabel className="!mt-0">Active</FormLabel>
          </FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-terminal">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initial ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function lastSeenLabel(t: any) {
  if (!t.lastSeenAt) return null;
  const diff = Date.now() - new Date(t.lastSeenAt).getTime();
  const online = diff < 5 * 60 * 1000;
  return { online, label: formatDistanceToNow(new Date(t.lastSeenAt), { addSuffix: true }) };
}

export default function PosTerminals() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosTerminal | undefined>();
  const [locationFilter, setLocationFilter] = useState<string>("");

  const { data: terminals = [], isLoading } = useQuery<(PosTerminal & { locationName?: string })[]>({ queryKey: ["/api/pos/terminals"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/pos/terminals/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pos/terminals"] }); toast({ title: "Terminal deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = locationFilter ? terminals.filter(t => t.locationId === locationFilter) : terminals;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Monitor className="w-6 h-6" />POS Terminals</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage checkout terminals across all locations</p>
        </div>
        <div className="flex gap-2">
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All locations</SelectItem>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => { setEditing(undefined); setOpen(true); }} data-testid="button-add-terminal">
            <Plus className="w-4 h-4 mr-2" />Add Terminal
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Monitor className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No terminals found</p>
            <p className="text-sm mt-1">{locationFilter ? "No terminals for this location." : "Add your first POS terminal."}</p>
            <Button className="mt-4" onClick={() => { setEditing(undefined); setOpen(true); }}>Add Terminal</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(t => {
            const seen = lastSeenLabel(t);
            return (
              <Card key={t.id} data-testid={`card-terminal-${t.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-1.5">
                        {seen && <span className={`w-2 h-2 rounded-full ${seen.online ? "bg-green-500" : "bg-gray-300"}`} />}
                        {t.name}
                      </CardTitle>
                      <code className="text-xs text-muted-foreground">{t.code}</code>
                    </div>
                    <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Active" : "Inactive"}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm space-y-1 text-muted-foreground">
                  <p>{t.locationName || t.locationId}</p>
                  <p className="capitalize">{t.hardwareType}</p>
                  {t.outboxQueueSize > 0 && <p className="text-amber-600 font-medium">{t.outboxQueueSize} pending sync</p>}
                  {seen && (
                    <p className="flex items-center gap-1 text-xs"><Clock className="w-3 h-3" /> Last seen {seen.label}</p>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(t as PosTerminal); setOpen(true); }} data-testid={`button-edit-terminal-${t.id}`}>
                      <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-delete-terminal-${t.id}`}>
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
          <DialogHeader><DialogTitle>{editing ? "Edit Terminal" : "New Terminal"}</DialogTitle></DialogHeader>
          <TerminalForm initial={editing} onClose={() => { setOpen(false); setEditing(undefined); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
