import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Tag, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { PosPromotion, PosLocation } from "@shared/schema";

const PROMO_TYPES = [
  { value: "buy_n_get_m", label: "Buy N Get M" },
  { value: "qty_threshold", label: "Qty Threshold" },
  { value: "meal_deal", label: "Meal Deal" },
  { value: "coupon", label: "Coupon" },
  { value: "mix_match", label: "Mix & Match" },
];

const BLANK: Partial<PosPromotion> = {
  name: "", type: "qty_threshold", locationId: "",
  thresholdQty: 1, getQty: 1, discountPct: "0", discountFixed: "0",
  couponCode: "", priority: 0, stackable: false, active: true,
  validFrom: null, validUntil: null,
};

function typeBadge(type: string) {
  const map: Record<string, string> = {
    buy_n_get_m: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    qty_threshold: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    meal_deal: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    coupon: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
    mix_match: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  };
  const label = PROMO_TYPES.find(t => t.value === type)?.label ?? type;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[type] ?? ""}`}>{label}</span>;
}

export default function PosPromotions() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editPromo, setEditPromo] = useState<Partial<PosPromotion> | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data: promos = [], isLoading } = useQuery<PosPromotion[]>({ queryKey: ["/api/pos/promotions"] });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });

  const saveMutation = useMutation({
    mutationFn: (data: Partial<PosPromotion>) =>
      isNew
        ? apiRequest("POST", "/api/pos/promotions", data)
        : apiRequest("PUT", `/api/pos/promotions/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/promotions"] });
      toast({ title: isNew ? "Promotion created" : "Promotion updated" });
      setEditPromo(null);
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/pos/promotions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/promotions"] });
      toast({ title: "Promotion deleted" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Error", description: e.message }),
  });

  const filtered = promos.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.type.toLowerCase().includes(search.toLowerCase()) ||
    (p.couponCode ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function openNew() { setIsNew(true); setEditPromo({ ...BLANK }); }
  function openEdit(p: PosPromotion) { setIsNew(false); setEditPromo({ ...p }); }

  function handleSave() {
    if (!editPromo?.name?.trim()) { toast({ variant: "destructive", title: "Name is required" }); return; }
    saveMutation.mutate(editPromo);
  }

  function field(key: keyof PosPromotion, value: any) {
    setEditPromo(prev => ({ ...prev, [key]: value }));
  }

  const locationName = (id: string | null) => locations.find(l => l.id === id)?.name ?? "All Locations";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="POS Promotions"
        subtitle="Manage in-store deals, discounts, and coupon codes"
        icon={<Tag className="w-5 h-5" />}
        action={<Button onClick={openNew} data-testid="button-new-promo"><Plus className="w-4 h-4 mr-2" />New Promotion</Button>}
      />

      <div className="flex gap-3">
        <Input
          placeholder="Search promotions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search-promos"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Tag className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">{search ? "No promotions match your search" : "No promotions yet"}</p>
          {!search && <Button variant="outline" onClick={openNew}>Create your first promotion</Button>}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Discount</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Valid Until</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-promo-${p.id}`}>
                  <td className="px-4 py-3 font-medium">
                    {p.name}
                    {p.couponCode && <span className="ml-2 text-xs text-muted-foreground font-mono">#{p.couponCode}</span>}
                  </td>
                  <td className="px-4 py-3">{typeBadge(p.type)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{locationName(p.locationId)}</td>
                  <td className="px-4 py-3">
                    {parseFloat(String(p.discountPct)) > 0
                      ? <span className="text-green-600 font-medium">{p.discountPct}%</span>
                      : parseFloat(String(p.discountFixed)) > 0
                      ? <span className="text-green-600 font-medium">€{p.discountFixed}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.validUntil ? format(new Date(p.validUntil), "dd MMM yy") : "No expiry"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={p.active ? "default" : "secondary"}>{p.active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)} data-testid={`button-edit-promo-${p.id}`}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p.id); }}
                        data-testid={`button-delete-promo-${p.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / Create Dialog */}
      {editPromo && (
        <Dialog open onOpenChange={o => { if (!o) setEditPromo(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{isNew ? "New Promotion" : "Edit Promotion"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={editPromo.name ?? ""} onChange={e => field("name", e.target.value)} placeholder="e.g. Happy Hour 20% Off" data-testid="input-promo-name" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={editPromo.type ?? "qty_threshold"} onValueChange={v => field("type", v)}>
                    <SelectTrigger data-testid="select-promo-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROMO_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Location</Label>
                  <Select value={editPromo.locationId ?? ""} onValueChange={v => field("locationId", v)}>
                    <SelectTrigger><SelectValue placeholder="All locations" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Locations</SelectItem>
                      {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Discount %</Label>
                  <Input type="number" min="0" max="100" value={editPromo.discountPct ?? "0"} onChange={e => field("discountPct", e.target.value)} data-testid="input-promo-pct" />
                </div>
                <div className="space-y-1">
                  <Label>Fixed Discount (€)</Label>
                  <Input type="number" min="0" value={editPromo.discountFixed ?? "0"} onChange={e => field("discountFixed", e.target.value)} data-testid="input-promo-fixed" />
                </div>
              </div>
              {editPromo.type === "buy_n_get_m" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Buy (N)</Label>
                    <Input type="number" min="1" value={editPromo.thresholdQty ?? 2} onChange={e => field("thresholdQty", parseInt(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Get (M)</Label>
                    <Input type="number" min="1" value={editPromo.getQty ?? 1} onChange={e => field("getQty", parseInt(e.target.value))} />
                  </div>
                </div>
              )}
              {editPromo.type === "coupon" && (
                <div className="space-y-1">
                  <Label>Coupon Code</Label>
                  <Input value={editPromo.couponCode ?? ""} onChange={e => field("couponCode", e.target.value)} placeholder="e.g. SUMMER20" data-testid="input-promo-code" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Valid From</Label>
                  <Input type="date" value={editPromo.validFrom ? String(editPromo.validFrom).slice(0, 10) : ""} onChange={e => field("validFrom", e.target.value || null)} />
                </div>
                <div className="space-y-1">
                  <Label>Valid Until</Label>
                  <Input type="date" value={editPromo.validUntil ? String(editPromo.validUntil).slice(0, 10) : ""} onChange={e => field("validUntil", e.target.value || null)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={!!editPromo.active} onCheckedChange={v => field("active", v)} id="promo-active" data-testid="switch-promo-active" />
                  <Label htmlFor="promo-active">Active</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={!!editPromo.stackable} onCheckedChange={v => field("stackable", v)} id="promo-stack" />
                  <Label htmlFor="promo-stack">Stackable</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPromo(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-promo">
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
