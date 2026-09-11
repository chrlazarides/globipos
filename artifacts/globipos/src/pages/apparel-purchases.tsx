import { useState, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Shirt, Trash2, Pencil, Grid3x3 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Supplier, Item, ItemVariant, PurchaseInvoice, PurchaseInvoiceItem } from "@shared/schema";

interface PurchaseInvoiceWithSupplier extends PurchaseInvoice {
  supplierName: string;
}

interface PurchaseInvoiceDetail extends PurchaseInvoice {
  items: PurchaseInvoiceItem[];
  supplierName: string;
}

interface LineItem {
  itemId: string;
  variantId?: string | null;
  description: string;
  quantity: number;
  purchaseUnit: string;
  unitCost: string;
  discountPercent: string;
  discount: string;
  vatRate: string;
  total: string;
  salePrice: string;
}

interface PurchaseSummary {
  totalOutstanding: string;
  totalCount: number;
  dueThisMonth: string;
  overdue: string;
  overdueCount: number;
}

export default function ApparelPurchases() {
  const search = useSearch();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const openId = new URLSearchParams(search).get("open");
    if (openId) {
      setEditingId(openId);
      setFormOpen(true);
    }
  }, [search]);

  const { data: invoices = [], isLoading } = useQuery<PurchaseInvoiceWithSupplier[]>({ queryKey: ["/api/purchase-invoices"] });
  const { data: summary } = useQuery<PurchaseSummary>({ queryKey: ["/api/purchase-invoices/summary"] });
  const { data: currentUser } = useQuery<{ id: string; username: string; role: string }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "superuser";

  const handleEdit = (row: PurchaseInvoiceWithSupplier) => {
    setEditingId(row.id);
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
    setEditingId(null);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/purchase-invoices/${id}`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Purchase invoice deleted", description: "Stock and supplier balance have been reversed." });
    },
    onError: (e: Error) => toast({ title: "Cannot delete", description: e.message, variant: "destructive" }),
  });

  const columns: Column<PurchaseInvoiceWithSupplier>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (row) => (
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Shirt className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.invoiceNumber}</p>
            <p className="text-xs text-muted-foreground sm:hidden">{row.supplierName}</p>
            {row.supplierInvoiceRef && <p className="text-xs text-muted-foreground">Ref: {row.supplierInvoiceRef}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => <span className="text-sm hidden sm:inline">{row.supplierName}</span>,
      className: "hidden sm:table-cell",
    },
    {
      key: "date",
      header: "Date",
      cell: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
      className: "hidden md:table-cell",
    },
    {
      key: "total",
      header: "Total",
      cell: (row) => <span className="text-sm font-medium">{"\u20AC"}{parseFloat(row.total).toFixed(2)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={row.status === "confirmed" ? "default" : row.status === "draft" ? "secondary" : "destructive"}>
          {row.status}
        </Badge>
      ),
      className: "hidden sm:table-cell",
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => handleEdit(row)} data-testid={`button-edit-apparel-purchase-${row.id}`}>
            <Pencil className="w-4 h-4" />
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              disabled={deleteMutation.isPending}
              data-testid={`button-delete-apparel-purchase-${row.id}`}
              onClick={() => {
                if (confirm(`Delete purchase invoice "${row.invoiceNumber}" (${row.supplierName}, €${parseFloat(row.total).toFixed(2)})?\n\nThis will reverse stock quantities and the supplier balance. This cannot be undone.`)) {
                  deleteMutation.mutate(row.id);
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHeader
        title="Apparel Purchases"
        description="Supplier invoices for apparel — add stock quickly using the color/size matrix"
        icon={<Grid3x3 className="w-5 h-5" />}
        action={
          <Button onClick={() => { setEditingId(null); setFormOpen(true); }} data-testid="button-new-apparel-purchase">
            <Plus className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">New Purchase</span><span className="sm:hidden">New</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Outstanding</p>
            {summary ? (
              <>
                <p className="text-2xl font-bold tabular-nums">€{parseFloat(summary.totalOutstanding).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{summary.totalCount} invoice{summary.totalCount !== 1 ? "s" : ""}</p>
              </>
            ) : (
              <div className="h-7 w-24 bg-muted animate-pulse rounded mt-1" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Due This Month</p>
            {summary ? (
              <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">€{parseFloat(summary.dueThisMonth).toFixed(2)}</p>
            ) : (
              <div className="h-7 w-24 bg-muted animate-pulse rounded mt-1" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Overdue</p>
            {summary ? (
              <>
                <p className={`text-2xl font-bold tabular-nums ${parseFloat(summary.overdue) > 0 ? "text-destructive" : ""}`}>
                  €{parseFloat(summary.overdue).toFixed(2)}
                </p>
                {summary.overdueCount > 0 && (
                  <p className="text-xs text-destructive mt-0.5">{summary.overdueCount} invoice{summary.overdueCount !== 1 ? "s" : ""}</p>
                )}
              </>
            ) : (
              <div className="h-7 w-24 bg-muted animate-pulse rounded mt-1" />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) handleClose(); else setFormOpen(true); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Apparel Purchase" : "New Apparel Purchase"}</DialogTitle>
          </DialogHeader>
          <ApparelPurchaseForm
            editingId={editingId}
            onSuccess={() => {
              handleClose();
              toast({ title: editingId ? "Purchase invoice updated" : "Purchase invoice created, stock updated" });
            }}
          />
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-2 sm:p-4">
          <DataTable columns={columns} data={invoices} isLoading={isLoading} emptyMessage="No apparel purchase invoices found" />
        </CardContent>
      </Card>
    </div>
  );
}

const NO_QUALITY = "__none__";

function ApparelPurchaseForm({ editingId, onSuccess }: { editingId: string | null; onSuccess: () => void }) {
  const { toast } = useToast();
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: allItems = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: existingInvoice } = useQuery<PurchaseInvoiceDetail>({
    queryKey: ["/api/purchase-invoices", editingId],
    enabled: !!editingId,
  });

  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Matrix quick-add state
  const [matrixItemId, setMatrixItemId] = useState("");
  const [matrixItemSearch, setMatrixItemSearch] = useState("");
  const [activeQuality, setActiveQuality] = useState<string>(NO_QUALITY);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [unitCosts, setUnitCosts] = useState<Record<string, string>>({});

  const apparelItems = useMemo(() => allItems.filter(i => i.hasVariants), [allItems]);
  const filteredMatrixItems = apparelItems.filter(i =>
    !matrixItemSearch || i.name.toLowerCase().includes(matrixItemSearch.toLowerCase()) || i.sku.toLowerCase().includes(matrixItemSearch.toLowerCase())
  ).slice(0, 50);

  const matrixItem = allItems.find(i => i.id === matrixItemId);

  const { data: matrixVariants = [] } = useQuery<ItemVariant[]>({
    queryKey: ["/api/items", matrixItemId, "variants"],
    enabled: !!matrixItemId,
  });

  const activeVariants = matrixVariants.filter(v => v.active);
  const columnValues = useMemo(() => Array.from(new Set(activeVariants.map(v => v.option1Value || "—"))), [activeVariants]);
  const rowValues = useMemo(() => Array.from(new Set(activeVariants.map(v => v.option2Value || "—"))), [activeVariants]);
  const qualities = useMemo(() => Array.from(new Set(activeVariants.map(v => v.option3Value).filter(Boolean))) as string[], [activeVariants]);
  const option1Name = activeVariants[0]?.option1Name || "Color";
  const option2Name = activeVariants[0]?.option2Name || "Size";

  const findVariant = (col: string, row: string, quality: string) => activeVariants.find(v =>
    (v.option1Value || "—") === col && (v.option2Value || "—") === row && (quality === NO_QUALITY ? !v.option3Value : v.option3Value === quality)
  );

  const resetMatrix = () => {
    setMatrixItemId("");
    setMatrixItemSearch("");
    setActiveQuality(NO_QUALITY);
    setQuantities({});
    setUnitCosts({});
  };

  const addMatrixToInvoice = () => {
    if (!matrixItem) return;
    const activeQualityKey = qualities.length > 0 ? activeQuality : NO_QUALITY;
    const newLines: LineItem[] = [];
    for (const col of columnValues) {
      for (const row of rowValues) {
        const variant = findVariant(col, row, activeQualityKey);
        if (!variant) continue;
        const key = variant.id;
        const qty = parseInt(quantities[key] || "0", 10) || 0;
        if (qty <= 0) continue;
        const cost = unitCosts[key] !== undefined ? unitCosts[key] : (variant.costPrice || matrixItem.costPrice || "0");
        const costNum = parseFloat(cost) || 0;
        const variantLabel = [variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join(" / ");
        newLines.push({
          itemId: matrixItem.id,
          variantId: variant.id,
          description: variantLabel ? `${matrixItem.name} (${variantLabel})` : matrixItem.name,
          quantity: qty,
          purchaseUnit: "pc",
          unitCost: costNum.toFixed(2),
          discountPercent: "0",
          discount: "0",
          vatRate: String(matrixItem.vatRate || "19"),
          total: (qty * costNum).toFixed(2),
          salePrice: variant.price1 || matrixItem.price1 || "0",
        });
      }
    }
    if (newLines.length === 0) {
      toast({ title: "Enter at least one quantity in the matrix", variant: "destructive" });
      return;
    }
    setLineItems(prev => [...prev, ...newLines]);
    toast({ title: `${newLines.length} line(s) added from matrix` });
    resetMatrix();
  };

  const calcDueDate = (invoiceDate: string, terms: string) => {
    if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return invoiceDate;
    const d = new Date(invoiceDate + "T00:00:00");
    if (isNaN(d.getTime())) return invoiceDate;
    const match = terms.match(/credit_(\d+)/);
    if (match) {
      d.setDate(d.getDate() + parseInt(match[1]));
    }
    return d.toISOString().split("T")[0];
  };

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    const supplier = suppliers.find(s => s.id === id);
    if (supplier) {
      setDueDate(supplier.paymentTerms === "cash" ? date : calcDueDate(date, supplier.paymentTerms));
    }
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    const supplier = suppliers.find(s => s.id === supplierId);
    if (supplier) {
      setDueDate(supplier.paymentTerms === "cash" ? newDate : calcDueDate(newDate, supplier.paymentTerms));
    }
  };

  useEffect(() => {
    if (editingId && existingInvoice && !loaded) {
      setSupplierId(existingInvoice.supplierId);
      setSupplierInvoiceRef(existingInvoice.supplierInvoiceRef || "");
      setDate(existingInvoice.date);
      setDueDate(existingInvoice.dueDate || "");
      setNotes(existingInvoice.notes || "");
      setLineItems(existingInvoice.items.map(li => {
        const item = allItems.find(i => i.id === li.itemId);
        return {
          itemId: li.itemId,
          variantId: li.variantId || null,
          description: li.description,
          quantity: li.quantity,
          purchaseUnit: li.purchaseUnit,
          unitCost: li.unitCost,
          discountPercent: li.discountPercent || "0",
          discount: li.discount || "0",
          vatRate: li.vatRate,
          total: li.total,
          salePrice: item ? item.price1 : "0",
        };
      }));
      setLoaded(true);
    }
  }, [editingId, existingInvoice, loaded, allItems]);

  const updateLine = (index: number, field: keyof LineItem, value: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };

    if (field === "discountPercent") {
      const qty = parseFloat(String(updated[index].quantity)) || 0;
      const cost = parseFloat(updated[index].unitCost) || 0;
      const gross = qty * cost;
      const pct = parseFloat(value) || 0;
      const discAmt = (gross * pct / 100);
      updated[index].discount = discAmt.toFixed(2);
      updated[index].total = (gross - discAmt).toFixed(2);
    } else if (field === "discount") {
      const qty = parseFloat(String(updated[index].quantity)) || 0;
      const cost = parseFloat(updated[index].unitCost) || 0;
      const gross = qty * cost;
      const discAmt = parseFloat(value) || 0;
      updated[index].discountPercent = gross > 0 ? ((discAmt / gross) * 100).toFixed(2) : "0";
      updated[index].total = (gross - discAmt).toFixed(2);
    } else if (["quantity", "unitCost"].includes(field)) {
      const qty = parseFloat(String(updated[index].quantity)) || 0;
      const cost = parseFloat(updated[index].unitCost) || 0;
      const gross = qty * cost;
      const pct = parseFloat(updated[index].discountPercent) || 0;
      const discAmt = (gross * pct / 100);
      updated[index].discount = discAmt.toFixed(2);
      updated[index].total = (gross - discAmt).toFixed(2);
    }

    setLineItems(updated);
  };

  const removeLine = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const subtotal = lineItems.reduce((sum, li) => sum + (parseFloat(li.total) || 0), 0);
  const vatAmount = lineItems.reduce((sum, li) => {
    const lineTotal = parseFloat(li.total) || 0;
    const rate = parseFloat(li.vatRate) || 0;
    return sum + (lineTotal * rate / 100);
  }, 0);
  const total = subtotal + vatAmount;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Select a supplier");
      if (lineItems.length === 0) throw new Error("Add at least one item");
      for (const li of lineItems) {
        if (!li.itemId) throw new Error("Select an item for each line");
      }

      const payload = {
        supplierId,
        supplierInvoiceRef: supplierInvoiceRef || null,
        date,
        dueDate: dueDate || null,
        subtotal: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        total: total.toFixed(2),
        status: "confirmed",
        notes: notes || null,
        invoiceNumber: editingId ? existingInvoice?.invoiceNumber || "TEMP" : "TEMP",
        items: lineItems.map(li => ({
          itemId: li.itemId,
          variantId: li.variantId || null,
          description: li.description,
          quantity: li.quantity,
          purchaseUnit: li.purchaseUnit,
          unitCost: li.unitCost,
          discountPercent: li.discountPercent,
          discount: li.discount,
          vatRate: li.vatRate,
          total: li.total,
          purchaseInvoiceId: editingId || "TEMP",
        })),
      };

      if (editingId) {
        const res = await apiRequest("PUT", `/api/purchase-invoices/${editingId}`, payload);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/purchase-invoices", payload);
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/item-variants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (editingId && !existingInvoice) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  const activeQualityKey = qualities.length > 0 ? activeQuality : NO_QUALITY;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="text-sm font-medium">Supplier</label>
          <Select value={supplierId} onValueChange={handleSupplierChange}>
            <SelectTrigger data-testid="select-apparel-purchase-supplier">
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {supplierId && (() => {
            const s = suppliers.find(sup => sup.id === supplierId);
            if (!s) return null;
            const termsLabel = s.paymentTerms === "cash" ? "Cash" : s.paymentTerms.replace("credit_", "Credit ") + " days";
            return <p className="text-xs text-muted-foreground mt-1">Terms: {termsLabel}</p>;
          })()}
        </div>
        <div>
          <label className="text-sm font-medium">Supplier Invoice Ref</label>
          <Input value={supplierInvoiceRef} onChange={e => setSupplierInvoiceRef(e.target.value)} placeholder="Supplier's ref number" data-testid="input-apparel-purchase-ref" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="text-sm font-medium">Date</label>
          <Input type="date" value={date} onChange={e => handleDateChange(e.target.value)} data-testid="input-apparel-purchase-date" />
        </div>
        <div>
          <label className="text-sm font-medium">Due Date</label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-apparel-purchase-due-date" />
        </div>
      </div>

      <Card>
        <CardHeader className="p-3">
          <CardTitle className="text-sm flex items-center gap-2"><Grid3x3 className="w-4 h-4" /> Add Items by Matrix ({option1Name} × {option2Name})</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          <div className="space-y-2">
            <Label>Item</Label>
            <Input
              placeholder="Search apparel item by name or SKU…"
              value={matrixItemSearch}
              onChange={e => setMatrixItemSearch(e.target.value)}
              data-testid="input-apparel-matrix-item-search"
            />
            <Select value={matrixItemId} onValueChange={setMatrixItemId} data-testid="select-apparel-matrix-item">
              <SelectTrigger>
                <SelectValue placeholder="Select an apparel item with variants…" />
              </SelectTrigger>
              <SelectContent>
                {filteredMatrixItems.map(i => (
                  <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku})</SelectItem>
                ))}
                {filteredMatrixItems.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No apparel items with a color/size matrix found. Set them up in Variant Matrix & Barcodes first.</div>
                )}
              </SelectContent>
            </Select>
          </div>

          {matrixItem && activeVariants.length === 0 && (
            <p className="text-xs text-muted-foreground">This item has no active variants yet. Generate them from Variant Matrix & Barcodes first.</p>
          )}

          {matrixItem && activeVariants.length > 0 && (
            <div className="space-y-3">
              {qualities.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {qualities.map(q => (
                    <Button
                      key={q}
                      type="button"
                      size="sm"
                      variant={activeQualityKey === q ? "default" : "outline"}
                      onClick={() => setActiveQuality(q)}
                      data-testid={`button-matrix-quality-${q}`}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{option2Name} \ {option1Name}</TableHead>
                      {columnValues.map(col => <TableHead key={col} className="text-center">{col}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowValues.map(row => (
                      <TableRow key={row}>
                        <TableCell className="font-medium">{row}</TableCell>
                        {columnValues.map(col => {
                          const variant = findVariant(col, row, activeQualityKey);
                          if (!variant) return <TableCell key={col} className="text-center text-muted-foreground text-xs">—</TableCell>;
                          return (
                            <TableCell key={col} className="text-center">
                              <Input
                                type="number"
                                min={0}
                                className="w-16 mx-auto text-center"
                                value={quantities[variant.id] || ""}
                                onChange={e => setQuantities(prev => ({ ...prev, [variant.id]: e.target.value }))}
                                data-testid={`input-matrix-qty-${variant.id}`}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={addMatrixToInvoice} data-testid="button-add-matrix-to-invoice">
                  <Plus className="w-4 h-4 mr-1" /> Add to Invoice
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3">
          <CardTitle className="text-sm">Line Items</CardTitle>
        </CardHeader>
        <CardContent className="p-2 sm:p-3 pt-0">
          {lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Use the matrix above to add purchase lines</p>
          ) : (
            <div className="space-y-3">
              {lineItems.map((li, idx) => (
                <div key={idx} className="border rounded-md p-2 sm:p-3 space-y-2" data-testid={`row-apparel-line-${idx}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{li.description}</p>
                    <Button size="icon" variant="ghost" className="shrink-0" onClick={() => removeLine(idx)} data-testid={`button-remove-apparel-line-${idx}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Qty</label>
                      <Input type="number" min="1" value={li.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 0)} data-testid={`input-apparel-qty-${idx}`} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Cost</label>
                      <Input type="text" inputMode="decimal" value={li.unitCost} onChange={e => updateLine(idx, "unitCost", e.target.value)} data-testid={`input-apparel-cost-${idx}`} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Sale (P1)</label>
                      <Input type="text" inputMode="decimal" value={li.salePrice} onChange={e => updateLine(idx, "salePrice", e.target.value)} data-testid={`input-apparel-sale-price-${idx}`} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Disc %</label>
                      <Input type="text" inputMode="decimal" value={li.discountPercent} onChange={e => updateLine(idx, "discountPercent", e.target.value)} data-testid={`input-apparel-disc-pct-${idx}`} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">VAT %</label>
                      <Input type="text" inputMode="decimal" value={li.vatRate} onChange={e => updateLine(idx, "vatRate", e.target.value)} data-testid={`input-apparel-vat-${idx}`} />
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium">{"\u20AC"}{li.total}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <label className="text-sm font-medium">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="resize-none" data-testid="input-apparel-purchase-notes" />
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-1 items-end text-sm">
            <div className="flex gap-4 sm:gap-8"><span className="text-muted-foreground">Subtotal:</span><span>{"\u20AC"}{subtotal.toFixed(2)}</span></div>
            <div className="flex gap-4 sm:gap-8"><span className="text-muted-foreground">VAT:</span><span>{"\u20AC"}{vatAmount.toFixed(2)}</span></div>
            <div className="flex gap-4 sm:gap-8 font-bold text-base"><span>Total:</span><span>{"\u20AC"}{total.toFixed(2)}</span></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button className="w-full sm:w-auto" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-apparel-purchase">
          {saveMutation.isPending ? "Saving..." : editingId ? "Update Invoice" : "Save & Update Stock"}
        </Button>
      </div>
    </div>
  );
}
