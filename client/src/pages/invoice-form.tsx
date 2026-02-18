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
import { Plus, Trash2, ScanBarcode, Download, Info, FileOutput } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePriceLevels } from "@/hooks/use-price-levels";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScanner } from "@/components/barcode-scanner";
import type { Customer, Item, Invoice, InvoiceItem, PriceContract } from "@shared/schema";

interface LineItem {
  itemId: string;
  description: string;
  quantity: number;
  saleUnit: string;
  unitPrice: string;
  discountPercent: string;
  discount: string;
  total: string;
}

function saleUnitLabel(unit: string): string {
  switch (unit) {
    case "bottle": return "Bottle";
    case "6-pack": return "6-Pack";
    case "12-pack": return "12-Pack";
    case "pack": return "Pack";
    default: return "Piece";
  }
}

function itemToSaleUnit(item: Item): string {
  if (item.unitType === "bottle") return "bottle";
  if (item.unitType === "pack" && item.packSize === 6) return "6-pack";
  if (item.unitType === "pack" && item.packSize === 12) return "12-pack";
  if (item.unitType === "6-pack") return "6-pack";
  if (item.unitType === "12-pack") return "12-pack";
  return item.unitType === "bottle" ? "bottle" : "pc";
}

function getPaymentDays(terms: string): number {
  if (terms === "cash") return 0;
  const match = terms.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
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
  const fromId = searchParams.get("from");

  const { data: sourceInvoice } = useQuery<Invoice & { items: InvoiceItem[] }>({
    queryKey: ["/api/invoices", fromId],
    enabled: !!fromId && isNew,
  });

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: items = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: contracts = [] } = useQuery<PriceContract[]>({ queryKey: ["/api/price-contracts"] });
  const priceLevelNames = usePriceLevels();
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
  const [lines, setLines] = useState<LineItem[]>([{ itemId: "", description: "", quantity: 1, saleUnit: "pc", unitPrice: "0", discountPercent: "0", discount: "0", total: "0" }]);

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
          saleUnit: (li as any).saleUnit || "pc",
          unitPrice: li.unitPrice,
          discountPercent: (li as any).discountPercent || "0",
          discount: li.discount,
          total: li.total,
        })));
      }
    }
  }, [existingInvoice]);

  useEffect(() => {
    if (sourceInvoice && isNew) {
      setCustomerId(sourceInvoice.customerId);
      setTaxRate(sourceInvoice.taxRate);
      setNotes(sourceInvoice.notes ? `From ${sourceInvoice.type === "proforma" ? "Proforma" : "Quotation"} ${sourceInvoice.invoiceNumber}\n${sourceInvoice.notes}` : `From ${sourceInvoice.type === "proforma" ? "Proforma" : "Quotation"} ${sourceInvoice.invoiceNumber}`);
      if (sourceInvoice.items?.length) {
        setLines(sourceInvoice.items.map((li) => ({
          itemId: li.itemId || "",
          description: li.description,
          quantity: li.quantity,
          saleUnit: (li as any).saleUnit || "pc",
          unitPrice: li.unitPrice,
          discountPercent: (li as any).discountPercent || "0",
          discount: li.discount,
          total: li.total,
        })));
      }
    }
  }, [sourceInvoice, isNew]);

  const getActiveContracts = useCallback((custId: string) => {
    const today = new Date().toISOString().split("T")[0];
    return contracts.filter(c =>
      c.customerId === custId &&
      c.active &&
      c.startDate <= today &&
      c.endDate >= today
    );
  }, [contracts]);

  const findContractDiscount = useCallback((custId: string, item: Item) => {
    const activeContracts = getActiveContracts(custId);
    for (const contract of activeContracts) {
      if (contract.categoryId && contract.categoryId !== item.categoryId) continue;
      if (contract.brand && contract.brand !== item.brand) continue;
      return {
        type: contract.discountType,
        value: parseFloat(String(contract.discountValue)) || 0,
        name: contract.name,
      };
    }
    return null;
  }, [getActiveContracts]);

  useEffect(() => {
    if (customerId) {
      const customer = customers.find((c) => c.id === customerId);
      if (customer) {
        const days = getPaymentDays(customer.paymentTerms);
        if (days > 0) {
          const due = new Date(invoiceDate);
          due.setDate(due.getDate() + days);
          setDueDate(due.toISOString().split("T")[0]);
        } else if (isNew) {
          setDueDate(invoiceDate);
        }
      }
    }
  }, [customerId, invoiceDate, customers, isNew]);

  useEffect(() => {
    if (!customerId) return;
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return;
    setLines((prev) => {
      let changed = false;
      const updated = prev.map((line) => {
        if (!line.itemId) return line;
        const item = items.find((i) => i.id === line.itemId);
        if (!item) return line;
        changed = true;
        const newLine = { ...line };
        const priceKey = `price${customer.priceLevel}` as keyof Item;
        newLine.unitPrice = String(item[priceKey] || item.price1);
        const qty = newLine.quantity || 0;
        const price = parseFloat(newLine.unitPrice) || 0;
        const lineGross = qty * price;
        const contractDisc = findContractDiscount(customerId, item);
        if (contractDisc) {
          if (contractDisc.type === "percentage") {
            newLine.discountPercent = String(contractDisc.value);
            newLine.discount = (lineGross * contractDisc.value / 100).toFixed(2);
          } else {
            newLine.discount = String(contractDisc.value);
            newLine.discountPercent = lineGross > 0 ? (contractDisc.value / lineGross * 100).toFixed(2) : "0";
          }
        } else {
          newLine.discountPercent = "0";
          newLine.discount = "0";
        }
        const amtDisc = parseFloat(newLine.discount) || 0;
        newLine.total = Math.max(0, lineGross - amtDisc).toFixed(2);
        return newLine;
      });
      return changed ? updated : prev;
    });
  }, [customerId, contracts, items, customers, findContractDiscount]);

  const calcLineTotal = useCallback((line: LineItem) => {
    const qty = line.quantity || 0;
    const price = parseFloat(line.unitPrice) || 0;
    const lineGross = qty * price;
    const amtDisc = parseFloat(line.discount) || 0;
    return Math.max(0, lineGross - amtDisc).toFixed(2);
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
          updated[index].saleUnit = itemToSaleUnit(item);

          if (customerId) {
            const contractDisc = findContractDiscount(customerId, item);
            if (contractDisc) {
              if (contractDisc.type === "percentage") {
                updated[index].discountPercent = String(contractDisc.value);
                const gross = (updated[index].quantity || 0) * (parseFloat(updated[index].unitPrice) || 0);
                updated[index].discount = (gross * contractDisc.value / 100).toFixed(2);
              } else {
                updated[index].discount = String(contractDisc.value);
                const gross = (updated[index].quantity || 0) * (parseFloat(updated[index].unitPrice) || 0);
                updated[index].discountPercent = gross > 0 ? (contractDisc.value / gross * 100).toFixed(2) : "0";
              }
            } else {
              updated[index].discountPercent = "0";
              updated[index].discount = "0";
            }
          }
        }
      }
      if (field === "discountPercent") {
        const gross = (updated[index].quantity || 0) * (parseFloat(updated[index].unitPrice) || 0);
        const pct = parseFloat(value) || 0;
        updated[index].discount = (gross * pct / 100).toFixed(2);
      }
      if (field === "discount") {
        const gross = (updated[index].quantity || 0) * (parseFloat(updated[index].unitPrice) || 0);
        const amt = parseFloat(value) || 0;
        updated[index].discountPercent = gross > 0 ? (amt / gross * 100).toFixed(2) : "0";
      }
      if (field === "quantity" || field === "unitPrice") {
        const gross = (updated[index].quantity || 0) * (parseFloat(updated[index].unitPrice) || 0);
        const pct = parseFloat(updated[index].discountPercent) || 0;
        updated[index].discount = (gross * pct / 100).toFixed(2);
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

      let discountPercent = "0";
      let discount = "0";
      if (customerId) {
        const contractDisc = findContractDiscount(customerId, item);
        if (contractDisc) {
          if (contractDisc.type === "percentage") {
            discountPercent = String(contractDisc.value);
          } else {
            discount = String(contractDisc.value);
          }
        }
      }

      const unitPrice = String(item[priceKey] || item.price1);
      const price = parseFloat(unitPrice) || 0;
      const pctDisc = parseFloat(discountPercent) || 0;
      const amtDisc = parseFloat(discount) || 0;
      const lineTotal = Math.max(0, price - (price * pctDisc / 100) - amtDisc).toFixed(2);

      const newLine: LineItem = {
        itemId: item.id,
        description: item.name,
        quantity: 1,
        saleUnit: itemToSaleUnit(item),
        unitPrice,
        discountPercent,
        discount,
        total: lineTotal,
      };
      setLines((prev) => [...prev.filter(l => l.description), newLine]);
    } catch {
      toast({ title: "Error", description: "Failed to look up barcode", variant: "destructive" });
    }
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: "", description: "", quantity: 1, saleUnit: "pc", unitPrice: "0", discountPercent: "0", discount: "0", total: "0" }]);
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
          saleUnit: l.saleUnit,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent || "0",
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
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
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

  const typeLabel = docType === "credit_note" ? "Credit Note" : docType === "proforma" ? "Proforma" : docType === "quotation" ? "Quotation" : "Invoice";

  const selectedCustomer = customers.find(c => c.id === customerId);
  const activeContracts = customerId ? getActiveContracts(customerId) : [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={isNew ? `New ${typeLabel}` : `${typeLabel} ${existingInvoice?.invoiceNumber || ""}`}
        description={isViewMode ? "View document details" : "Fill in the document details"}
        action={
          <div className="flex items-center gap-2">
            {isViewMode && (
              <>
                {(existingInvoice?.type === "proforma" || existingInvoice?.type === "quotation") && (
                  <Button variant="outline" onClick={() => navigate(`/invoices/new?type=invoice&from=${invoiceId}`)} data-testid="button-create-invoice">
                    <FileOutput className="w-4 h-4 mr-1" /> Create Invoice
                  </Button>
                )}
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
                  <Label>Due Date {selectedCustomer && selectedCustomer.paymentTerms !== "cash" && (
                    <span className="text-xs text-muted-foreground ml-1">
                      (auto: {selectedCustomer.paymentTerms.replace("credit_", "")} days)
                    </span>
                  )}</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={isViewMode} data-testid="input-due-date" />
                </div>
              </div>

              {selectedCustomer && !isViewMode && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50">
                  <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      <span className="font-medium">{selectedCustomer.name}</span> &mdash;
                      Terms: <span className="font-medium">{selectedCustomer.paymentTerms === "cash" ? "Cash" : selectedCustomer.paymentTerms.replace("credit_", "") + " days credit"}</span>,
                      Price Level: <span className="font-medium">{priceLevelNames[selectedCustomer.priceLevel - 1] || `Level ${selectedCustomer.priceLevel}`}</span>
                    </p>
                    {activeContracts.length > 0 && (
                      <p>
                        Active contracts: {activeContracts.map(c => (
                          <Badge key={c.id} variant="secondary" className="mr-1 text-xs">
                            {c.name} ({c.discountType === "percentage" ? `${c.discountValue}%` : `€${c.discountValue}`}{c.categoryId ? " cat." : ""}{c.brand ? ` ${c.brand}` : ""})
                          </Badge>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              )}
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
                      <TableHead className="w-[70px]">Qty</TableHead>
                      <TableHead className="w-[90px]">Unit</TableHead>
                      <TableHead className="w-[90px]">Price</TableHead>
                      <TableHead className="w-[140px]">Discount</TableHead>
                      <TableHead className="w-[90px] text-right">Total</TableHead>
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
                                  {items.map((item) => {
                                    const unitLabel = item.unitType === "pack" ? `${item.packSize}-pack` : item.unitType !== "pc" ? item.unitType : "";
                                    return (
                                      <SelectItem key={item.id} value={item.id}>
                                        {item.name} ({item.sku}){unitLabel ? ` - ${unitLabel}` : ""}
                                      </SelectItem>
                                    );
                                  })}
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
                            type="text"
                            inputMode="numeric"
                            value={line.quantity}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d+$/.test(v)) updateLine(idx, "quantity", parseInt(v) || 1); }}
                            disabled={isViewMode}
                            data-testid={`input-line-qty-${idx}`}
                          />
                        </TableCell>
                        <TableCell>
                          {isViewMode ? (
                            <span className="text-sm">{saleUnitLabel(line.saleUnit)}</span>
                          ) : (
                            <Select value={line.saleUnit} onValueChange={(v) => updateLine(idx, "saleUnit", v)}>
                              <SelectTrigger data-testid={`select-line-unit-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pc">Piece</SelectItem>
                                <SelectItem value="bottle">Bottle</SelectItem>
                                <SelectItem value="pack">Pack</SelectItem>
                                <SelectItem value="6-pack">6-Pack</SelectItem>
                                <SelectItem value="12-pack">12-Pack</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={line.unitPrice}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "unitPrice", v); }}
                            disabled={isViewMode}
                            data-testid={`input-line-price-${idx}`}
                          />
                        </TableCell>
                        <TableCell>
                          {isViewMode ? (
                            <div className="text-sm space-y-0.5">
                              {parseFloat(line.discount) > 0 ? (
                                <>
                                  <p>{parseFloat(line.discountPercent || "0").toFixed(1)}%</p>
                                  <p className="text-muted-foreground">€{parseFloat(line.discount).toFixed(2)}</p>
                                </>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <div className="relative">
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={line.discountPercent === "0" || line.discountPercent === "0.00" ? "" : line.discountPercent}
                                  onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "discountPercent", v || "0"); }}
                                  className="pr-6 h-8 text-sm"
                                  data-testid={`input-line-disc-pct-${idx}`}
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                              </div>
                              <div className="relative">
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  value={line.discount === "0" || line.discount === "0.00" ? "" : line.discount}
                                  onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "discount", v || "0"); }}
                                  className="pr-6 h-8 text-sm"
                                  data-testid={`input-line-disc-amt-${idx}`}
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">€</span>
                              </div>
                            </div>
                          )}
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
                  type="text"
                  inputMode="decimal"
                  value={taxRate}
                  onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setTaxRate(v); }}
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
                        <Badge variant="secondary">{customer.paymentTerms === "cash" ? "Cash" : customer.paymentTerms.replace("credit_", "") + " days"}</Badge>
                        <Badge variant="outline">{priceLevelNames[customer.priceLevel - 1] || `Level ${customer.priceLevel}`}</Badge>
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
