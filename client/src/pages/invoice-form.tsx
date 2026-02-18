import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, ScanBarcode, Download } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScanner } from "@/components/barcode-scanner";
import type { Customer, Item, Invoice, InvoiceItem } from "@shared/schema";

interface LineItem {
  itemId: string;
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  total: string;
}

export default function InvoiceForm() {
  const [, navigate] = useLocation();
  const [matchEdit, paramsEdit] = useRoute("/invoices/:id/edit");
  const [matchView, paramsView] = useRoute("/invoices/:id");
  const [matchNew] = useRoute("/invoices/new");
  const isNew = matchNew || (!matchEdit && !matchView);
  const invoiceId = matchNew ? undefined : (paramsEdit?.id || paramsView?.id);
  const isViewMode = matchView && !matchEdit && !matchNew;
  const { toast } = useToast();

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const docType = searchParams.get("type") || "invoice";

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: existingInvoice } = useQuery<Invoice & { items: InvoiceItem[] }>({
    queryKey: ["/api/invoices", invoiceId],
    enabled: !!invoiceId,
  });

  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [taxRate, setTaxRate] = useState("19");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");
  const [lines, setLines] = useState<LineItem[]>([{ itemId: "", description: "", quantity: 1, unitPrice: "0", discount: "0", total: "0" }]);

  useEffect(() => {
    if (existingInvoice) {
      setCustomerId(existingInvoice.customerId);
      setInvoiceDate(existingInvoice.date);
      setDueDate(existingInvoice.dueDate || "");
      setTaxRate(existingInvoice.taxRate);
      setNotes(existingInvoice.notes || "");
      setStatus(existingInvoice.status);
      if (existingInvoice.items?.length) {
        setLines(existingInvoice.items.map((li) => ({
          itemId: li.itemId || "",
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          discount: li.discount,
          total: li.total,
        })));
      }
    }
  }, [existingInvoice]);

  useEffect(() => {
    if (customerId) {
      const customer = customers.find((c) => c.id === customerId);
      if (customer && customer.paymentTerms !== "cash") {
        const days = parseInt(customer.paymentTerms.replace("credit_", "")) || 30;
        const due = new Date(invoiceDate);
        due.setDate(due.getDate() + days);
        setDueDate(due.toISOString().split("T")[0]);
      }
    }
  }, [customerId, invoiceDate, customers]);

  const calcLineTotal = useCallback((line: LineItem) => {
    const qty = line.quantity || 0;
    const price = parseFloat(line.unitPrice) || 0;
    const disc = parseFloat(line.discount) || 0;
    return ((qty * price) - disc).toFixed(2);
  }, []);

  const updateLine = (index: number, field: keyof LineItem, value: any) => {
    setLines((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === "itemId" && value) {
        const item = items.find((i) => i.id === value);
        if (item) {
          const customer = customers.find((c) => c.id === customerId);
          const level = customer?.priceLevel || 1;
          const priceKey = `price${level}` as keyof Item;
          updated[index].description = item.name;
          updated[index].unitPrice = String(item[priceKey] || item.price1);
        }
      }
      updated[index].total = calcLineTotal(updated[index]);
      return updated;
    });
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
      const customer = customers.find((c) => c.id === customerId);
      const level = customer?.priceLevel || 1;
      const priceKey = `price${level}` as keyof typeof item;
      const newLine: LineItem = {
        itemId: item.id,
        description: item.name,
        quantity: 1,
        unitPrice: String(item[priceKey] || item.price1),
        discount: "0",
        total: String(item[priceKey] || item.price1),
      };
      setLines((prev) => [...prev.filter(l => l.description), newLine]);
    } catch {
      toast({ title: "Error", description: "Failed to look up barcode", variant: "destructive" });
    }
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: "", description: "", quantity: 1, unitPrice: "0", discount: "0", total: "0" }]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const subtotal = lines.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0);
  const taxAmount = subtotal * (parseFloat(taxRate) / 100);
  const total = subtotal + taxAmount;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        type: existingInvoice?.type || docType,
        customerId,
        date: invoiceDate,
        dueDate: dueDate || null,
        subtotal: subtotal.toFixed(2),
        taxRate,
        taxAmount: taxAmount.toFixed(2),
        discountAmount: "0",
        total: total.toFixed(2),
        status,
        notes: notes || null,
        items: lines.filter((l) => l.description).map((l) => ({
          itemId: l.itemId || null,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          total: l.total,
        })),
      };
      if (invoiceId && matchEdit) {
        const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}`, payload);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/invoices", payload);
        return res.json();
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Invoice saved successfully" });
      navigate(`/invoices/${data.id}`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const downloadPdf = async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`);
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${existingInvoice?.invoiceNumber || "invoice"}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const typeLabel = docType === "credit_note" ? "Credit Note" : docType === "proforma" ? "Proforma" : "Invoice";

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={isNew ? `New ${typeLabel}` : `${typeLabel} ${existingInvoice?.invoiceNumber || ""}`}
        description={isViewMode ? "View document details" : "Fill in the document details"}
        action={
          <div className="flex items-center gap-2">
            {isViewMode && (
              <>
                <Button variant="outline" onClick={downloadPdf} data-testid="button-download-pdf">
                  <Download className="w-4 h-4 mr-1" /> PDF
                </Button>
                <Button onClick={() => navigate(`/invoices/${invoiceId}/edit`)} data-testid="button-edit-invoice">Edit</Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Document Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId} disabled={isViewMode}>
                    <SelectTrigger data-testid="select-invoice-customer">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus} disabled={isViewMode}>
                    <SelectTrigger data-testid="select-invoice-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Sent</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} disabled={isViewMode} data-testid="input-invoice-date" />
                </div>
                <div>
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isViewMode} data-testid="input-due-date" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">Line Items</CardTitle>
              {!isViewMode && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setScannerOpen(true)} data-testid="button-scan-barcode">
                    <ScanBarcode className="w-4 h-4 mr-1" /> Scan
                  </Button>
                  <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-line">
                    <Plus className="w-4 h-4 mr-1" /> Add Line
                  </Button>
                </div>
              )}
            </CardHeader>
            <BarcodeScanner open={scannerOpen} onOpenChange={setScannerOpen} onScan={handleBarcodeScan} />
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Item</TableHead>
                      <TableHead className="w-[80px]">Qty</TableHead>
                      <TableHead className="w-[100px]">Price</TableHead>
                      <TableHead className="w-[100px]">Disc.</TableHead>
                      <TableHead className="w-[100px] text-right">Total</TableHead>
                      {!isViewMode && <TableHead className="w-[50px]" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {isViewMode ? (
                            <span className="text-sm">{line.description}</span>
                          ) : (
                            <div className="space-y-1">
                              <Select value={line.itemId || "custom"} onValueChange={(v) => updateLine(idx, "itemId", v === "custom" ? "" : v)}>
                                <SelectTrigger data-testid={`select-line-item-${idx}`}>
                                  <SelectValue placeholder="Select item" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="custom">Custom entry</SelectItem>
                                  {items.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.name} ({item.sku})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {!line.itemId && (
                                <Input
                                  placeholder="Description"
                                  value={line.description}
                                  onChange={(e) => updateLine(idx, "description", e.target.value)}
                                  data-testid={`input-line-desc-${idx}`}
                                />
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, "quantity", parseInt(e.target.value) || 1)}
                            disabled={isViewMode}
                            data-testid={`input-line-qty-${idx}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                            disabled={isViewMode}
                            data-testid={`input-line-price-${idx}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={line.discount}
                            onChange={(e) => updateLine(idx, "discount", e.target.value)}
                            disabled={isViewMode}
                            data-testid={`input-line-discount-${idx}`}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          €{parseFloat(line.total).toFixed(2)}
                        </TableCell>
                        {!isViewMode && (
                          <TableCell>
                            {lines.length > 1 && (
                              <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} data-testid={`button-remove-line-${idx}`}>
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">€{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Tax (%)</span>
                <Input
                  type="number"
                  step="0.01"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="w-20 text-right"
                  disabled={isViewMode}
                  data-testid="input-tax-rate"
                />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax Amount</span>
                <span>€{taxAmount.toFixed(2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span data-testid="text-invoice-total">€{total.toFixed(2)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes..."
                className="resize-none"
                disabled={isViewMode}
                data-testid="input-invoice-notes"
              />
            </CardContent>
          </Card>

          {!isViewMode && (
            <div className="flex flex-col gap-2">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !customerId} data-testid="button-save-invoice">
                {saveMutation.isPending ? "Saving..." : "Save Document"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/invoices")} data-testid="button-cancel">Cancel</Button>
            </div>
          )}

          {isViewMode && customerId && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(() => {
                  const customer = customers.find((c) => c.id === customerId);
                  if (!customer) return null;
                  return (
                    <>
                      <p className="text-sm font-medium">{customer.name}</p>
                      <p className="text-xs text-muted-foreground">{customer.code}</p>
                      {customer.address && <p className="text-xs text-muted-foreground">{customer.address}</p>}
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="secondary">{customer.paymentTerms}</Badge>
                        <Badge variant="outline">Level {customer.priceLevel}</Badge>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
