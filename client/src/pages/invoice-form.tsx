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
import { Plus, Trash2, ScanBarcode, Download, Info, FileOutput, Printer, Send, Loader2, WifiOff, Wifi, ChevronLeft, CheckCircle, XCircle, RotateCcw, CreditCard, FileText, Lock, History, Hash } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "./dashboard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePriceLevels } from "@/hooks/use-price-levels";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { offlineStore } from "@/lib/offline-store";
import { BarcodeScanner } from "@/components/barcode-scanner";
import type { Customer, Item, Invoice, InvoiceItem, PriceContract, PriceContractRule, PriceContractItem, CustomerDeliveryLocation } from "@shared/schema";

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

type PriceHistoryEntry = {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  customerId: string;
  customerName: string;
  quantity: number;
  unitPrice: string;
  discountPercent: string;
  discountAmount: string;
};

function ItemPriceHistoryPopover({ itemId, itemName }: { itemId: string; itemName: string }) {
  const [open, setOpen] = useState(false);
  const { data: history = [], isLoading } = useQuery<PriceHistoryEntry[]>({
    queryKey: ["/api/items", itemId, "price-history"],
    enabled: open && !!itemId,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={`button-price-history-${itemId}`}
          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="View price history across all customers"
        >
          <History className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-[380px] p-0">
        <div className="p-3 border-b">
          <p className="text-sm font-medium">Price history</p>
          <p className="text-xs text-muted-foreground truncate">{itemName} — all customers</p>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No sales history found</div>
        ) : (
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Customer</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Qty</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Unit price</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Disc %</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => {
                  const dateStr = entry.date
                    ? new Date(entry.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })
                    : "";
                  const discPct = parseFloat(entry.discountPercent) || 0;
                  return (
                    <tr key={i} className="border-t border-border/50 hover:bg-muted/40 transition-colors">
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{dateStr}</td>
                      <td className="px-3 py-1.5 max-w-[120px] truncate" title={entry.customerName}>{entry.customerName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{entry.quantity}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">€{parseFloat(entry.unitPrice).toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{discPct > 0 ? `${discPct.toFixed(1)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {history.length > 0 && (
          <div className="px-3 py-2 border-t text-xs text-muted-foreground">
            Showing {history.length} most recent sale{history.length !== 1 ? "s" : ""}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function saleUnitLabel(unit: string): string {
  switch (unit) {
    case "bottle": return "Bottle";
    case "6-pack": return "6-Pack";
    case "12-pack": return "12-Pack";
    case "pack": return "Pack";
    case "kg": return "kg";
    case "lt": return "lt";
    case "gr": return "gr";
    case "ml": return "ml";
    default: return "Piece";
  }
}

function itemToSaleUnit(item: Item): string {
  if (item.unitType === "bottle") return "bottle";
  if (item.unitType === "pack" && item.packSize === 6) return "6-pack";
  if (item.unitType === "pack" && item.packSize === 12) return "12-pack";
  if (item.unitType === "6-pack") return "6-pack";
  if (item.unitType === "12-pack") return "12-pack";
  if (item.unitType === "kg") return "kg";
  if (item.unitType === "lt") return "lt";
  if (item.unitType === "gr") return "gr";
  if (item.unitType === "ml") return "ml";
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

  const { data: currentUser } = useQuery<{ id: string; username: string; role: string }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "superuser";

  const { data: onlineCustomers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: onlineItems = [] } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: categories = [] } = useQuery<{ id: string; vatRate: string | null }[]>({ queryKey: ["/api/categories"] });
  type PriceContractWithDetails = PriceContract & { rules?: PriceContractRule[]; priceLevel?: number; contractItems?: PriceContractItem[] };
  const { data: contracts = [] } = useQuery<PriceContractWithDetails[]>({ queryKey: ["/api/price-contracts"] });
  const priceLevelNames = usePriceLevels();
  const { data: existingInvoice, isLoading: invoiceLoading, isError: invoiceError } = useQuery<Invoice & { items: InvoiceItem[] }>({
    queryKey: ["/api/invoices", invoiceId],
    enabled: !!invoiceId,
  });

  const [cachedCustomers, setCachedCustomers] = useState<Customer[]>([]);
  const [cachedItems, setCachedItems] = useState<Item[]>([]);
  const [cachedContracts, setCachedContracts] = useState<PriceContractWithDetails[]>([]);

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
    offlineStore.getCachedPriceContracts().then(c => setCachedContracts(c as PriceContractWithDetails[])).catch(() => {});
  }, []);

  const customers = onlineCustomers.length > 0 ? onlineCustomers : cachedCustomers;
  const items = onlineItems.length > 0 ? onlineItems : cachedItems;
  const allContracts = contracts.length > 0 ? contracts : cachedContracts;

  const [customerId, setCustomerId] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [customDeliveryLocation, setCustomDeliveryLocation] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState("");
  const [taxRate, setTaxRate] = useState("19");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");
  const [customInvoiceNumber, setCustomInvoiceNumber] = useState("");
  const [overallDiscountPercent, setOverallDiscountPercent] = useState("0");
  const [overallDiscountAmount, setOverallDiscountAmount] = useState("0");
  const [lines, setLines] = useState<LineItem[]>([{ itemId: "", description: "", quantity: 1, saleUnit: "pc", unitPrice: "0", discountPercent: "0", discount: "0", total: "0" }]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualDiscountLines, setManualDiscountLines] = useState<Set<number>>(new Set());

  type LastPriceEntry = { lastUnitPrice: string; lastDiscountPercent: string; lastDiscountAmount: string; invoiceDate: string; invoiceNumber: string };
  const lastPricesUrl = customerId
    ? `/api/invoices/last-prices/${customerId}${invoiceId ? `?exclude=${invoiceId}` : ""}`
    : null;
  const { data: lastPricesData = {} } = useQuery<Record<string, LastPriceEntry[]>>({
    queryKey: [lastPricesUrl],
    enabled: !!lastPricesUrl,
  });

  const { data: customerDeliveryLocations = [] } = useQuery<CustomerDeliveryLocation[]>({
    queryKey: ["/api/customers", customerId, "delivery-locations"],
    queryFn: () => fetch(`/api/customers/${customerId}/delivery-locations`, { credentials: "include" }).then(r => r.json()),
    enabled: !!customerId,
  });

  const { data: nextNumberData } = useQuery<{ number: string }>({
    queryKey: ["/api/invoices/next-number", docType],
    queryFn: () => fetch(`/api/invoices/next-number?type=${docType}`, { credentials: "include" }).then(r => r.json()),
    enabled: isNew,
    staleTime: 0,
  });

  useEffect(() => {
    if (isNew && nextNumberData?.number && !customInvoiceNumber) {
      setCustomInvoiceNumber(nextNumberData.number);
    }
  }, [nextNumberData, isNew]);

  const deleteInvoiceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/invoices/${invoiceId}`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Document deleted" });
      window.location.href = backUrl;
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const quickSaveMutation = useMutation({
    mutationFn: async ({ custId, itemId, fixedPrice }: { custId: string; itemId: string; fixedPrice: number }) => {
      const res = await apiRequest("POST", "/api/price-contracts/quick-save", { customerId: custId, itemId, fixedPrice });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-contracts"] });
      toast({ title: "Contract price saved", description: "This price will auto-apply on future invoices for this customer." });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    },
  });

  // Auto-fill delivery location for new invoices only.
  // Priority: customer's default saved location → customer.location field → blank.
  // Guarded by a ref so re-renders / query refetches never overwrite a manual change.
  const autoFilledLocCustomerRef = useRef<string>("");

  // Step 1: when customer changes, reset the guard and apply fallback immediately
  useEffect(() => {
    if (!customerId || existingInvoice) return;
    if (customerId === autoFilledLocCustomerRef.current) return;
    autoFilledLocCustomerRef.current = customerId;
    // Fallback to customer.location; will be overwritten by step 2 if saved locations exist
    const cust = customers.find(c => c.id === customerId);
    const fallback = cust?.location || "";
    setDeliveryLocation(fallback);
    setCustomDeliveryLocation(fallback ? fallback : "");
  }, [customerId, customers, existingInvoice]);

  // Step 2: once saved locations arrive for the current customer, prefer the default one
  useEffect(() => {
    if (existingInvoice) return;
    if (!customerId) return;
    // Only auto-fill once per customer — if the guard has moved on, skip
    if (autoFilledLocCustomerRef.current !== customerId) return;
    const defaultLoc = customerDeliveryLocations.find(l => l.isDefault);
    if (!defaultLoc) return; // no explicit default — keep the customer.location fallback
    setDeliveryLocation(defaultLoc.name);
    setCustomDeliveryLocation("");
  }, [customerDeliveryLocations]); // intentionally narrow: only react to the list itself

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
      setDeliveryLocation((existingInvoice as any).deliveryLocation || "");
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
      if (docType === "credit_note") {
        setNotes(`Credit note against ${sourceInvoice.invoiceNumber}${sourceInvoice.notes ? `\n${sourceInvoice.notes}` : ""}`);
      } else {
        setNotes(sourceInvoice.notes ? `From ${sourceInvoice.type === "proforma" ? "Proforma" : "Quotation"} ${sourceInvoice.invoiceNumber}\n${sourceInvoice.notes}` : `From ${sourceInvoice.type === "proforma" ? "Proforma" : "Quotation"} ${sourceInvoice.invoiceNumber}`);
      }
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
  }, [sourceInvoice, isNew, docType]);

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

    // Check fixed-price contract items first (highest priority)
    for (const contract of activeContracts) {
      const contractItemsList: PriceContractItem[] = contract.contractItems || [];
      const match = contractItemsList.find(ci => ci.itemId === item.id);
      if (match) {
        const specialPrice = parseFloat(String(match.specialPrice));
        if (specialPrice > 0) {
          return { type: "fixed_price", value: specialPrice, name: contract.name, source: contract.source };
        }
      }
    }

    let bestDiscount: { type: string; value: number; name: string; source?: string | null } | null = null;
    let bestDiscountedPrice = levelPrice;

    for (const contract of activeContracts) {
      const rules = contract.rules || [];
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
          if (contractDisc.type === "fixed_price") {
            newLine.unitPrice = String(contractDisc.value);
            newLine.discountPercent = "0";
            newLine.discount = "0";
          } else if (contractDisc.type === "percentage") {
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
        newLine.total = Math.max(0, (parseFloat(newLine.unitPrice) || 0) * qty - amtDisc).toFixed(2);
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
          // Resolve effective VAT rate: item's own rate → category rate → 19% default
          const catVatRate = categories.find((c) => c.id === item.categoryId)?.vatRate;
          const effectiveVat = item.vatRate ?? catVatRate ?? "19";
          if (!existingInvoice) {
            setTaxRate(String(parseFloat(effectiveVat)));
          }

          if (customerId) {
            const lineQty = updated[index].quantity || 0;
            const contractDisc = findContractDiscount(customerId, item, lineQty);
            if (contractDisc) {
              if (contractDisc.type === "fixed_price") {
                updated[index].unitPrice = String(contractDisc.value);
                updated[index].discountPercent = "0";
                updated[index].discount = "0";
              } else if (contractDisc.type === "percentage") {
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
      let overrideUnitPrice: string | null = null;
      if (customerId) {
        const contractDisc = findContractDiscount(customerId, item, newQty);
        if (contractDisc) {
          if (contractDisc.type === "fixed_price") {
            overrideUnitPrice = String(contractDisc.value);
          } else if (contractDisc.type === "percentage") {
            discountPercent = String(contractDisc.value);
          } else {
            discount = String(contractDisc.value);
          }
        }
      }

      const unitPrice = overrideUnitPrice ?? String(item[priceKey] || item.price1);
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
        deliveryLocation: deliveryLocation || null,
        linkedInvoiceId: fromId || null,
        items: lines.filter((l) => l.description).map((l) => ({
          itemId: l.itemId || null,
          description: l.description,
          quantity: String(l.quantity),
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
        const res = await apiRequest("POST", "/api/invoices", { ...payload, invoiceNumber: customInvoiceNumber || undefined });
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
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
    onError: (e: Error) => toast({ title: "Email Failed", description: e.message, variant: "destructive" }),
  });

  const changeStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      const res = await apiRequest("PATCH", `/api/invoices/${invoiceId}/status`, { status: newStatus });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: (_, newStatus) => {
      const labels: Record<string, string> = { sent: "Sent", paid: "Paid", cancelled: "Cancelled", draft: "Reopened", overdue: "Overdue" };
      toast({ title: `Marked as ${labels[newStatus] || newStatus}` });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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

                {/* Status action buttons — only for invoice/credit_note */}
                {(existingInvoice?.type === "invoice" || existingInvoice?.type === "credit_note") && (
                  <>
                    {(status === "draft") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => changeStatus.mutate("sent")}
                        disabled={changeStatus.isPending}
                        data-testid="button-mark-sent"
                        className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30"
                      >
                        <CheckCircle className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">Mark Sent</span>
                      </Button>
                    )}
                    {(status === "draft" || status === "sent" || status === "overdue") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => changeStatus.mutate("paid")}
                        disabled={changeStatus.isPending}
                        data-testid="button-mark-paid"
                        className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                      >
                        <CreditCard className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">Mark Paid</span>
                      </Button>
                    )}
                    {status === "draft" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => changeStatus.mutate("cancelled")}
                        disabled={changeStatus.isPending}
                        data-testid="button-mark-cancelled"
                        className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-900/30"
                      >
                        <XCircle className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">Cancel</span>
                      </Button>
                    )}
                    {(status === "sent" || status === "paid" || status === "overdue") && invoiceId && (
                      <a
                        href={`/invoices/new?type=credit_note&from=${invoiceId}`}
                        data-testid="button-issue-credit-note"
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md border border-violet-300 text-violet-700 bg-transparent hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/30 transition-colors"
                      >
                        <FileText className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">Credit Note</span>
                      </a>
                    )}
                    {(status === "paid" || status === "cancelled") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => changeStatus.mutate("draft")}
                        disabled={changeStatus.isPending}
                        data-testid="button-reopen"
                        className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/30"
                      >
                        <RotateCcw className="w-4 h-4 sm:mr-1" />
                        <span className="hidden sm:inline">Reopen</span>
                      </Button>
                    )}
                  </>
                )}

                {invoiceId && isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const hasPayments = existingInvoice?.type === "invoice" && status !== "draft";
                      const warning = hasPayments
                        ? `Delete this ${typeLabel} (${existingInvoice?.invoiceNumber})?\n\nThis will also remove any linked payments and reverse stock. This cannot be undone.`
                        : `Delete this ${typeLabel} (${existingInvoice?.invoiceNumber})? This cannot be undone.`;
                      if (confirm(warning)) {
                        deleteInvoiceMutation.mutate();
                      }
                    }}
                    disabled={deleteInvoiceMutation.isPending}
                    data-testid="button-delete-draft"
                    className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                  >
                    {deleteInvoiceMutation.isPending ? <Loader2 className="w-4 h-4 sm:mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 sm:mr-1" />}
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                )}
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
                  <div className="flex items-center h-9 px-3 rounded-md border bg-muted/30" data-testid="display-invoice-status">
                    <StatusBadge status={status} />
                    {isNew && <span className="text-xs text-muted-foreground ml-2">New invoices start as Draft</span>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                    Document Number
                  </Label>
                  {isNew ? (
                    <Input
                      value={customInvoiceNumber}
                      onChange={(e) => setCustomInvoiceNumber(e.target.value)}
                      placeholder="Auto-assigned…"
                      data-testid="input-invoice-number"
                    />
                  ) : (
                    <div className="flex items-center h-9 px-3 rounded-md border bg-muted/30 font-mono text-sm font-semibold tracking-wide" data-testid="display-invoice-number">
                      {existingInvoice?.invoiceNumber || "—"}
                    </div>
                  )}
                  {isNew && sourceInvoice && (sourceInvoice.type === "proforma" || sourceInvoice.type === "quotation") && (
                    customInvoiceNumber === sourceInvoice.invoiceNumber ? (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        Using original {sourceInvoice.type === "proforma" ? "proforma" : "quotation"} number
                        <button
                          type="button"
                          className="underline text-primary hover:no-underline"
                          onClick={() => setCustomInvoiceNumber(nextNumberData?.number || "")}
                        >
                          reset to auto
                        </button>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        Keep original number?{" "}
                        <button
                          type="button"
                          className="underline text-primary hover:no-underline"
                          data-testid="button-use-source-number"
                          onClick={() => setCustomInvoiceNumber(sourceInvoice.invoiceNumber)}
                        >
                          Use {sourceInvoice.invoiceNumber}
                        </button>
                      </p>
                    )
                  )}
                  {isNew && customInvoiceNumber && nextNumberData?.number && customInvoiceNumber !== nextNumberData.number && !(sourceInvoice && customInvoiceNumber === sourceInvoice.invoiceNumber) && (
                    <p className="text-xs text-amber-600 mt-1">Custom number — ensure it's unique</p>
                  )}
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

              <div className="space-y-1.5">
                <Label>Delivery Location</Label>
                {customerDeliveryLocations.length > 0 && !isViewMode ? (
                  <div className="space-y-1.5">
                    <Select
                      value={customerDeliveryLocations.some(l => l.name === deliveryLocation) ? deliveryLocation : "__custom__"}
                      onValueChange={(val) => {
                        if (val === "__custom__") {
                          setDeliveryLocation(customDeliveryLocation);
                        } else {
                          setDeliveryLocation(val);
                          setCustomDeliveryLocation("");
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-delivery-location">
                        <SelectValue placeholder="Select delivery location…" />
                      </SelectTrigger>
                      <SelectContent>
                        {customerDeliveryLocations.map(loc => (
                          <SelectItem key={loc.id} value={loc.name}>
                            <span className="flex items-center gap-1.5">
                              {loc.name}
                              {loc.isDefault && <span className="text-xs text-muted-foreground">(default)</span>}
                            </span>
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">Other / custom…</SelectItem>
                      </SelectContent>
                    </Select>
                    {(!customerDeliveryLocations.some(l => l.name === deliveryLocation)) && (
                      <Input
                        value={customDeliveryLocation}
                        onChange={(e) => { setCustomDeliveryLocation(e.target.value); setDeliveryLocation(e.target.value); }}
                        placeholder="Enter delivery location…"
                        data-testid="input-delivery-location-custom"
                      />
                    )}
                  </div>
                ) : (
                  <Input
                    value={deliveryLocation}
                    onChange={(e) => setDeliveryLocation(e.target.value)}
                    placeholder="e.g. Nicosia Main Branch, Beach Bar…"
                    disabled={isViewMode}
                    data-testid="input-delivery-location"
                  />
                )}
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
                              <Select value={line.itemId || "custom"} onValueChange={(v) => {
                                updateLine(idx, "itemId", v === "custom" ? "" : v);
                                setManualDiscountLines(prev => { const next = new Set(prev); next.delete(idx); return next; });
                              }}>
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
                              {line.itemId && lastPricesData[line.itemId]?.length > 0 && (
                                <div className="space-y-0.5" data-testid={`hint-last-price-${idx}`}>
                                  {lastPricesData[line.itemId].map((lp, hi) => {
                                    const lpDisc = parseFloat(lp.lastDiscountPercent) || 0;
                                    const lpDate = lp.invoiceDate ? new Date(lp.invoiceDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "";
                                    const isMostRecent = hi === 0;
                                    return (
                                      <div key={hi} className="flex items-center gap-1 flex-wrap">
                                        <span className={`text-xs px-1.5 py-0.5 rounded border leading-tight ${isMostRecent ? "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "text-muted-foreground bg-muted/40 border-border"}`}>
                                          {isMostRecent ? "💡" : "↩"} €{parseFloat(lp.lastUnitPrice).toFixed(2)}{lpDisc > 0 ? ` −${lpDisc.toFixed(1)}%` : ""}
                                          {lp.invoiceNumber ? ` · ${lp.invoiceNumber}` : ""}{lpDate ? ` · ${lpDate}` : ""}
                                        </span>
                                        {isMostRecent && (
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-5 px-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300"
                                            data-testid={`button-apply-last-price-${idx}-${hi}`}
                                            onClick={() => {
                                              updateLine(idx, "unitPrice", lp.lastUnitPrice);
                                              if (parseFloat(lp.lastDiscountPercent) > 0) {
                                                updateLine(idx, "discountPercent", lp.lastDiscountPercent);
                                              } else if (parseFloat(lp.lastDiscountAmount) > 0) {
                                                updateLine(idx, "discount", lp.lastDiscountAmount);
                                              } else {
                                                updateLine(idx, "discountPercent", "0");
                                              }
                                              setManualDiscountLines(prev => { const next = new Set(prev); next.delete(idx); return next; });
                                            }}
                                          >Apply</Button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground shrink-0">Qty</span>
                                <Input
                                  type="number"
                                  min="0.001"
                                  step="any"
                                  className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={line.quantity > 0 ? line.quantity : ""}
                                  onChange={(e) => { const v = parseFloat(e.target.value); updateLine(idx, "quantity", isNaN(v) || v <= 0 ? 0.001 : v); }}
                                  onFocus={(e) => e.target.select()}
                                  onBlur={() => { if (!line.quantity || line.quantity <= 0) updateLine(idx, "quantity", 1); }}
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
                                    <SelectItem value="kg">kg</SelectItem>
                                    <SelectItem value="lt">lt</SelectItem>
                                    <SelectItem value="gr">gr</SelectItem>
                                    <SelectItem value="ml">ml</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1">
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={line.unitPrice}
                                onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "unitPrice", v); }}
                                disabled={isViewMode}
                                data-testid={`input-line-price-${idx}`}
                              />
                              {line.itemId && !isViewMode && (
                                <ItemPriceHistoryPopover
                                  itemId={line.itemId}
                                  itemName={line.description || items.find(i => i.id === line.itemId)?.name || ""}
                                />
                              )}
                            </div>
                            {line.itemId && customerId && (() => {
                              const _item = items.find(i => i.id === line.itemId);
                              if (!_item) return null;
                              const _disc = findContractDiscount(customerId, _item, line.quantity);
                              if (_disc?.type !== "fixed_price" || _disc.source !== "invoice-discount") return null;
                              return (
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                        onClick={() => navigate(`/pricing?tab=auto-saved`)}
                                        data-testid={`badge-fixed-price-${idx}`}
                                      >
                                        <Lock className="w-3 h-3" />
                                        Fixed price
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Fixed price from contract</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            })()}
                          </div>
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
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "" || /^\d*\.?\d*$/.test(v)) {
                                      updateLine(idx, "discountPercent", v || "0");
                                      setManualDiscountLines(prev => new Set(prev).add(idx));
                                    }
                                  }}
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
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "" || /^\d*\.?\d*$/.test(v)) {
                                      updateLine(idx, "discount", v || "0");
                                      setManualDiscountLines(prev => new Set(prev).add(idx));
                                    }
                                  }}
                                  className="pr-6 h-8 text-sm"
                                  data-testid={`input-line-disc-amt-${idx}`}
                                />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{"\u20AC"}</span>
                              </div>
                              {line.itemId && customerId && manualDiscountLines.has(idx) && parseFloat(line.discount) > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-full px-1.5 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                                  data-testid={`button-save-contract-price-${idx}`}
                                  disabled={quickSaveMutation.isPending}
                                  onClick={() => {
                                    const qty = line.quantity || 1;
                                    const effPrice = (parseFloat(line.unitPrice) * qty - parseFloat(line.discount)) / qty;
                                    quickSaveMutation.mutate({ custId: customerId, itemId: line.itemId, fixedPrice: Math.max(0, effPrice) });
                                  }}
                                >
                                  {quickSaveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : "💾 "}Save price to contract
                                </Button>
                              )}
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
                            <Select value={line.itemId || "custom"} onValueChange={(v) => {
                              updateLine(idx, "itemId", v === "custom" ? "" : v);
                              setManualDiscountLines(prev => { const next = new Set(prev); next.delete(idx); return next; });
                            }}>
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
                            {line.itemId && lastPricesData[line.itemId]?.length > 0 && (
                              <div className="space-y-0.5">
                                {lastPricesData[line.itemId].map((lp, hi) => {
                                  const lpDisc = parseFloat(lp.lastDiscountPercent) || 0;
                                  const lpDate = lp.invoiceDate ? new Date(lp.invoiceDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "";
                                  return (
                                    <div key={hi} className="flex items-center gap-1 flex-wrap">
                                      <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 leading-tight">
                                        {hi === 0 ? "💡" : "  "} €{parseFloat(lp.lastUnitPrice).toFixed(2)}{lpDisc > 0 ? ` −${lpDisc.toFixed(1)}%` : ""}{lpDate ? ` · ${lpDate}` : ""}
                                      </span>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-5 px-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300"
                                        onClick={() => {
                                          updateLine(idx, "unitPrice", lp.lastUnitPrice);
                                          if (parseFloat(lp.lastDiscountPercent) > 0) {
                                            updateLine(idx, "discountPercent", lp.lastDiscountPercent);
                                          } else if (parseFloat(lp.lastDiscountAmount) > 0) {
                                            updateLine(idx, "discount", lp.lastDiscountAmount);
                                          } else {
                                            updateLine(idx, "discountPercent", "0");
                                          }
                                          setManualDiscountLines(prev => { const next = new Set(prev); next.delete(idx); return next; });
                                        }}
                                      >Apply</Button>
                                    </div>
                                  );
                                })}
                              </div>
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
                          min="0.001"
                          step="any"
                          className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          style={{ color: 'hsl(var(--foreground))', WebkitTextFillColor: 'hsl(var(--foreground))' }}
                          value={line.quantity > 0 ? line.quantity : ""}
                          onChange={(e) => { const v = parseFloat(e.target.value); updateLine(idx, "quantity", isNaN(v) || v <= 0 ? 0.001 : v); }}
                          onFocus={(e) => e.target.select()}
                          onBlur={() => { if (!line.quantity || line.quantity <= 0) updateLine(idx, "quantity", 1); }}
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
                              <SelectItem value="kg">kg</SelectItem>
                              <SelectItem value="lt">lt</SelectItem>
                              <SelectItem value="gr">gr</SelectItem>
                              <SelectItem value="ml">ml</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs text-muted-foreground">Unit Price</Label>
                        <div className="flex items-center gap-1">
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={line.unitPrice}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) updateLine(idx, "unitPrice", v); }}
                            disabled={isViewMode}
                          />
                          {line.itemId && !isViewMode && (
                            <ItemPriceHistoryPopover
                              itemId={line.itemId}
                              itemName={line.description || items.find(i => i.id === line.itemId)?.name || ""}
                            />
                          )}
                        </div>
                        {line.itemId && customerId && (() => {
                          const _item = items.find(i => i.id === line.itemId);
                          if (!_item) return null;
                          const _disc = findContractDiscount(customerId, _item, line.quantity);
                          if (_disc?.type !== "fixed_price" || _disc.source !== "invoice-discount") return null;
                          return (
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                                    onClick={() => navigate(`/pricing?tab=auto-saved`)}
                                    data-testid={`badge-fixed-price-mobile-${idx}`}
                                  >
                                    <Lock className="w-3 h-3" />
                                    Fixed price
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Fixed price from contract</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
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
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) { updateLine(idx, "discountPercent", v || "0"); setManualDiscountLines(prev => new Set(prev).add(idx)); } }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Disc {"\u20AC"}</Label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={line.discount === "0" || line.discount === "0.00" ? "" : line.discount}
                            onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) { updateLine(idx, "discount", v || "0"); setManualDiscountLines(prev => new Set(prev).add(idx)); } }}
                          />
                        </div>
                      </div>
                    )}

                    {!isViewMode && line.itemId && customerId && manualDiscountLines.has(idx) && parseFloat(line.discount) > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 w-full px-1.5 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                        disabled={quickSaveMutation.isPending}
                        onClick={() => {
                          const qty = line.quantity || 1;
                          const effPrice = (parseFloat(line.unitPrice) * qty - parseFloat(line.discount)) / qty;
                          quickSaveMutation.mutate({ custId: customerId, itemId: line.itemId, fixedPrice: Math.max(0, effPrice) });
                        }}
                      >
                        {quickSaveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : "💾 "}Save price to contract
                      </Button>
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
                      {(customer as any).location && <p className="text-xs font-medium text-foreground">{(customer as any).location}</p>}
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
