import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Search, Users, Upload, Printer, TrendingUp, FileText, AlertTriangle, Euro, BarChart3, MapPin, Pencil, Trash2, Star } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertCustomerSchema, type Customer, type CustomerDeliveryLocation } from "@shared/schema";
import { ImportDialog } from "@/components/import-dialog";
import { usePriceLevels } from "@/hooks/use-price-levels";
import { z } from "zod";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip as RechartTooltip,
} from "recharts";

const customerImportFields = [
  { key: "name", label: "Business Name", required: true },
  { key: "code", label: "Customer Code", required: true },
  { key: "contactFirstName", label: "Contact First Name" },
  { key: "contactLastName", label: "Contact Last Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "taxId", label: "Tax ID" },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "creditLimit", label: "Credit Limit" },
  { key: "priceLevel", label: "Price Level" },
  { key: "location", label: "Location / Branch" },
  { key: "notes", label: "Notes" },
  { key: "portalAccessCode", label: "Portal Access Code" },
];

const customerFormSchema = insertCustomerSchema.extend({
  name: z.string().min(1, "Name is required"),
  code: z.string().optional().default(""),
});

export default function Customers() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: customers = [], isLoading } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const priceLevelNames = usePriceLevels();

  const createCustomer = useMutation({
    mutationFn: async (data: z.infer<typeof customerFormSchema>) => {
      const res = await apiRequest("POST", "/api/customers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/next-code"] });
      setDialogOpen(false);
      toast({ title: "Customer created successfully" });
    },
    onError: (e: Error) => toast({ title: "Duplicate Customer", description: e.message, variant: "destructive" }),
  });

  const updateCustomer = useMutation({
    mutationFn: async (data: z.infer<typeof customerFormSchema>) => {
      if (!profileCustomer) return;
      const res = await apiRequest("PATCH", `/api/customers/${profileCustomer.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      setProfileOpen(false);
      setProfileCustomer(null);
      toast({ title: "Customer updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleRowClick = (customer: Customer) => {
    setProfileCustomer(customer);
    setProfileOpen(true);
  };

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())
  );

  const paymentTermsLabel: Record<string, string> = {
    cash: "Cash", credit_7: "7 Days", credit_14: "14 Days", credit_30: "30 Days", credit_60: "60 Days", credit_90: "90 Days",
  };

  const handlePrint = () => {
    const rows = filtered.map((c) => `
      <tr>
        <td>${c.name}</td>
        <td>${c.code}</td>
        <td>${[c.contactFirstName, c.contactLastName].filter(Boolean).join(" ") || "-"}</td>
        <td>${c.phone || "-"}</td>
        <td>${c.email || "-"}</td>
        <td>${c.city || "-"}</td>
        <td>${paymentTermsLabel[c.paymentTerms] || c.paymentTerms}</td>
        <td style="text-align:right">€${parseFloat(c.currentBalance).toFixed(2)}</td>
        <td>${c.active ? "Active" : "Inactive"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><title>Customer List</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px; color: #111; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        p.sub { color: #666; font-size: 10px; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1a1a1a; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
        tr:last-child td { border-bottom: none; }
        tr:nth-child(even) td { background: #f9f9f9; }
        @media print { @page { margin: 15mm; size: A4 landscape; } }
      </style></head><body>
      <h1>Customer List</h1>
      <p class="sub">Printed ${new Date().toLocaleString()} &nbsp;·&nbsp; ${filtered.length} customer${filtered.length !== 1 ? "s" : ""}</p>
      <table>
        <thead><tr>
          <th>Business Name</th><th>Code</th><th>Contact</th><th>Phone</th><th>Email</th>
          <th>City</th><th>Terms</th><th style="text-align:right">Balance</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }</script>
      </body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.name}</p>
            <p className="text-xs text-muted-foreground">Acct: {row.code}</p>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => {
        const name = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ");
        return <span className="text-sm">{name || <span className="text-muted-foreground">—</span>}</span>;
      },
    },
    { key: "phone", header: "Phone", cell: (row) => <span className="text-sm text-muted-foreground">{row.phone || "-"}</span> },
    { key: "email", header: "Email", cell: (row) => <span className="text-sm text-muted-foreground">{row.email || "-"}</span> },
    { key: "city", header: "City", cell: (row) => <span className="text-sm">{row.city || "-"}</span> },
    {
      key: "terms",
      header: "Terms",
      cell: (row) => <Badge variant="secondary">{paymentTermsLabel[row.paymentTerms] || row.paymentTerms}</Badge>,
    },
    {
      key: "priceLevel",
      header: "Price Level",
      cell: (row) => <Badge variant="outline">{priceLevelNames[row.priceLevel - 1] || `Level ${row.priceLevel}`}</Badge>,
    },
    {
      key: "balance",
      header: "Balance",
      cell: (row) => (
        <span className={`text-sm font-medium ${parseFloat(row.currentBalance) > 0 ? "text-red-500" : ""}`}>
          €{parseFloat(row.currentBalance).toFixed(2)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge variant={row.active ? "default" : "secondary"}>{row.active ? "Active" : "Inactive"}</Badge>,
    },
  ];

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Customers"
        description="Manage wholesale customer accounts"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={handlePrint} data-testid="button-print-customers">
              <Printer className="w-4 h-4 mr-1" /> Print
            </Button>
            <Button variant="outline" onClick={() => setImportDialogOpen(true)} data-testid="button-import-customers">
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-customer">
                  <Plus className="w-4 h-4 mr-1" /> New Customer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>New Customer</DialogTitle>
                </DialogHeader>
                <CustomerForm onSubmit={(d) => createCustomer.mutate(d)} isPending={createCustomer.isPending} priceLevelNames={priceLevelNames} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-customers" />
          </div>
          <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="No customers found" onRowClick={handleRowClick} />
        </CardContent>
      </Card>

      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        title="Import Customers from Excel"
        description="Upload an Excel or CSV file to bulk import customer accounts"
        fields={customerImportFields}
        apiEndpoint="/api/customers/import"
        onSuccess={handleImportSuccess}
      />

      {profileCustomer && (
        <CustomerProfileDialog
          customer={profileCustomer}
          open={profileOpen}
          onOpenChange={(open) => { setProfileOpen(open); if (!open) setProfileCustomer(null); }}
          onSave={(d) => updateCustomer.mutate(d)}
          isPending={updateCustomer.isPending}
          priceLevelNames={priceLevelNames}
        />
      )}
    </div>
  );
}

interface CustomerAnalytics {
  revenue: number;
  profit: number;
  invoiceCount: number;
  overdueCount: number;
  avgInvoiceValue: number;
  marginPct: number;
  creditUtilization: number;
  scores: { revenue: number; margin: number; activity: number; payment: number; creditHealth: number };
}

const RADAR_COLOR = "#6366f1";

function CustomerProfileDialog({
  customer, open, onOpenChange, onSave, isPending, priceLevelNames,
}: {
  customer: Customer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (d: any) => void;
  isPending: boolean;
  priceLevelNames: string[];
}) {
  const { data: analytics, isLoading: analyticsLoading } = useQuery<CustomerAnalytics>({
    queryKey: ["/api/customers", customer.id, "analytics"],
    queryFn: () => fetch(`/api/customers/${customer.id}/analytics`).then(r => r.json()),
    enabled: open,
  });

  const paymentTermsLabel: Record<string, string> = {
    cash: "Cash", credit_7: "7 Days", credit_14: "14 Days", credit_30: "30 Days", credit_60: "60 Days", credit_90: "90 Days",
  };

  const radarData = analytics ? [
    { axis: "Revenue", value: analytics.scores.revenue },
    { axis: "Margin", value: analytics.scores.margin },
    { axis: "Activity", value: analytics.scores.activity },
    { axis: "Payment", value: analytics.scores.payment },
    { axis: "Credit Health", value: analytics.scores.creditHealth },
  ] : [];

  const fmt = (n: number) => `€${n.toLocaleString("el-CY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            {customer.name}
            <Badge variant="outline" className="ml-1 text-xs font-mono">{customer.code}</Badge>
            <Badge variant={customer.active ? "default" : "secondary"} className="text-xs">{customer.active ? "Active" : "Inactive"}</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="performance">
          <TabsList className="mb-4">
            <TabsTrigger value="performance" data-testid="tab-customer-performance">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" />Performance
            </TabsTrigger>
            <TabsTrigger value="details" data-testid="tab-customer-details">
              <FileText className="w-3.5 h-3.5 mr-1.5" />Details
            </TabsTrigger>
            <TabsTrigger value="locations" data-testid="tab-customer-locations">
              <MapPin className="w-3.5 h-3.5 mr-1.5" />Locations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="performance" className="space-y-4">
            {analyticsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : analytics ? (
              <>
                {/* KPI strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Total Revenue", value: fmt(analytics.revenue), icon: Euro, color: "text-indigo-500" },
                    { label: "Gross Profit", value: fmt(analytics.profit), icon: TrendingUp, color: analytics.profit >= 0 ? "text-emerald-600" : "text-red-500" },
                    { label: "Invoices", value: String(analytics.invoiceCount), icon: FileText, color: "text-blue-500" },
                    { label: "Overdue", value: String(analytics.overdueCount), icon: AlertTriangle, color: analytics.overdueCount > 0 ? "text-red-500" : "text-muted-foreground" },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="rounded-lg border bg-card p-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                        <Icon className={`w-3.5 h-3.5 ${color}`} />{label}
                      </div>
                      <p className={`text-base font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Radar + side stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis
                          dataKey="axis"
                          tick={{ fill: "#94a3b8", fontSize: 11 }}
                        />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <RechartTooltip
                          formatter={(v: any) => [`${v}/100`, ""]}
                          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}
                        />
                        <Radar
                          dataKey="value"
                          stroke={RADAR_COLOR}
                          fill={RADAR_COLOR}
                          fillOpacity={0.18}
                          strokeWidth={2}
                          dot={{ r: 4, fill: RADAR_COLOR, strokeWidth: 0 }}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-2.5 text-sm">
                    {[
                      { label: "Margin", score: analytics.scores.margin, display: `${analytics.marginPct}%` },
                      { label: "Avg Invoice", score: analytics.scores.activity, display: fmt(analytics.avgInvoiceValue) },
                      { label: "Payment Terms", score: analytics.scores.payment, display: paymentTermsLabel[customer.paymentTerms] || customer.paymentTerms },
                      { label: "Credit Used", score: analytics.scores.creditHealth, display: `${analytics.creditUtilization}%` },
                    ].map(({ label, score, display }) => (
                      <div key={label} className="flex items-center gap-2">
                        <span className="w-24 text-xs text-muted-foreground shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${score}%`, background: score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444" }}
                          />
                        </div>
                        <span className="text-xs font-mono w-16 text-right text-muted-foreground">{display}</span>
                      </div>
                    ))}
                    <div className="pt-1 border-t text-xs text-muted-foreground">
                      Scores are normalized (0–100). Revenue vs €25k, margin vs 40%, activity vs 50 invoices.
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data available.</p>
            )}
          </TabsContent>

          <TabsContent value="details">
            <CustomerForm
              onSubmit={onSave}
              isPending={isPending}
              priceLevelNames={priceLevelNames}
              defaultValues={{
                name: customer.name,
                code: customer.code,
                contactFirstName: customer.contactFirstName || "",
                contactLastName: customer.contactLastName || "",
                email: customer.email || "",
                phone: customer.phone || "",
                address: customer.address || "",
                city: customer.city || "",
                taxId: customer.taxId || "",
                paymentTerms: customer.paymentTerms,
                creditLimit: customer.creditLimit || "0",
                currentBalance: customer.currentBalance || "0",
                priceLevel: customer.priceLevel,
                notes: customer.notes || "",
                location: customer.location || "",
                active: customer.active,
              }}
            />
          </TabsContent>

          <TabsContent value="locations">
            <CustomerLocationsTab customerId={customer.id} open={open} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CustomerLocationsTab({ customerId, open }: { customerId: string; open: boolean }) {
  const { toast } = useToast();
  const [editingLoc, setEditingLoc] = useState<CustomerDeliveryLocation | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formDefault, setFormDefault] = useState(false);

  const { data: locations = [], isLoading } = useQuery<CustomerDeliveryLocation[]>({
    queryKey: ["/api/customers", customerId, "delivery-locations"],
    queryFn: () => fetch(`/api/customers/${customerId}/delivery-locations`, { credentials: "include" }).then(r => r.json()),
    enabled: open,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/customers", customerId, "delivery-locations"] });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; address: string; isDefault: boolean }) => {
      const res = await apiRequest("POST", `/api/customers/${customerId}/delivery-locations`, data);
      return res.json();
    },
    onSuccess: () => { invalidate(); resetForm(); setAddOpen(false); toast({ title: "Location added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/customers/${customerId}/delivery-locations/${id}`, data);
      return res.json();
    },
    onSuccess: () => { invalidate(); resetForm(); setAddOpen(false); toast({ title: "Location updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/customers/${customerId}/delivery-locations/${id}`);
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Location deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function resetForm() {
    setFormName(""); setFormAddress(""); setFormDefault(false); setEditingLoc(null);
  }

  function openAdd() { resetForm(); setAddOpen(true); }

  function openEdit(loc: CustomerDeliveryLocation) {
    setEditingLoc(loc); setFormName(loc.name); setFormAddress(loc.address || ""); setFormDefault(loc.isDefault); setAddOpen(true);
  }

  function handleSave() {
    if (!formName.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    const payload = { name: formName.trim(), address: formAddress.trim() || "", isDefault: formDefault };
    if (editingLoc) {
      updateMutation.mutate({ id: editingLoc.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Saved delivery locations used during invoicing.</p>
        <Button size="sm" onClick={openAdd} data-testid="button-add-location">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Location
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No delivery locations saved yet
        </div>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
              <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{loc.name}</span>
                  {loc.isDefault && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">
                      <Star className="w-2.5 h-2.5 mr-1 fill-current" />Default
                    </Badge>
                  )}
                </div>
                {loc.address && <p className="text-xs text-muted-foreground mt-0.5 truncate">{loc.address}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(loc)} data-testid={`button-edit-loc-${loc.id}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" disabled={deleteMutation.isPending}
                  onClick={() => { if (confirm(`Delete "${loc.name}"?`)) deleteMutation.mutate(loc.id); }}
                  data-testid={`button-delete-loc-${loc.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { resetForm(); } setAddOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingLoc ? "Edit Location" : "Add Delivery Location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Location Name *</label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Nicosia Branch, Beach Bar…" data-testid="input-loc-name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Address (optional)</label>
              <Input value={formAddress} onChange={e => setFormAddress(e.target.value)} placeholder="Street, city…" data-testid="input-loc-address" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="loc-default" checked={formDefault} onChange={e => setFormDefault(e.target.checked)} className="rounded" data-testid="checkbox-loc-default" />
              <label htmlFor="loc-default" className="text-sm cursor-pointer">Set as default delivery location</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => { resetForm(); setAddOpen(false); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending} data-testid="button-save-location">
              {isPending ? "Saving…" : editingLoc ? "Save Changes" : "Add Location"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CustomerForm({ onSubmit, isPending, defaultValues, priceLevelNames }: { onSubmit: (d: any) => void; isPending: boolean; defaultValues?: any; priceLevelNames: string[] }) {
  const isEditing = !!defaultValues?.code;
  const { data: nextCodeData } = useQuery<{ code: string }>({
    queryKey: ["/api/customers/next-code"],
    enabled: !isEditing,
  });

  const form = useForm({
    resolver: zodResolver(customerFormSchema),
    defaultValues: defaultValues || {
      name: "", code: "", contactFirstName: "", contactLastName: "",
      email: "", phone: "", address: "", city: "", taxId: "",
      paymentTerms: "cash", creditLimit: "0", currentBalance: "0", priceLevel: 1, notes: "", location: "", active: true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Business Name</FormLabel>
              <FormControl><Input {...field} data-testid="input-customer-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem>
              <FormLabel>Account Number</FormLabel>
              <FormControl><Input {...field} placeholder={nextCodeData?.code || "Auto-generated"} data-testid="input-customer-code" disabled={isEditing} /></FormControl>
              <FormMessage />
              {!isEditing && <p className="text-xs text-muted-foreground">Leave blank to auto-generate</p>}
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="contactFirstName" render={({ field }) => (
            <FormItem>
              <FormLabel>Contact First Name</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-contact-firstname" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="contactLastName" render={({ field }) => (
            <FormItem>
              <FormLabel>Contact Last Name</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-contact-lastname" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl><Input type="email" {...field} value={field.value || ""} data-testid="input-customer-email" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-phone" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="address" render={({ field }) => (
          <FormItem>
            <FormLabel>Address</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-customer-address" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="city" render={({ field }) => (
            <FormItem>
              <FormLabel>City</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-city" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="taxId" render={({ field }) => (
            <FormItem>
              <FormLabel>Tax ID</FormLabel>
              <FormControl><Input {...field} value={field.value || ""} data-testid="input-customer-taxid" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormField control={form.control} name="paymentTerms" render={({ field }) => (
            <FormItem>
              <FormLabel>Payment Terms</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-payment-terms">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit_7">7 Days Credit</SelectItem>
                  <SelectItem value="credit_14">14 Days Credit</SelectItem>
                  <SelectItem value="credit_30">30 Days Credit</SelectItem>
                  <SelectItem value="credit_60">60 Days Credit</SelectItem>
                  <SelectItem value="credit_90">90 Days Credit</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="creditLimit" render={({ field }) => (
            <FormItem>
              <FormLabel>Credit Limit</FormLabel>
              <FormControl><Input type="number" step="0.01" {...field} data-testid="input-credit-limit" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="priceLevel" render={({ field }) => (
            <FormItem>
              <FormLabel>Price Level</FormLabel>
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(parseInt(v))}>
                <FormControl>
                  <SelectTrigger data-testid="select-price-level">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((l) => (
                    <SelectItem key={l} value={String(l)}>{priceLevelNames[l - 1] || `Level ${l}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="location" render={({ field }) => (
          <FormItem>
            <FormLabel>Location / Branch</FormLabel>
            <FormControl><Input {...field} value={field.value || ""} placeholder="e.g. Nicosia Main Branch, Ayia Napa Beach Bar…" data-testid="input-customer-location" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Notes</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-customer-notes" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-customer">
            {isPending ? "Saving..." : "Save Customer"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export { CustomerForm };
