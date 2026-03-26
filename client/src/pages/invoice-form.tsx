import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Plus, Trash2, ScanBarcode, Download, Info, FileOutput, Printer, Send, Loader2, WifiOff, Wifi, ChevronLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePriceLevels } from "@/hooks/use-price-levels";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { offlineStore } from "@/lib/offline-store";
import { BarcodeScanner } from "@/components/barcode-scanner";
import type { Customer, Item, Invoice, InvoiceItem, PriceContract, PriceContractRule } from "@shared/schema";

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
  // Always read from the real browser URL — immune to wouter's internal location state.
  const _path = typeof window !== "undefined" ? window.location.pathname : "";
  const _editMatch = /^\/invoices\/([^/?]+)\/edit/.exec(_path);
  const _viewMatch = /^\/invoices\/([^/?]+)$/.exec(_path);
  const isNew = _path === "/invoices/new" || _path.startsWith("/invoices/new");
  const invoiceId = isNew ? undefined : (_editMatch?.[1] ?? (_viewMatch ? _viewMatch[1] : undefined));
  const isViewMode = !!_viewMatch && !_editMatch && !isNew;
  const { toast } = useToast();
  const { isOnline, pendingCount, syncing, syncPending, refreshPendingCount } = useOnlineStatus();

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const docType = searchParams.get("type") || "invoice";
  const fromId = searchParams.get("from");

  const { data: sourceInvoice } = useQuery<Invoice & { items: InvoiceItem[] }>({
    queryKey: ["/api/invoices", fromId],
    enabled: !!fromId && isNew,
  });

  const { data: onlineCustomers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: onlineItems = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: contracts = [] } = useQuery<(PriceContract & { rules?: PriceContractRule[]; priceLevel?: number })[]>({ queryKey: ["/api/price-contracts"] });
  const priceLevelNames = usePriceLevels();
  const { data: existingInvoice, isLoading: invoiceLoading, isError: invoiceError } = useQuery<Invoice & { items: InvoiceItem[] }>({
    queryKey: ["/api/invoices", invoiceId],
    enabled: !!invoiceId,
  });

  const [cachedCustomers, setCachedCustomers] = useState<Customer[]>([]);
  const [cachedItems, setCachedItems] = useState<Item[]>([]);
  const [cachedContracts, setCachedContracts] = useState<(PriceContract & { rules?: PriceContractRule[]; priceLevel?: number })[]>([]);

  useEffect(() => {
    if (onlineCustomers.length > 0) {
      offlineStore.cacheCustomers(onlineCustomers);
    }
    if (onlineItems.length > 0) {
      offlineStore.cacheItems(onlineItems);
    }
    if (contracts.length > 0) {
      offlineStore.cachePriceContracts(contracts);
    }
  }, [onlineCustomers, onlineItems, contracts]);

  useEffect(() => {
    offlineStore.getCachedCustomers().then(c => setCachedCustomers(c as Customer[])).catch(() => {});
    offlineStore.getCachedItems().then(i => setCachedItems(i as Item[])).catch(() => {});
    offlineStore.getCachedPriceContracts().then(c => setCachedContracts(c as any[])).catch(() => {});
  }, []);

  const customers = onlineCustomers.length > 0 ? onlineCustomers : cachedCustomers;
  const items = onlineItems.length > 0 ? onlineItems : cachedItems;
  const allContracts = contracts.length > 0 ? contracts : cachedContracts;

  const [customerId, setCustomerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [taxRate, setTaxRate] = useState("19");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");
  const [overallDiscountPercent, setOverallDiscountPercent] = useState("0");
  const [overallDiscountAmount, setOverallDiscountAmount] = useState("0");
  const [lines, setLines] = useState<LineItem[]>([{ itemId: "", description: "", quantity: 1, saleUnit: "pc", unitPrice: "0", discountPercent: "0", discount: "0", total: "0" }]);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Track which customer was loaded from an existing invoice so the
  // contract-price effect does NOT overwrite the saved line amounts
  // just because items/contracts finish loading after the invoice data.
  const loadedInvoiceCustomerId = useRef<string | null>(null);

  useEffect(() => {
    if (existingInvoice) {
      // Remember this customer ID so the contract-price effect doesn't
      // overwrite the saved line amounts on initial load.
      loadedInvoiceCustomerId.current = existingInvoice.customerId;
      setCustomerId(existingInvoice.customerId);
      setInvoiceDate(existingInvoice.date);
      setDueDate(existingInvoice.dueDate || "");
      setTaxRate(existingInvoice.taxRate);
      setNotes(existingInvoice.notes || "");
      setStatus(existingInvoice.status);
      setOverallDiscountAmount(existingInvoice.discountAmount || "0");
      if (existingInvoice.items?.length) {
        setLines(existingInvoice.items.map((li) => ({
          itemId: li.itemId || "",
          description: li.description || "",
          quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
          saleUnit: (li as any).saleUnit || "pc",
          unitPrice: String(li.unitPrice ?? "0"),
          discountPercent: String((li as any).discountPercent ?? "0"),
          discount: String(li.discount ?? "0"),
          total: String(li.total ?? "0"),
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
          description: li.description || "",
          quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
          saleUnit: (li as any).saleUnit || "pc",
          unitPrice: String(li.unitPrice ?? "0"),
          discountPercent: String((li as any).discountPercent ?? "0"),
          discount: String(li.discount ?? "0"),
          total: String(li.total ?? "0"),
        })));
      }
    }
  }, [sourceInvoice, isNew]);

  const getActiveContracts = useCallback((custId: string) => {
    const today = new Date().toISOString().split("T")[0];
    return allContracts.filter(c =>
      c.customerId === custId &&
      c.active &&
      c.startDate <= today &&
      c.endDate >= today
    );
  }, [allContracts]);

  const findContractDiscount = useCallback((custId: string, item: Item, quantity: number = 1) => {
    const activeContracts = getActiveContracts(custId);
    const customer = customers.find(c => c.id === custId);
    const priceLevel = customer?.priceLevel || 1;
    const levelPriceKey = `price${priceLevel}` as keyof Item;
    const levelPrice = parseFloat(String(item[levelPriceKey])) || 0;
    const retailPrice = parseFloat(item.price1) || 0;

    let bestDiscount: { type: string; value: number; name: string } | null = null;
    let bestDiscountedPrice = levelPrice;

    for (const contract of activeContracts) {
      const rules = (contract as any).rules || [];
      if (rules.length === 0) {
        const catIds = contract.categoryIds?.length ? contract.categoryIds : (contract.categoryId ? [contract.categoryId] : []);
        const brandList = contract.brands?.length ? contract.brands : (contract.brand ? [contract.brand] : []);
        if (catIds.length > 0 && (!item.categoryId || !catIds.includes(item.categoryId))) continue;
        if (brandList.length > 0 && (!item.brand || !brandList.includes(item.brand))) continue;
        const contractMinQty = contract.minQuantity || 0;
        if (quantity < contractMinQty) continue;
        const discVal = parseFloat(String(contract.discountValue)) || 0;
        if (discVal <= 0) continue;
        const discountedPrice = contract.discountType === "percentage"
          ? retailPrice * (1 - discVal / 100)
          : retailPrice - discVal;
        if (discountedPrice < bestDiscountedPrice) {
          bestDiscountedPrice = discountedPrice;
          bestDiscount = { type: contract.discountType, value: discVal, name: contract.name };
        }
        continue;
      }

      for (const rule of rules) {
        const ruleCats = rule.categoryIds || [];
        const ruleBrands = rule.brands || [];
        if (ruleCats.length > 0 && (!item.categoryId || !ruleCats.includes(item.categoryId))) continue;
        if (ruleBrands.length > 0 && (!item.brand || !ruleBrands.includes(item.brand))) continue;
        const ruleMinQty = rule.minQuantity || 0;
        if (quantity < ruleMinQty) continue;

        const discVal = parseFloat(String(rule.discountValue)) || 0;
        if (discVal <= 0) continue;
        const discountedPrice = rule.discountType === "percentage"
          ? retailPrice * (1 - discVal / 100)
          : retailPrice - discVal;
        if (discountedPrice < bestDiscountedPrice) {
          bestDiscountedPrice = discountedPrice;
          bestDiscount = { type: rule.discountType, value: discVal, name: contract.name };
        }
      }
    }
    return bestDiscount;
  }, [getActiveContracts, customers]);

  useEffect(() => {
    if (customerId && invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
      const customer = customers.find((c) => c.id === customerId);
      if (customer) {
        const days = getPaymentDays(customer.paymentTerms);
        const due = new Date(invoiceDate + "T00:00:00");
        if (!isNaN(due.getTime())) {
          due.setDate(due.getDate() + days);
          setDueDate(due.toISOString().split("T")[0]);
        }
      }
    }
  }, [customerId, invoiceDate, customers]);

  useEffect(() => {
    if (!customerId || isViewMode) return;
    // When editing an existing invoice, only re-apply contract prices if
    // the user has actively changed the customer (not on initial data load).
    if (loadedInvoiceCustomerId.current === customerId) return;
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
        const contractDisc = findContractDiscount(customerId, item, qty);
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
  }, [customerId, allContracts, items, customers, findContractDiscount, isViewMode]);

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
            const lineQty = updated[index].quantity || 0;
            const contractDisc = findContractDiscount(customerId, item, lineQty);
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

  const handleBarcodeScan = async (barcode: string) => {
    try {
      let item: any;
      if (navigator.onLine) {
        const res = await fetch(`/api/items/barcode/${barcode}`);
        if (!res.ok) {
          toast({ title: "Item not found", description: `No item with barcode ${barcode}`, variant: "destructive" });
          return;
        }
        item = await res.json();
      } else {
        item = items.find((i: any) => i.barcode === barcode);
        if (!item) {
          toast({ title: "Item not found", description: `No item with barcode ${barcode} in cached data`, variant: "destructive" });
          return;
        }
      }
      const customer = customers.find((c) => c.id === customerId);
      const level = customer?.priceLevel || 1;
      const priceKey = `price${level}` as keyof typeof item;

      let discountPercent = "0";
      let discount = "0";
      const newQty = 1;
      if (customerId) {
        const contractDisc = findContractDiscount(customerId, item, newQty);
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

      setLines((prev) => {
        const filtered = prev.filter(l => l.description);
        const existingIndex = filtered.findIndex(l => l.itemId === item.id);
        if (existingIndex >= 0) {
          const existing = filtered[existingIndex];
          const newQty2 = existing.quantity + 1;
          const ep = parseFloat(existing.unitPrice) || 0;
          const ePct = parseFloat(existing.discountPercent) || 0;
          const eAmt = parseFloat(existing.discount) || 0;
          const eLineTotal = (Math.max(0, ep - (ep * ePct / 100) - eAmt) * newQty2).toFixed(2);
          const updated = [...filtered];
          updated[existingIndex] = { ...existing, quantity: newQty2, total: eLineTotal };
          return updated;
        }
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
        return [...filtered, newLine];
      });
    } catch {
      toast({ title: "Error", description: "Failed to look up barcode", variant: "destructive" });
    }
  };

  const addLine = () => setLines((prev) => [...prev, { itemId: "", description: "", quantity: 1, saleUnit: "pc", unitPrice: "0", discountPercent: "0", discount: "0", total: "0" }]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const linesSubtotal = lines.reduce((sum, l) => sum + (parseFloat(l.total) || 0), 0);
  const discPct = parseFloat(overallDiscountPercent) || 0;
  const discAmt = parseFloat(overallDiscountAmount) || 0;
  const computedDiscount = discPct > 0 ? linesSubtotal * (discPct / 100) : discAmt;

  const displaySubtotal = isViewMode && existingInvoice ? parseFloat(existingInvoice.subtotal) : linesSubtotal - computedDiscount;
  const displayTaxAmount = isViewMode && existingInvoice ? parseFloat(existingInvoice.taxAmount) : displaySubtotal * (parseFloat(taxRate) / 100);
  const displayTotal = isViewMode && existingInvoice ? parseFloat(existingInvoice.total) : displaySubtotal + displayTaxAmount;
  const displayDiscount = isViewMode && existingInvoice ? parseFloat(existingInvoice.discountAmount || "0") : computedDiscount;

  const subtotal = isViewMode ? displaySubtotal : linesSubtotal - computedDiscount;
  const taxAmount = isViewMode ? displayTaxAmount : subtotal * (parseFloat(taxRate) / 100);
  const total = isViewMode ? displayTotal : subtotal + taxAmount;

  // Determine which list to return to based on document type
  const resolvedDocType = existingInvoice?.type || docType;
  const backUrl = resolvedDocType === "credit_note" ? "/credit-notes"
    : resolvedDocType === "proforma" ? "/proforma"
    : resolvedDocType === "quotation" ? "/quotations"
    : "/invoices";

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
        discountAmount: computedDiscount.toFixed(2),
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

      if (!navigator.onLine) {
        const customer = customers.find(c => c.id === customerId);
        const offlineInvoice = {
          offlineId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          payload,
          customerName: customer?.name || "Unknown",
          createdAt: new Date().toISOString(),
        };
        await offlineStore.savePendingInvoice(offlineInvoice);
        await refreshPendingCount();
        return { id: offlineInvoice.offlineId, offline: true };
      }

      if (invoiceId && _editMatch) {
        const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}`, payload);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/invoices", payload);
        return res.json();
      }
    },
    onSuccess: (data) => {
      if (data.offline) {
        toast({ title: "Saved offline", description: "Invoice queued for sync when internet returns" });
        window.location.href = backUrl;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Invoice saved successfully" });
      window.location.href = backUrl;
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendEmail = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/send-email`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Email Sent", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/email-logs"] });
    },
    onError: (e: Error) => toast({ title: "Email Failed", description: e.message, variant: "destructive" }),
  });

  const openDocument = (mode: "view" | "print") => {
    const url = mode === "print"
      ? `/api/invoices/${invoiceId}/pdf?print=1`
      : `/api/invoices/${invoiceId}/pdf`;
    window.open(url, "_blank");
  };

  const downloadDocument = async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf?download=1`);
      if (!res.ok) throw new Error("Failed to generate document");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${existingInvoice?.invoiceNumber || "invoice"}.html`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const typeLabel = docType === "credit_note" ? "Credit Note" : docType === "proforma" ? "Proforma" : docType === "quotation" ? "Quotation" : "Invoice";

  const selectedCustomer = customers.find(c => c.id === customerId);
  const activeContracts = customerId ? getActiveContracts(customerId) : [];

  // Show loading spinner while fetching an existing invoice
  if (invoiceId && invoiceLoading) {
    return (
      <div className="p-4 sm:p-6 flex flex-col items-center justify-center gap-4 min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading invoice...</p>
      </div>
    );
  }

  // Show error if invoice failed to load
  if (invoiceId && invoiceError) {
    return (
      <div className="p-4 sm:p-6 flex flex-col items-center justify-center gap-4 min-h-[300px]">
        <p className="text-sm text-destructive font-medium">Could not load invoice. It may have been deleted or you may not have access.</p>
        <a href={backUrl} className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent transition-colors">
          <ChevronLeft className="w-4 h-4" /> Back to list
        </a>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      {!isOnline && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800" data-testid="offline-banner">
          <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-sm text-amber-700 dark:text-amber-300 font-medium">You are offline.</span>
          <span className="text-xs text-amber-600 dark:text-amber-400">Invoices will be saved locally and synced when connection returns.</span>
        </div>
      )}
      {isOnline && pendingCount > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800" data-testid="pending-sync-banner">
          <Wifi className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="text-sm text-blue-700 dark:text-blue-300">
            {pendingCount} offline invoice{pendingCount > 1 ? "s" : ""} pending sync.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-xs"
            onClick={syncPending}
            disabled={syncing}
            data-testid="button-sync-invoices"
          >
            {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
        </div>
      )}
      <PageHeader
        title={isNew ? `New ${typeLabel}` : `${typeLabel} ${existingInvoice?.invoiceNumber || ""}`}
        description={isViewMode ? "View document details" : "Fill in the document details"}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <a href={backUrl} data-testid="button-back-to-list" className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md hover:bg-accent transition-colors">
              <ChevronLeft className="w-4 h-4" /> Back
            </a>
            {!isNew && invoiceId && (
              <>
                {(existingInvoice?.type === "proforma" || existingInvoice?.type === "quotation") && (
                  <a href={`/invoices/new?type=invoice&from=${invoiceId}`} data-testid="button-create-invoice" className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent transition-colors">
                    <FileOutput className="w-4 h-4" /> <span className="hidden sm:inline">Create</span> Invoice
                  </a>
                )}
                <Button variant="outline" onClick={() => openDocument("print")} data-testid="button-print-invoice">
                  <Printer className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Print</span>
                </Button>
                <Button variant="outline" onClick={downloadDocument} data-testid="button-download-pdf">
                  <Download className="w-4 h-4 sm:mr-1" /> <span className="hidden sm:inline">Download</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sendEmail.mutate()}
                  disabled={sendEmail.isPending || !selectedCustomer?.email || !invoiceId}
                  data-testid="button-send-email"
                >
                  {sendEmail.isPending ? <Loader2 className="w-4 h-4 sm:mr-1 animate-spin" /> : <Send className="w-4 h-4 sm:mr-1" />}
                  <span className="hidden sm:inline">{sendEmail.isPending ? "Sending..." : "Send"}</span>
                </Button>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item · Qty · Unit</TableHead>
                      <TableHead className="w-[200px]">Unit Price</TableHead>
                      <TableHead className="w-[180px]">Discount</TableHead>
                      <TableHead className="w-[130px] text-right">Total</TableHead>
                      {!isViewMode && <TableHead className="w-[50px]" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {isViewMode ? (
                            <div>
                              <span className="text-sm">{line.description}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{line.quantity} × {saleUnitLabel(line.saleUnit)}</p>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
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
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground shrink-0">Qty</span>
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={line.quantity > 0 ? line.quantity : ""}
                                  onChange={(e) => { const v = parseInt(e.target.value); updateLine(idx, "quantity", isNaN(v) || v < 1 ? 1 : v); }}
                                  onFocus={(e) => e.target.select()}
                                  onBlur={() => { if (!line.quantity || line.quantity < 1) updateLine(idx, "quantity", 1); }}
                                  data-testid={`input-line-qty-${idx}`}
                                />
                                <Select value={line.saleUnit} onValueChange={(v) => updateLine(idx, "saleUnit", v)}>
                                  <SelectTrigger className="flex-1" data-testid={`select-line-unit-${idx}`}>
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
                              </div>
                            </div>
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
                                  <p className="text-muted-foreground">{"\u20AC"}{parseFloat(line.discount).toFixed(2)}</p>
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
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{"\u20AC"}</span>
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">
                          {"\u20AC"}{parseFloat(line.total).toFixed(2)}
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

              {/* Mobile card view */}
              <div className="md:hidden divide-y">
                {lines.map((line, idx) => (
                  <div key={idx} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {isViewMode ? (
                          <span className="text-sm font-medium">{line.description}</span>
                        ) : (
                          <div className="space-y-1">
                            <Select value={line.itemId || "custom"} onValueChange={(v) => updateLine(idx, "itemId", v === "custom" ? "" : v)}>
                              <SelectTrigger data-testid={`select-line-item-mobile-${idx}`}>
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
                              />
                            )}
                          </div>
                        )}
                      </div>
                      {!isViewMode && lines.length > 1 && (
                        <Button size="icon" variant="ghost" onClick={() => removeLine(idx)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground">Qty</Label>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          style={{ color: 'hsl(var(--foreground))', WebkitTextFillColor: 'hsl(var(--foreground))' }}
                          value={line.quantity > 0 ? line.quantity : ""}
                          onChange={(e) => { const v = parseInt(e.target.value); updateLine(idx, "quantity", isNaN(v) || v < 1 ? 1 : v); }}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => { if (!line.quantity || line.quantity < 1) updateLine(idx, "quantity", 1); }}
                          disabled={isViewMode}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Unit</Label>
                        {isViewMode ? (
                          <div className="flex items-center h-9 text-sm">{saleUnitLabel(line.saleUnit)}</div>
                        ) : (
                          <Select value={line.saleUnit} onValueChange={(v) => updateLine(idx, "saleUnit", v)}>
                            <SelectTrigger>
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
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs text-muted-foreground">Unit Price</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "unitPrice", v); }}
                          disabled={isViewMode}
                        />
                      </div>
                    </div>

                    {!isViewMode && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Disc %</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={line.discountPercent === "0" || line.discountPercent === "0.00" ? "" : line.discountPercent}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "discountPercent", v || "0"); }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Disc {"\u20AC"}</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={line.discount === "0" || line.discount === "0.00" ? "" : line.discount}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "discount", v || "0"); }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      {isViewMode && parseFloat(line.discount) > 0 && (
                        <span className="text-xs text-muted-foreground">Disc: {parseFloat(line.discountPercent || "0").toFixed(1)}% ({"\u20AC"}{parseFloat(line.discount).toFixed(2)})</span>
                      )}
                      {isViewMode && parseFloat(line.discount) <= 0 && <span />}
                      {!isViewMode && <span />}
                      <span className="text-sm font-semibold">{"\u20AC"}{parseFloat(line.total).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
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
                <span className="text-muted-foreground">Lines Subtotal</span>
                <span className="font-medium">€{linesSubtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Discount %</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={overallDiscountPercent}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) {
                      setOverallDiscountPercent(v);
                      if (parseFloat(v) > 0) setOverallDiscountAmount("0");
                    }
                  }}
                  className="w-20 text-right"
                  disabled={isViewMode}
                  data-testid="input-overall-discount-percent"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Discount €</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={overallDiscountAmount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) {
                      setOverallDiscountAmount(v);
                      if (parseFloat(v) > 0) setOverallDiscountPercent("0");
                    }
                  }}
                  className="w-20 text-right"
                  disabled={isViewMode || discPct > 0}
                  data-testid="input-overall-discount-amount"
                />
              </div>
              {(isViewMode ? displayDiscount : computedDiscount) > 0 && (
                <div className="flex justify-between text-sm text-red-600">
                  <span>Overall Discount</span>
                  <span>-€{(isViewMode ? displayDiscount : computedDiscount).toFixed(2)}</span>
                </div>
              )}
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
              <a href={backUrl} data-testid="button-cancel" className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent transition-colors">Cancel</a>
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
