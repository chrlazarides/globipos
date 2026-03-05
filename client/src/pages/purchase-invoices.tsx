import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ShoppingCart, Trash2, PackagePlus, Pencil, TrendingUp, TrendingDown, Minus, ScanBarcode } from "lucide-react";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Supplier, Item, PurchaseInvoice, PurchaseInvoiceItem, Category } from "@shared/schema";

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
  salePrice: string;
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
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
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
      if (supplier.paymentTerms === "cash") {
        setDueDate(date);
      } else {
        setDueDate(calcDueDate(date, supplier.paymentTerms));
      }
    }
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    const supplier = suppliers.find(s => s.id === supplierId);
    if (supplier) {
      if (supplier.paymentTerms === "cash") {
        setDueDate(newDate);
      } else {
        setDueDate(calcDueDate(newDate, supplier.paymentTerms));
      }
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
  }, [editingId, existingInvoice, loaded]);

  const addLine = () => {
    setLineItems([...lineItems, { itemId: "", description: "", quantity: 1, purchaseUnit: "pc", unitCost: "0", discountPercent: "0", discount: "0", vatRate: "19", total: "0", salePrice: "0" }]);
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
        updated[index].salePrice = item.price1;
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

  const [scannerOpen, setScannerOpen] = useState(false);

  const handleBarcodeScan = async (barcode: string) => {
    try {
      const res = await fetch(`/api/items/barcode/${barcode}`);
      if (!res.ok) {
        toast({ title: "Item not found", description: `No item with barcode ${barcode}`, variant: "destructive" });
        return;
      }
      const item = await res.json();

      setLineItems(prev => {
        const existingIndex = prev.findIndex(l => l.itemId === item.id);
        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          const newQty = existing.quantity + 1;
          const cost = parseFloat(existing.unitCost) || 0;
          const gross = newQty * cost;
          const pct = parseFloat(existing.discountPercent) || 0;
          const discAmt = gross * pct / 100;
          const updated = [...prev];
          updated[existingIndex] = { ...existing, quantity: newQty, discount: discAmt.toFixed(2), total: (gross - discAmt).toFixed(2) };
          return updated;
        }
        const unitCost = item.costPrice || "0";
        const salePrice = item.price1 || "0";
        const purchaseUnit = item.packSize > 1 ? "pack" : "pc";
        const vatRate = String(item.vatRate || "19");
        const cost = parseFloat(unitCost) || 0;
        return [...prev, {
          itemId: item.id,
          description: item.name,
          quantity: 1,
          purchaseUnit,
          unitCost,
          discountPercent: "0",
          discount: "0",
          vatRate,
          total: cost.toFixed(2),
          salePrice,
        }];
      });

      toast({ title: "Item added", description: item.name });
    } catch {
      toast({ title: "Error", description: "Failed to look up barcode", variant: "destructive" });
    }
  };

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddLineIdx, setQuickAddLineIdx] = useState<number | null>(null);
  const [newItem, setNewItem] = useState({
    name: "", sku: "", barcode: "", categoryId: "", unitType: "bottle" as string,
    packSize: "1", costPrice: "0", price1: "0", vatRate: "19", brand: "",
  });

  const resetNewItem = () => setNewItem({
    name: "", sku: "", barcode: "", categoryId: "", unitType: "bottle",
    packSize: "1", costPrice: "0", price1: "0", vatRate: "19", brand: "",
  });

  const quickAddMutation = useMutation({
    mutationFn: async () => {
      if (!newItem.name.trim()) throw new Error("Item name is required");
      if (!newItem.sku.trim()) throw new Error("SKU is required");
      const payload = {
        name: newItem.name.trim(),
        sku: newItem.sku.trim(),
        barcode: newItem.barcode.trim() || null,
        categoryId: newItem.categoryId || null,
        unitType: newItem.unitType,
        packSize: parseInt(newItem.packSize) || 1,
        costPrice: newItem.costPrice || "0",
        price1: newItem.price1 || "0",
        price2: "0", price3: "0", price4: "0", price5: "0",
        vatRate: newItem.vatRate || "19",
        stockQuantity: 0,
        reorderLevel: 10,
        brand: newItem.brand.trim() || null,
      };
      const res = await apiRequest("POST", "/api/items", payload);
      return res.json();
    },
    onSuccess: (createdItem: Item) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Item created", description: createdItem.name });
      if (quickAddLineIdx !== null) {
        setLineItems(prev => {
          const updated = [...prev];
          updated[quickAddLineIdx] = {
            ...updated[quickAddLineIdx],
            itemId: createdItem.id,
            description: createdItem.name,
            unitCost: createdItem.costPrice,
            salePrice: createdItem.price1,
            purchaseUnit: createdItem.packSize > 1 ? "pack" : "pc",
            vatRate: String(createdItem.vatRate || "19"),
          };
          const qty = parseFloat(String(updated[quickAddLineIdx].quantity)) || 0;
          const cost = parseFloat(createdItem.costPrice) || 0;
          updated[quickAddLineIdx].total = (qty * cost).toFixed(2);
          return updated;
        });
      }
      setQuickAddOpen(false);
      setQuickAddLineIdx(null);
      resetNewItem();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setScannerOpen(true)} data-testid="button-scan-purchase-barcode">
              <ScanBarcode className="w-4 h-4 mr-1" /> Scan
            </Button>
            <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-purchase-line">
              <PackagePlus className="w-4 h-4 mr-1" /> Add Item
            </Button>
          </div>
        </CardHeader>
        <BarcodeScanner open={scannerOpen} onOpenChange={setScannerOpen} onScan={handleBarcodeScan} />
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
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => { setQuickAddLineIdx(idx); resetNewItem(); setQuickAddOpen(true); }} data-testid={`button-new-item-${idx}`}>
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="shrink-0" onClick={() => removeLine(idx)} data-testid={`button-remove-line-${idx}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {stockInfo && <p className="text-xs text-muted-foreground">{stockInfo}</p>}
                    <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
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
                        <Input type="text" inputMode="decimal" value={li.unitCost} onChange={e => updateLine(idx, "unitCost", e.target.value)} data-testid={`input-purchase-cost-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Sale (P1)</label>
                        <Input type="text" inputMode="decimal" value={li.salePrice} onChange={e => updateLine(idx, "salePrice", e.target.value)} data-testid={`input-purchase-sale-price-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Disc %</label>
                        <Input type="text" inputMode="decimal" value={li.discountPercent} onChange={e => updateLine(idx, "discountPercent", e.target.value)} data-testid={`input-purchase-disc-pct-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Disc Amt</label>
                        <Input type="text" inputMode="decimal" value={li.discount} onChange={e => updateLine(idx, "discount", e.target.value)} data-testid={`input-purchase-disc-amt-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">VAT %</label>
                        <Input type="text" inputMode="decimal" value={li.vatRate} onChange={e => updateLine(idx, "vatRate", e.target.value)} data-testid={`input-purchase-vat-${idx}`} />
                      </div>
                    </div>
                    {selectedItem && li.quantity > 0 && (() => {
                      const btls = li.purchaseUnit === "pack" ? li.quantity * selectedItem.packSize : li.quantity;
                      const packInfo = li.purchaseUnit === "pack" ? ` (${li.quantity} x ${selectedItem.packSize})` : "";
                      const lastCost = lastCosts[li.itemId];
                      const currentCost = parseFloat(li.unitCost) || 0;
                      const prevCost = lastCost ? parseFloat(lastCost.unitCost) : null;
                      const variation = prevCost !== null && prevCost > 0 ? ((currentCost - prevCost) / prevCost) * 100 : null;
                      const sale = parseFloat(li.salePrice) || 0;
                      const qty = parseFloat(String(li.quantity)) || 1;
                      const lineTotal = parseFloat(li.total) || 0;
                      const netCostPerUnit = qty > 0 ? lineTotal / qty : currentCost;
                      const markupAmt = sale - netCostPerUnit;
                      const markupPct = netCostPerUnit > 0 ? (markupAmt / netCostPerUnit) * 100 : 0;
                      const marginPct = sale > 0 ? (markupAmt / sale) * 100 : 0;
                      const isNegativeMargin = markupAmt < 0;

                      return (
                        <div className="space-y-0.5">
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
                          {netCostPerUnit > 0 && sale > 0 && (
                            <div className={`flex flex-wrap items-center gap-2 text-xs ${isNegativeMargin ? "text-red-500 font-medium" : "text-muted-foreground"}`} data-testid={`text-margin-${idx}`}>
                              {netCostPerUnit !== currentCost && (
                                <span className="text-muted-foreground">Net: {"\u20AC"}{netCostPerUnit.toFixed(2)}</span>
                              )}
                              <span>Markup: {isNegativeMargin ? "" : "+"}{"\u20AC"}{markupAmt.toFixed(2)} ({markupPct >= 0 ? "+" : ""}{markupPct.toFixed(1)}%)</span>
                              <span className="hidden sm:inline">•</span>
                              <span className={isNegativeMargin ? "text-red-500 font-medium" : "text-green-600 dark:text-green-400 font-medium"}>
                                Margin: {marginPct.toFixed(1)}%
                              </span>
                            </div>
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

      <Dialog open={quickAddOpen} onOpenChange={(open) => { if (!open) { setQuickAddOpen(false); setQuickAddLineIdx(null); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-quick-add-item">
          <DialogHeader>
            <DialogTitle>Quick Add New Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Item Name *</Label>
                <Input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Château Margaux 2020" data-testid="input-quick-item-name" />
              </div>
              <div>
                <Label>SKU *</Label>
                <Input value={newItem.sku} onChange={e => setNewItem(p => ({ ...p, sku: e.target.value }))} placeholder="e.g. RW-010" data-testid="input-quick-item-sku" />
              </div>
              <div>
                <Label>Barcode</Label>
                <Input value={newItem.barcode} onChange={e => setNewItem(p => ({ ...p, barcode: e.target.value }))} placeholder="Optional" data-testid="input-quick-item-barcode" />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={newItem.categoryId} onValueChange={v => setNewItem(p => ({ ...p, categoryId: v }))}>
                  <SelectTrigger data-testid="select-quick-item-category">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.filter(c => c.active).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Brand</Label>
                <Input value={newItem.brand} onChange={e => setNewItem(p => ({ ...p, brand: e.target.value }))} placeholder="e.g. Opus One" data-testid="input-quick-item-brand" />
              </div>
              <div>
                <Label>Unit Type</Label>
                <Select value={newItem.unitType} onValueChange={v => setNewItem(p => ({ ...p, unitType: v }))}>
                  <SelectTrigger data-testid="select-quick-item-unit-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bottle">Bottle</SelectItem>
                    <SelectItem value="pack">Pack</SelectItem>
                    <SelectItem value="pc">Piece</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Pack Size</Label>
                <Input type="number" min="1" value={newItem.packSize} onChange={e => setNewItem(p => ({ ...p, packSize: e.target.value }))} data-testid="input-quick-item-pack-size" />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Cost Price</Label>
                <Input type="text" inputMode="decimal" value={newItem.costPrice} onChange={e => setNewItem(p => ({ ...p, costPrice: e.target.value }))} data-testid="input-quick-item-cost" />
              </div>
              <div>
                <Label>Sale Price</Label>
                <Input type="text" inputMode="decimal" value={newItem.price1} onChange={e => setNewItem(p => ({ ...p, price1: e.target.value }))} data-testid="input-quick-item-price" />
              </div>
              <div>
                <Label>VAT %</Label>
                <Input type="text" inputMode="decimal" value={newItem.vatRate} onChange={e => setNewItem(p => ({ ...p, vatRate: e.target.value }))} data-testid="input-quick-item-vat" />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => quickAddMutation.mutate()} disabled={quickAddMutation.isPending} data-testid="button-quick-add-save">
                {quickAddMutation.isPending ? "Creating..." : "Create & Add to Line"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
