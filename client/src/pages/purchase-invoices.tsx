import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, ShoppingCart, Trash2, PackagePlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Supplier, Item, PurchaseInvoice } from "@shared/schema";
import { z } from "zod";

interface PurchaseInvoiceWithSupplier extends PurchaseInvoice {
  supplierName: string;
}

interface LineItem {
  itemId: string;
  description: string;
  quantity: number;
  purchaseUnit: string;
  unitCost: string;
  vatRate: string;
  total: string;
}

export default function PurchaseInvoices() {
  const [formOpen, setFormOpen] = useState(false);
  const { toast } = useToast();

  const { data: invoices = [], isLoading } = useQuery<PurchaseInvoiceWithSupplier[]>({ queryKey: ["/api/purchase-invoices"] });

  const columns: Column<PurchaseInvoiceWithSupplier>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <ShoppingCart className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.invoiceNumber}</p>
            {row.supplierInvoiceRef && <p className="text-xs text-muted-foreground">Ref: {row.supplierInvoiceRef}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => <span className="text-sm">{row.supplierName}</span>,
    },
    {
      key: "date",
      header: "Date",
      cell: (row) => <span className="text-sm">{new Date(row.date).toLocaleDateString()}</span>,
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
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Purchase Invoices"
        description="Record purchases from suppliers to update stock"
        action={
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-purchase"><Plus className="w-4 h-4 mr-1" /> New Purchase</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Purchase Invoice</DialogTitle></DialogHeader>
              <PurchaseInvoiceForm onSuccess={() => { setFormOpen(false); toast({ title: "Purchase invoice created, stock updated" }); }} />
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-4">
          <DataTable columns={columns} data={invoices} isLoading={isLoading} emptyMessage="No purchase invoices found" />
        </CardContent>
      </Card>
    </div>
  );
}

function PurchaseInvoiceForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: allItems = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const addLine = () => {
    setLineItems([...lineItems, { itemId: "", description: "", quantity: 1, purchaseUnit: "pc", unitCost: "0", vatRate: "19", total: "0" }]);
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

    if (["quantity", "unitCost"].includes(field)) {
      const qty = parseFloat(String(updated[index].quantity)) || 0;
      const cost = parseFloat(updated[index].unitCost) || 0;
      updated[index].total = (qty * cost).toFixed(2);
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

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Select a supplier");
      if (lineItems.length === 0) throw new Error("Add at least one item");
      for (const li of lineItems) {
        if (!li.itemId) throw new Error("Select an item for each line");
      }

      const res = await apiRequest("POST", "/api/purchase-invoices", {
        supplierId,
        supplierInvoiceRef: supplierInvoiceRef || null,
        date,
        dueDate: dueDate || null,
        subtotal: subtotal.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        total: total.toFixed(2),
        status: "confirmed",
        notes: notes || null,
        invoiceNumber: "TEMP",
        items: lineItems.map(li => ({
          itemId: li.itemId,
          description: li.description,
          quantity: li.quantity,
          purchaseUnit: li.purchaseUnit,
          unitCost: li.unitCost,
          vatRate: li.vatRate,
          total: li.total,
          purchaseInvoiceId: "TEMP",
        })),
      });
      return res.json();
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Supplier</label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger data-testid="select-purchase-supplier">
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Supplier Invoice Ref</label>
          <Input value={supplierInvoiceRef} onChange={e => setSupplierInvoiceRef(e.target.value)} placeholder="Supplier's ref number" data-testid="input-supplier-ref" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Date</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="input-purchase-date" />
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
        <CardContent className="p-3 pt-0">
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
                  <div key={idx} className="border rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
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
                      <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} data-testid={`button-remove-line-${idx}`}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {stockInfo && <p className="text-xs text-muted-foreground">{stockInfo}</p>}
                    <div className="grid grid-cols-4 gap-2">
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
                            <SelectItem value="pc">Per Bottle</SelectItem>
                            <SelectItem value="pack">Per Pack{selectedItem ? ` (${selectedItem.packSize})` : ""}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Unit Cost</label>
                        <Input type="number" step="0.01" value={li.unitCost} onChange={e => updateLine(idx, "unitCost", e.target.value)} data-testid={`input-purchase-cost-${idx}`} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">VAT %</label>
                        <Input type="number" step="0.01" value={li.vatRate} onChange={e => updateLine(idx, "vatRate", e.target.value)} data-testid={`input-purchase-vat-${idx}`} />
                      </div>
                    </div>
                    {selectedItem && li.purchaseUnit === "pack" && li.quantity > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Will add {li.quantity * selectedItem.packSize} bottles to stock ({li.quantity} packs x {selectedItem.packSize} per pack)
                      </p>
                    )}
                    {selectedItem && li.purchaseUnit === "pc" && li.quantity > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Will add {li.quantity} bottle{li.quantity > 1 ? "s" : ""} to stock
                      </p>
                    )}
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
        <CardContent className="p-4">
          <div className="flex flex-col gap-1 items-end text-sm">
            <div className="flex gap-8"><span className="text-muted-foreground">Subtotal:</span><span>{"\u20AC"}{subtotal.toFixed(2)}</span></div>
            <div className="flex gap-8"><span className="text-muted-foreground">VAT:</span><span>{"\u20AC"}{vatAmount.toFixed(2)}</span></div>
            <div className="flex gap-8 font-bold text-base"><span>Total:</span><span>{"\u20AC"}{total.toFixed(2)}</span></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="button-save-purchase">
          {createMutation.isPending ? "Saving..." : "Save & Update Stock"}
        </Button>
      </div>
    </div>
  );
}
