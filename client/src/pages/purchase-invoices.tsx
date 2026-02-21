import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ShoppingCart, Trash2, PackagePlus, Pencil, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Supplier, Item, PurchaseInvoice, PurchaseInvoiceItem } from "@shared/schema";

interface PurchaseInvoiceWithSupplier extends PurchaseInvoice {
  supplierName: string;
}

interface PurchaseInvoiceDetail extends PurchaseInvoice {
  items: PurchaseInvoiceItem[];
  supplierName: string;
}

interface LineItem {
  itemId: string;
  description: string;
  quantity: number;
  purchaseUnit: string;
  unitCost: string;
  discountPercent: string;
  discount: string;
  vatRate: string;
  total: string;
}

export default function PurchaseInvoices() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: invoices = [], isLoading } = useQuery<PurchaseInvoiceWithSupplier[]>({ queryKey: ["/api/purchase-invoices"] });

  const handleEdit = (row: PurchaseInvoiceWithSupplier) => {
    setEditingId(row.id);
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
    setEditingId(null);
  };

  const columns: Column<PurchaseInvoiceWithSupplier>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (row) => (
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <ShoppingCart className="w-4 h-4 text-primary" />
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
      cell: (row) => <span className="text-sm">{new Date(row.date).toLocaleDateString()}</span>,
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
        <Button size="sm" variant="ghost" onClick={() => handleEdit(row)} data-testid={`button-edit-purchase-${row.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHeader
        title="Purchase Invoices"
        description="Record purchases from suppliers to update stock"
        action={
          <Button onClick={() => { setEditingId(null); setFormOpen(true); }} data-testid="button-new-purchase">
            <Plus className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">New Purchase</span><span className="sm:hidden">New</span>
          </Button>
        }
      />

      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) handleClose(); else setFormOpen(true); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Purchase Invoice" : "New Purchase Invoice"}</DialogTitle>
          </DialogHeader>
          <PurchaseInvoiceForm
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
          <DataTable columns={columns} data={invoices} isLoading={isLoading} emptyMessage="No purchase invoices found" />
        </CardContent>
      </Card>
    </div>
  );
}

function PurchaseInvoiceForm({ editingId, onSuccess }: { editingId: string | null; onSuccess: () => void }) {
  const { toast } = useToast();
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: allItems = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: lastCosts = {} } = useQuery<Record<string, { unitCost: string; date: string }>>({ queryKey: ["/api/purchase-invoices/last-costs"] });
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

  const calcDueDate = (invoiceDate: string, terms: string) => {
    const d = new Date(invoiceDate);
    const match = terms.match(/credit_(\d+)/);
    if (match) {
      d.setDate(d.getDate() + parseInt(match[1]));
    }
    return d.toISOString().split("T")[0];
  };

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    const supplier = suppliers.find(s => s.id === id);
    if (supplier && supplier.paymentTerms !== "cash") {
      setDueDate(calcDueDate(date, supplier.paymentTerms));
    }
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    const supplier = suppliers.find(s => s.id === supplierId);
    if (supplier && supplier.paymentTerms !== "cash" && dueDate) {
      setDueDate(calcDueDate(newDate, supplier.paymentTerms));
    }
  };

  useEffect(() => {
    if (editingId && existingInvoice && !loaded) {
      setSupplierId(existingInvoice.supplierId);
      setSupplierInvoiceRef(existingInvoice.supplierInvoiceRef || "");
      setDate(existingInvoice.date);
      setDueDate(existingInvoice.dueDate || "");
      setNotes(existingInvoice.notes || "");
      setLineItems(existingInvoice.items.map(li => ({
        itemId: li.itemId,
        description: li.description,
        quantity: li.quantity,
        purchaseUnit: li.purchaseUnit,
        unitCost: li.unitCost,
        discountPercent: li.discountPercent || "0",
        discount: li.discount || "0",
        vatRate: li.vatRate,
        total: li.total,
      })));
      setLoaded(true);
    }
  }, [editingId, existingInvoice, loaded]);

  const addLine = () => {
    setLineItems([...lineItems, { itemId: "", description: "", quantity: 1, purchaseUnit: "pc", unitCost: "0", discountPercent: "0", discount: "0", vatRate: "19", total: "0" }]);
  };

  const updateLine = (index: number, field: keyof LineItem, value: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };

    if (field === "itemId") {
      const item = allItems.find(i => i.id === value);
      if (item) {
        updated[index].description = item.name;
        updated[index].unitCost = item.costPrice;
        updated[index].vatRate = String(item.vatRate || "19");
        updated[index].purchaseUnit = item.packSize > 1 ? "pack" : "pc";
      }
    }

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
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (editingId && !existingInvoice) {
    return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="text-sm font-medium">Supplier</label>
          <Select value={supplierId} onValueChange={handleSupplierChange}>
            <SelectTrigger data-testid="select-purchase-supplier">
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
          <Input value={supplierInvoiceRef} onChange={e => setSupplierInvoiceRef(e.target.value)} placeholder="Supplier's ref number" data-testid="input-supplier-ref" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div>
          <label className="text-sm font-medium">Date</label>
          <Input type="date" value={date} onChange={e => handleDateChange(e.target.value)} data-testid="input-purchase-date" />
        </div>
        <div>
          <label className="text-sm font-medium">Due Date</label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-purchase-due-date" />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 p-3">
          <CardTitle className="text-sm">Line Items</CardTitle>
          <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-purchase-line">
            <PackagePlus className="w-4 h-4 mr-1" /> Add Item
          </Button>
        </CardHeader>
        <CardContent className="p-2 sm:p-3 pt-0">
          {lineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Click "Add Item" to add purchase lines</p>
          ) : (
            <div className="space-y-3">
              {lineItems.map((li, idx) => {
                const selectedItem = allItems.find(i => i.id === li.itemId);
                const stockInfo = selectedItem
                  ? `Stock: ${selectedItem.stockQuantity} btl${selectedItem.packSize > 1 ? ` (${Math.floor(selectedItem.stockQuantity / selectedItem.packSize)} packs)` : ""}`
                  : "";

                return (
                  <div key={idx} className="border rounded-md p-2 sm:p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <Select value={li.itemId} onValueChange={(v) => updateLine(idx, "itemId", v)}>
                          <SelectTrigger data-testid={`select-purchase-item-${idx}`}>
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {allItems.filter(i => i.active).map(item => (
                              <SelectItem key={item.id} value={item.id}>{item.sku} - {item.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="icon" variant="ghost" className="shrink-0" onClick={() => removeLine(idx)} data-testid={`button-remove-line-${idx}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {stockInfo && <p className="text-xs text-muted-foreground">{stockInfo}</p>}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Qty</label>
                        <Input type="number" min="1" value={li.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 0)} data-testid={`input-purchase-qty-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Unit</label>
                        <Select value={li.purchaseUnit} onValueChange={(v) => updateLine(idx, "purchaseUnit", v)}>
                          <SelectTrigger data-testid={`select-purchase-unit-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pc">Bottle</SelectItem>
                            <SelectItem value="pack">Pack{selectedItem ? ` (${selectedItem.packSize})` : ""}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Cost</label>
                        <Input type="number" step="0.01" value={li.unitCost} onChange={e => updateLine(idx, "unitCost", e.target.value)} data-testid={`input-purchase-cost-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Disc %</label>
                        <Input type="number" step="0.01" value={li.discountPercent} onChange={e => updateLine(idx, "discountPercent", e.target.value)} data-testid={`input-purchase-disc-pct-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Disc Amt</label>
                        <Input type="number" step="0.01" value={li.discount} onChange={e => updateLine(idx, "discount", e.target.value)} data-testid={`input-purchase-disc-amt-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">VAT %</label>
                        <Input type="number" step="0.01" value={li.vatRate} onChange={e => updateLine(idx, "vatRate", e.target.value)} data-testid={`input-purchase-vat-${idx}`} />
                      </div>
                    </div>
                    {selectedItem && li.quantity > 0 && (() => {
                      const btls = li.purchaseUnit === "pack" ? li.quantity * selectedItem.packSize : li.quantity;
                      const packInfo = li.purchaseUnit === "pack" ? ` (${li.quantity} x ${selectedItem.packSize})` : "";
                      const lastCost = lastCosts[li.itemId];
                      const currentCost = parseFloat(li.unitCost) || 0;
                      const prevCost = lastCost ? parseFloat(lastCost.unitCost) : null;
                      const variation = prevCost !== null && prevCost > 0 ? ((currentCost - prevCost) / prevCost) * 100 : null;

                      return (
                        <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                          <span className="text-muted-foreground">
                            +{btls} btl{btls > 1 ? "s" : ""}{packInfo}
                          </span>
                          {lastCost && prevCost !== null && (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">Last: {"\u20AC"}{prevCost.toFixed(2)}</span>
                              {variation !== null && variation !== 0 ? (
                                <span className={`flex items-center gap-0.5 font-medium ${variation > 0 ? "text-red-500" : "text-green-500"}`}>
                                  {variation > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                  {variation > 0 ? "+" : ""}{variation.toFixed(1)}%
                                </span>
                              ) : variation === 0 ? (
                                <span className="flex items-center gap-0.5 text-muted-foreground">
                                  <Minus className="w-3 h-3" /> 0%
                                </span>
                              ) : null}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <div className="text-right text-sm font-medium">{"\u20AC"}{li.total}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <label className="text-sm font-medium">Notes</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="resize-none" data-testid="input-purchase-notes" />
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
        <Button className="w-full sm:w-auto" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-purchase">
          {saveMutation.isPending ? "Saving..." : editingId ? "Update Invoice" : "Save & Update Stock"}
        </Button>
      </div>
    </div>
  );
}
