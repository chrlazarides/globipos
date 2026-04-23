import { useState, Fragment, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Download, FileText, Users, Printer, Eye, Send, Loader2, ChevronDown, ChevronRight, BarChart2, Package, Search, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, BadgePercent, FileSpreadsheet, Mail, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip, Legend, ResponsiveContainer, Cell, AreaChart, Area } from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import type { Customer, Invoice, Category, EmailLog } from "@shared/schema";

export default function Reports() {
  const { toast } = useToast();
  const [location] = useLocation();
  const defaultTab = useMemo(() => {
    const params = new URLSearchParams(location.includes("?") ? location.split("?")[1] : "");
    return params.get("tab") || "sales";
  }, []);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expandedStatement, setExpandedStatement] = useState<string | null>(null);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [showAgingColumns, setShowAgingColumns] = useState(false);
  const [expandedDetail, setExpandedDetail] = useState<string | null>(null);

  const [selectedCustomer, setSelectedCustomer] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [itemSortBy, setItemSortBy] = useState<"revenue" | "profit" | "marginPct" | "qtySold">("revenue");
  const [itemSearch, setItemSearch] = useState("");
  const [itemMinMargin, setItemMinMargin] = useState("");

  const [savingsCustomer, setSavingsCustomer] = useState<string>("");
  const [savingsPreset, setSavingsPreset] = useState<string>(() => localStorage.getItem("savingsDatePreset") ?? "12");
  const [savingsFrom, setSavingsFrom] = useState(() => {
    const saved = localStorage.getItem("savingsDatePreset");
    const d = new Date();
    if (saved === "this-year") {
      return `${d.getFullYear()}-01-01`;
    }
    const months = parseInt(saved ?? "12", 10);
    if (!isNaN(months)) {
      d.setMonth(d.getMonth() - months);
    } else {
      d.setMonth(d.getMonth() - 12);
    }
    return d.toISOString().split("T")[0];
  });
  const [savingsTo, setSavingsTo] = useState(new Date().toISOString().split("T")[0]);
  const [savingsFromOpen, setSavingsFromOpen] = useState(false);
  const [savingsToOpen, setSavingsToOpen] = useState(false);
  const [expandedSavingsInvoice, setExpandedSavingsInvoice] = useState<string | null>(null);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [previewEmailOverride, setPreviewEmailOverride] = useState("");

  const sendSavingsEmailMutation = useMutation({
    mutationFn: (emailOverride?: string) => apiRequest("POST", `/api/reports/savings/${savingsCustomer}/${savingsFrom}/${savingsTo}/email`, emailOverride ? { email: emailOverride } : undefined),
    onSuccess: () => {
      setShowEmailPreview(false);
      queryClient.invalidateQueries({ queryKey: ["/api/email-logs/customer", savingsCustomer] });
      toast({ title: "Report sent", description: "The savings report has been emailed to the customer." });
    },
    onError: (err: unknown) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-logs/customer", savingsCustomer] });
      const message = err instanceof Error ? err.message : "Could not send the email.";
      toast({ title: "Failed to send", description: message, variant: "destructive" });
    },
  });

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: categoryList = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });

  type ItemRow = {
    itemId: string; itemName: string; sku: string; categoryId: string | null;
    categoryName: string; qtySold: number; revenue: number; cost: number;
    profit: number; marginPct: number; invoiceCount: number; avgUnitPrice: number;
    monthly: { month: string; qty: number; revenue: number; profit: number }[];
  };
  const { data: itemReport, isLoading: itemLoading } = useQuery<{
    items: ItemRow[];
    totalRevenue: string; totalCost: string; totalProfit: string;
    overallMargin: string; totalQty: number; uniqueItemCount: number;
  }>({ queryKey: ["/api/reports/items", dateFrom, dateTo, selectedCustomer, selectedCategory] });

  const { data: salesReport, isLoading: salesLoading } = useQuery<{
    invoices: (Invoice & { customerName: string; costTotal: string; profit: string; marginPct: string })[];
    totalRevenue: string;
    totalSales: string;
    totalTax: string;
    totalCost: string;
    totalProfit: string;
    overallMargin: string;
    invoiceCount: number;
    customerProfits: { customerId: string; customerName: string; revenue: string; cost: string; profit: string; marginPct: string; invoiceCount: number }[];
  }>({
    queryKey: ["/api/reports/sales", dateFrom, dateTo, selectedCustomer],
  });
  // Note: query key joins to /api/reports/sales/from/to/customerId which matches server route

  const { data: customerStatements = [] } = useQuery<{
    customerId: string;
    customerName: string;
    paymentTerms: string;
    totalInvoiced: string;
    totalPaid: string;
    totalCredits: string;
    balance: string;
    balanceAsOfPrevMonthEnd: string;
    prevMonthEndLabel: string;
    dueByEndOfMonth: string;
    dueByEomCurrentMonth: string;
    dueByEomPrevMonth: string;
    totalOverdue: string;
    invoiceCount: number;
    invoices: {
      invoiceNumber: string;
      date: string;
      type: string;
      status: string;
      dueDate: string | null;
      effectiveDueDate: string | null;
      total: string;
      paid: string;
      balance: string;
      daysOverdue: number | null;
    }[];
    payments: {
      date: string;
      amount: string;
      paymentMethod: string;
      reference: string | null;
      notes: string | null;
      invoiceNumber: string | null;
    }[];
    aging: {
      withinTermsFuture: string;
      dueThisMonth: string;
      overdue1_30: string;
      overdue31_60: string;
      overdue60plus: string;
    };
  }[]>({
    queryKey: ["/api/reports/statements"],
  });

  type SavingsInvoiceRow = {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalSavings: number;
    invoiceTotal: number;
    lines: { itemName: string; qty: number; unitPrice: number; discountPercent: number; discountAmount: number; savings: number }[];
  };
  type SavingsReport = {
    customerId: string;
    customerName: string;
    totalSavings: number;
    avgDiscountPercent: number;
    invoiceCount: number;
    bestDeal: number;
    savedVsCatalogue: number;
    monthly: { month: string; savings: number; invoiceCount: number }[];
    invoices: SavingsInvoiceRow[];
  };
  const { data: savingsReport, isLoading: savingsLoading } = useQuery<SavingsReport>({
    queryKey: ["/api/reports/savings", savingsCustomer, savingsFrom, savingsTo],
    enabled: !!savingsCustomer,
  });

  const { data: savingsEmailLogs = [] } = useQuery<EmailLog[]>({
    queryKey: ["/api/email-logs/customer", savingsCustomer],
    enabled: !!savingsCustomer,
    select: (logs) => logs.filter(l => l.subject.includes("Savings Report")),
  });

  const previewStatement = (customerId: string) => {
    window.open(`/api/reports/statement/${customerId}/pdf?t=${Date.now()}`, "_blank");
  };

  const printStatement = (customerId: string) => {
    window.open(`/api/reports/statement/${customerId}/pdf?print=1&t=${Date.now()}`, "_blank");
  };

  const downloadStatement = async (customerId: string) => {
    try {
      const res = await fetch(`/api/reports/statement/${customerId}/pdf?download=1`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement-${customerId}.html`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {}
  };

  const sendStatementEmail = async (customerId: string) => {
    setSendingId(customerId);
    try {
      const res = await apiRequest("POST", `/api/reports/statement/${customerId}/send-email`);
      const data = await res.json();
      toast({ title: "Email Sent", description: data.message });
    } catch (e: any) {
      toast({ title: "Email Failed", description: e.message || "Failed to send statement email", variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Reports & Statements" description="View sales reports and customer account statements" />

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="sales" data-testid="tab-sales-report">
            <BarChart3 className="w-4 h-4 mr-1" /> Sales Report
          </TabsTrigger>
          <TabsTrigger value="items" data-testid="tab-item-sales">
            <Package className="w-4 h-4 mr-1" /> Item Performance
          </TabsTrigger>
          <TabsTrigger value="savings" data-testid="tab-savings-report">
            <BadgePercent className="w-4 h-4 mr-1" /> Customer Savings
          </TabsTrigger>
          <TabsTrigger value="statements" data-testid="tab-statements">
            <Users className="w-4 h-4 mr-1" /> Statements
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="input-date-from" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="input-date-to" />
                </div>
                <div>
                  <Label className="text-xs">Customer</Label>
                  <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                    <SelectTrigger className="w-[200px]" data-testid="select-report-customer">
                      <SelectValue placeholder="All Customers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Customers</SelectItem>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {salesLoading ? (
            <Skeleton className="h-64" />
          ) : salesReport ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Revenue (Ex-VAT)</p>
                    <p className="text-xl font-bold mt-1" data-testid="stat-total-revenue">
                      €{parseFloat(salesReport.totalRevenue).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">After discounts, excl. tax</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Incl. VAT</p>
                    <p className="text-xl font-bold mt-1" data-testid="stat-total-sales">
                      €{parseFloat(salesReport.totalSales).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">VAT: €{parseFloat(salesReport.totalTax).toLocaleString("el-CY", { minimumFractionDigits: 2 })}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Cost</p>
                    <p className="text-xl font-bold mt-1" data-testid="stat-total-cost">
                      €{parseFloat(salesReport.totalCost).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Gross Profit</p>
                    <p className={`text-xl font-bold mt-1 ${parseFloat(salesReport.totalProfit) >= 0 ? "text-green-600" : "text-red-500"}`} data-testid="stat-total-profit">
                      €{parseFloat(salesReport.totalProfit).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">On ex-VAT revenue</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Margin</p>
                    <p className={`text-xl font-bold mt-1 ${parseFloat(salesReport.overallMargin) >= 0 ? "text-green-600" : "text-red-500"}`} data-testid="stat-overall-margin">
                      {salesReport.overallMargin}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Profit / Revenue</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Invoices</p>
                    <p className="text-xl font-bold mt-1">{salesReport.invoiceCount}</p>
                  </CardContent>
                </Card>
              </div>

              {salesReport.customerProfits.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Profit Margin by Customer</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Click a row to see individual invoices</p>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-center">Invoices</TableHead>
                          <TableHead className="text-right">Revenue (Ex-VAT)</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Profit</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesReport.customerProfits.map((cp) => {
                          const isExpanded = expandedCustomer === cp.customerId;
                          const custInvoices = salesReport.invoices.filter(inv => inv.customerId === cp.customerId);
                          return (
                            <Fragment key={cp.customerId}>
                              <TableRow
                                className="cursor-pointer select-none hover:bg-muted/40"
                                onClick={() => setExpandedCustomer(isExpanded ? null : cp.customerId)}
                                data-testid={`row-customer-profit-${cp.customerId}`}
                              >
                                <TableCell className="pr-0 pl-3">
                                  {isExpanded
                                    ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                </TableCell>
                                <TableCell className="font-medium text-sm">{cp.customerName}</TableCell>
                                <TableCell className="text-center text-sm">{cp.invoiceCount}</TableCell>
                                <TableCell className="text-right text-sm">€{parseFloat(cp.revenue).toLocaleString("el-CY", { minimumFractionDigits: 2 })}</TableCell>
                                <TableCell className="text-right text-sm">€{parseFloat(cp.cost).toLocaleString("el-CY", { minimumFractionDigits: 2 })}</TableCell>
                                <TableCell className={`text-right text-sm font-medium ${parseFloat(cp.profit) >= 0 ? "text-green-600" : "text-red-500"}`}>
                                  €{parseFloat(cp.profit).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-right text-sm">
                                  <Badge variant={parseFloat(cp.marginPct) >= 20 ? "default" : parseFloat(cp.marginPct) >= 0 ? "secondary" : "destructive"} data-testid={`badge-margin-${cp.customerId}`}>
                                    {cp.marginPct}%
                                  </Badge>
                                </TableCell>
                              </TableRow>

                              {isExpanded && (
                                <TableRow className="bg-muted/20 dark:bg-muted/10 hover:bg-muted/20">
                                  <TableCell colSpan={7} className="p-0">
                                    <div className="mx-6 my-2 rounded-lg border border-border overflow-hidden text-xs">
                                      <table className="w-full border-collapse">
                                        <thead>
                                          <tr className="bg-muted/60 dark:bg-muted/30 text-muted-foreground">
                                            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Invoice</th>
                                            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Date</th>
                                            <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Status</th>
                                            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Total (incl. VAT)</th>
                                            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Revenue (Ex-VAT)</th>
                                            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Cost</th>
                                            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Profit</th>
                                            <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Margin</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {custInvoices.length === 0 ? (
                                            <tr>
                                              <td colSpan={8} className="px-3 py-3 text-center text-muted-foreground">No invoices in this period</td>
                                            </tr>
                                          ) : custInvoices.map((inv, i) => {
                                            const exVatRev = parseFloat(inv.subtotal) - parseFloat(inv.discountAmount || "0");
                                            return (
                                              <tr key={inv.id} className={`border-t border-border/50 hover:bg-muted/20 ${i % 2 === 1 ? "bg-muted/5" : ""}`}>
                                                <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                                                <td className="px-3 py-2 text-muted-foreground">{formatDate(inv.date)}</td>
                                                <td className="px-3 py-2">
                                                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    inv.status === "paid" ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                                                    : inv.status === "overdue" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                                    : "bg-muted text-muted-foreground"
                                                  }`}>
                                                    {inv.status}
                                                  </span>
                                                </td>
                                                <td className="px-3 py-2 text-right font-medium">€{parseFloat(inv.total).toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right">€{exVatRev.toFixed(2)}</td>
                                                <td className="px-3 py-2 text-right">€{parseFloat(inv.costTotal).toFixed(2)}</td>
                                                <td className={`px-3 py-2 text-right font-semibold ${parseFloat(inv.profit) >= 0 ? "text-green-600" : "text-red-500"}`}>
                                                  €{parseFloat(inv.profit).toFixed(2)}
                                                </td>
                                                <td className="px-3 py-2 text-right">{inv.marginPct}%</td>
                                              </tr>
                                            );
                                          })}
                                          {custInvoices.length > 0 && (
                                            <tr className="border-t-2 border-border bg-muted/40 dark:bg-muted/20 font-semibold">
                                              <td className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground" colSpan={3}>Total</td>
                                              <td className="px-3 py-2 text-right">€{custInvoices.reduce((s, i) => s + parseFloat(i.total), 0).toFixed(2)}</td>
                                              <td className="px-3 py-2 text-right">€{parseFloat(cp.revenue).toFixed(2)}</td>
                                              <td className="px-3 py-2 text-right">€{parseFloat(cp.cost).toFixed(2)}</td>
                                              <td className={`px-3 py-2 text-right ${parseFloat(cp.profit) >= 0 ? "text-green-600" : "text-red-500"}`}>€{parseFloat(cp.profit).toFixed(2)}</td>
                                              <td className="px-3 py-2 text-right">{cp.marginPct}%</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total (incl. VAT)</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesReport.invoices.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No invoices in this period</TableCell>
                        </TableRow>
                      ) : (
                        salesReport.invoices.map((inv) => (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium text-sm">{inv.invoiceNumber}</TableCell>
                            <TableCell className="text-sm">{inv.customerName}</TableCell>
                            <TableCell className="text-sm">{formatDate(inv.date)}</TableCell>
                            <TableCell>
                              <Badge variant={inv.status === "paid" ? "default" : inv.status === "overdue" ? "destructive" : "secondary"}>
                                {inv.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-sm">€{parseFloat(inv.total).toFixed(2)}</TableCell>
                            <TableCell className="text-right text-sm">€{parseFloat(inv.costTotal).toFixed(2)}</TableCell>
                            <TableCell className={`text-right text-sm font-medium ${parseFloat(inv.profit) >= 0 ? "text-green-600" : "text-red-500"}`}>
                              €{parseFloat(inv.profit).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-sm">{inv.marginPct}%</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="items" className="mt-4 space-y-4">
          {/* ── Filter bar ── */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-item-date-from" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-item-date-to" />
                </div>
                <div>
                  <Label className="text-xs">Customer</Label>
                  <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                    <SelectTrigger className="w-[180px]" data-testid="select-item-customer"><SelectValue placeholder="All Customers" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Customers</SelectItem>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Category</Label>
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-[155px]" data-testid="select-item-category"><SelectValue placeholder="All Categories" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categoryList.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sort By</Label>
                  <Select value={itemSortBy} onValueChange={v => setItemSortBy(v as "revenue" | "profit" | "marginPct" | "qtySold")}>
                    <SelectTrigger className="w-[130px]" data-testid="select-item-sort"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="revenue">Revenue</SelectItem>
                      <SelectItem value="profit">Profit</SelectItem>
                      <SelectItem value="marginPct">Margin %</SelectItem>
                      <SelectItem value="qtySold">Units Sold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Min Margin %</Label>
                  <Input type="number" placeholder="e.g. 20" value={itemMinMargin} onChange={e => setItemMinMargin(e.target.value)} className="w-24" data-testid="input-item-min-margin" />
                </div>
                <div>
                  <Label className="text-xs">Search</Label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Name or SKU…" value={itemSearch} onChange={e => setItemSearch(e.target.value)} className="pl-8 w-44" data-testid="input-item-search" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Results ── */}
          {itemLoading ? <Skeleton className="h-64" /> : itemReport ? (() => {
            const minM = itemMinMargin !== "" ? parseFloat(itemMinMargin) : -Infinity;
            const srch = itemSearch.toLowerCase();
            const displayItems = (itemReport.items ?? [])
              .filter(r =>
                (srch ? r.itemName.toLowerCase().includes(srch) || r.sku.toLowerCase().includes(srch) : true)
                && r.marginPct >= minM
              )
              .sort((a, b) => (b[itemSortBy] as number) - (a[itemSortBy] as number));

            const chartData = [...displayItems]
              .sort((a, b) => b.revenue - a.revenue).slice(0, 12)
              .map(r => ({
                name: r.itemName.length > 22 ? r.itemName.substring(0, 21) + "…" : r.itemName,
                revenue: r.revenue, profit: r.profit > 0 ? r.profit : 0, loss: r.profit < 0 ? Math.abs(r.profit) : 0, margin: r.marginPct,
              })).reverse();

            const MarginBadge = ({ m }: { m: number }) => {
              if (m >= 35) return <span className="flex items-center gap-0.5 text-green-600 font-semibold text-xs" title="Excellent margin"><TrendingUp className="w-3.5 h-3.5" />{m.toFixed(1)}%</span>;
              if (m >= 20) return <span className="flex items-center gap-0.5 text-green-500 text-xs" title="Good margin"><ArrowUp className="w-3.5 h-3.5" />{m.toFixed(1)}%</span>;
              if (m >= 10) return <span className="flex items-center gap-0.5 text-amber-500 text-xs" title="Marginal"><Minus className="w-3.5 h-3.5" />{m.toFixed(1)}%</span>;
              if (m >= 0) return <span className="flex items-center gap-0.5 text-orange-500 text-xs" title="Poor margin"><ArrowDown className="w-3.5 h-3.5" />{m.toFixed(1)}%</span>;
              return <span className="flex items-center gap-0.5 text-red-600 font-semibold text-xs" title="Negative margin"><TrendingDown className="w-3.5 h-3.5" />{m.toFixed(1)}%</span>;
            };

            const exportCsv = () => {
              const headers = ["Item Name","SKU","Category","Qty Sold","Revenue €","Cost €","Profit €","Margin %","Invoices","Avg Price €"];
              const rows = displayItems.map(r => [r.itemName, r.sku, r.categoryName, r.qtySold, r.revenue, r.cost, r.profit, r.marginPct, r.invoiceCount, r.avgUnitPrice]);
              const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `item-performance-${dateFrom}-${dateTo}.csv`; a.click();
              URL.revokeObjectURL(url);
            };

            const fmt = (n: number) => n.toLocaleString("el-CY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                  <Card><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Revenue (Ex-VAT)</p>
                    <p className="text-xl font-bold mt-1" data-testid="item-stat-revenue">€{fmt(parseFloat(itemReport.totalRevenue))}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Cost</p>
                    <p className="text-xl font-bold mt-1" data-testid="item-stat-cost">€{fmt(parseFloat(itemReport.totalCost))}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Gross Profit</p>
                    <p className={`text-xl font-bold mt-1 ${parseFloat(itemReport.totalProfit) >= 0 ? "text-green-600" : "text-red-500"}`} data-testid="item-stat-profit">
                      €{fmt(parseFloat(itemReport.totalProfit))}
                    </p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg Margin</p>
                    <p className={`text-xl font-bold mt-1 ${parseFloat(itemReport.overallMargin) >= 20 ? "text-green-600" : parseFloat(itemReport.overallMargin) >= 0 ? "text-amber-500" : "text-red-500"}`} data-testid="item-stat-margin">
                      {itemReport.overallMargin}%
                    </p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Units Sold</p>
                    <p className="text-xl font-bold mt-1" data-testid="item-stat-qty">{itemReport.totalQty.toLocaleString()}</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Unique Items</p>
                    <p className="text-xl font-bold mt-1" data-testid="item-stat-unique">{displayItems.length}</p>
                    {displayItems.length !== itemReport.uniqueItemCount && <p className="text-xs text-muted-foreground mt-0.5">of {itemReport.uniqueItemCount} total</p>}
                  </CardContent></Card>
                </div>

                {/* Chart */}
                {chartData.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <BarChart2 className="w-4 h-4 text-indigo-500" />
                        Top {chartData.length} Items — Revenue vs Profit &amp; Margin %
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 38)}>
                        <ComposedChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 180 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                          <XAxis type="number" tickFormatter={v => `€${(v/1000).toFixed(1)}k`} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} width={175} axisLine={false} tickLine={false} />
                          <RechartTooltip
                            formatter={(value: number, name: string) => {
                              if (name === "margin") return [`${value.toFixed(1)}%`, "Margin %"];
                              return [`€${fmt(value)}`, name === "revenue" ? "Revenue" : name === "profit" ? "Profit" : "Loss"];
                            }}
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                          />
                          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="revenue" name="Revenue" fill="#6366f1" opacity={0.75} radius={[0, 3, 3, 0]} barSize={12} />
                          <Bar dataKey="profit" name="Profit" fill="#10b981" opacity={0.85} radius={[0, 3, 3, 0]} barSize={12} />
                          <Bar dataKey="loss" name="Loss" fill="#ef4444" opacity={0.7} radius={[0, 3, 3, 0]} barSize={12} />
                          <Line type="monotone" dataKey="margin" name="margin" yAxisId={0} stroke="#f59e0b" strokeWidth={0} dot={{ r: 5, fill: "#f59e0b", stroke: "white", strokeWidth: 1.5 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2 px-1">
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block bg-indigo-400 opacity-75" />Revenue</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block bg-emerald-500" />Profit</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block bg-red-400" />Loss</span>
                        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block bg-amber-400" />Margin % (dot)</span>
                        <span className="ml-auto flex items-center gap-3">
                          <span className="flex items-center gap-0.5 text-green-600"><TrendingUp className="w-3 h-3" />≥35% Excellent</span>
                          <span className="flex items-center gap-0.5 text-green-500"><ArrowUp className="w-3 h-3" />20–35% Good</span>
                          <span className="flex items-center gap-0.5 text-amber-500"><Minus className="w-3 h-3" />10–20% Marginal</span>
                          <span className="flex items-center gap-0.5 text-orange-500"><ArrowDown className="w-3 h-3" />0–10% Poor</span>
                          <span className="flex items-center gap-0.5 text-red-600"><TrendingDown className="w-3 h-3" />&lt;0% Loss</span>
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Table */}
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-semibold">
                      Item Breakdown <span className="text-muted-foreground font-normal">({displayItems.length} items)</span>
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={exportCsv} data-testid="button-export-items-csv">
                      <Download className="w-3.5 h-3.5 mr-1" /> CSV
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead className="pl-4">#</TableHead>
                          <TableHead>Item Name</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Qty Sold</TableHead>
                          <TableHead className="text-right">Avg Price</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Profit</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                          <TableHead className="text-right pr-4">Invoices</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayItems.length === 0 ? (
                          <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No items found for the selected period and filters.</TableCell></TableRow>
                        ) : displayItems.map((r, idx) => {
                          const rowClass = r.marginPct >= 20 ? "bg-green-50/30 dark:bg-green-950/10" : r.marginPct < 0 ? "bg-red-50/40 dark:bg-red-950/10" : "";
                          const profitPct = itemReport.totalRevenue !== "0.00" ? (r.revenue / parseFloat(itemReport.totalRevenue) * 100).toFixed(1) : "0.0";
                          return (
                            <TableRow key={r.itemId} className={`text-xs ${rowClass} hover:bg-muted/40`} data-testid={`row-item-${r.itemId}`}>
                              <TableCell className="pl-4 text-muted-foreground">{idx + 1}</TableCell>
                              <TableCell className="font-medium max-w-[200px]">
                                <span title={r.itemName}>{r.itemName.length > 30 ? r.itemName.substring(0, 28) + "…" : r.itemName}</span>
                              </TableCell>
                              <TableCell className="text-muted-foreground font-mono text-[11px]">{r.sku}</TableCell>
                              <TableCell>
                                {r.categoryName !== "Uncategorized" ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{r.categoryName}</Badge> : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right font-medium">{r.qtySold.toLocaleString()}</TableCell>
                              <TableCell className="text-right text-muted-foreground">€{fmt(r.avgUnitPrice)}</TableCell>
                              <TableCell className="text-right font-semibold">
                                <div>€{fmt(r.revenue)}</div>
                                <div className="text-[10px] text-muted-foreground">{profitPct}% of total</div>
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">€{fmt(r.cost)}</TableCell>
                              <TableCell className={`text-right font-semibold ${r.profit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
                                €{fmt(r.profit)}
                              </TableCell>
                              <TableCell className="text-right"><MarginBadge m={r.marginPct} /></TableCell>
                              <TableCell className="text-right pr-4 text-muted-foreground">{r.invoiceCount}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {displayItems.length > 0 && (
                      <div className="flex justify-end gap-8 p-3 border-t text-xs font-semibold bg-muted/20">
                        <span>Revenue: €{fmt(displayItems.reduce((s,r)=>s+r.revenue,0))}</span>
                        <span>Cost: €{fmt(displayItems.reduce((s,r)=>s+r.cost,0))}</span>
                        <span className={displayItems.reduce((s,r)=>s+r.profit,0)>=0?"text-green-700":"text-red-600"}>
                          Profit: €{fmt(displayItems.reduce((s,r)=>s+r.profit,0))}
                        </span>
                        <span>Units: {displayItems.reduce((s,r)=>s+r.qtySold,0).toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })() : <div className="text-center py-12 text-muted-foreground text-sm">No data for the selected period.</div>}
        </TabsContent>

        <TabsContent value="statements" className="mt-4 space-y-4">
          {(() => {
            const termLabel = (t: string) => {
              if (t === "credit_30") return "Net 30";
              if (t === "credit_60") return "Net 60";
              if (t === "credit_90") return "Net 90";
              return "Cash";
            };
            const methodLabels: Record<string, string> = {
              cash: "Cash", bank_transfer: "Bank Transfer", cheque: "Cheque", card: "Card", other: "Other",
            };
            const methodColors: Record<string, string> = {
              cash: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
              bank_transfer: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
              cheque: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
              card: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
              other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
            };
            const endOfMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
            const currentMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
            const prevMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

            const getInvStatus = (daysOverdue: number | null) => {
              if (daysOverdue === null) return null;
              if (daysOverdue <= 0) {
                return { label: "Within Terms", color: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300", overdue: false };
              }
              return {
                label: `Overdue ${daysOverdue}d`,
                color: daysOverdue <= 30 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  : daysOverdue <= 60 ? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                  : "bg-rose-200 text-rose-900 dark:bg-rose-950/60 dark:text-rose-300 font-bold",
                overdue: true,
              };
            };

            const colCount = showAgingColumns ? 10 : 6;
            return (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {customerStatements.length} customer{customerStatements.length !== 1 ? "s" : ""}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAgingColumns(!showAgingColumns)}
                    className={`gap-1.5 text-xs h-7 ${showAgingColumns ? "bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-950/30 dark:border-violet-800 dark:text-violet-400" : ""}`}
                    data-testid="button-toggle-aging"
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                    {showAgingColumns ? "Hide aging" : "Aging analysis"}
                  </Button>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-center">Terms</TableHead>
                        <TableHead className="text-right">Balance Due</TableHead>
                        <TableHead className="text-right text-amber-600 dark:text-amber-400">Due by {endOfMonthLabel}</TableHead>
                        {showAgingColumns && <>
                          <TableHead className="text-right text-teal-600 dark:text-teal-400">Within Terms</TableHead>
                          <TableHead className="text-right text-amber-600 dark:text-amber-400">Overdue 1–30d</TableHead>
                          <TableHead className="text-right text-orange-600 dark:text-orange-400">Overdue 31–60d</TableHead>
                          <TableHead className="text-right text-rose-700 dark:text-rose-500">Overdue 60+d</TableHead>
                        </>}
                        <TableHead className="w-[160px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerStatements.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">No data available</TableCell>
                        </TableRow>
                      ) : (
                        customerStatements.map((st) => {
                          const ag = st.aging || { withinTermsFuture: "0", dueThisMonth: "0", overdue1_30: "0", overdue31_60: "0", overdue60plus: "0" };
                          const hasOverdue = parseFloat(st.totalOverdue || "0") > 0;
                          const isExpanded = expandedStatement === st.customerId;
                          const stInvoices = st.invoices || [];
                          const stPayments = st.payments || [];

                          return (
                            <Fragment key={st.customerId}>
                              <TableRow
                                className={`cursor-pointer select-none ${hasOverdue ? "bg-red-50/30 dark:bg-red-950/10" : ""} hover:bg-muted/40`}
                                onClick={() => setExpandedStatement(isExpanded ? null : st.customerId)}
                                data-testid={`row-statement-${st.customerId}`}
                              >
                                <TableCell className="pr-0">
                                  {isExpanded
                                    ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                </TableCell>
                                <TableCell className="font-medium text-sm">{st.customerName}</TableCell>
                                <TableCell className="text-center">
                                  <span className="text-xs text-muted-foreground font-medium">{termLabel(st.paymentTerms)}</span>
                                </TableCell>
                                <TableCell className={`text-right font-semibold text-sm ${parseFloat(st.balance) > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`text-balance-${st.customerId}`}>
                                  {parseFloat(st.balance) > 0 ? `€${parseFloat(st.balance).toFixed(2)}` : <span className="text-muted-foreground font-normal">—</span>}
                                </TableCell>
                                <TableCell className="text-right text-sm" data-testid={`text-due-eom-${st.customerId}`}>
                                  {(() => {
                                    const cur = parseFloat(st.dueByEomCurrentMonth || "0");
                                    const prev = parseFloat(st.dueByEomPrevMonth || "0");
                                    if (cur <= 0 && prev <= 0) return <span className="text-muted-foreground font-normal">—</span>;
                                    return (
                                      <div className="flex flex-col items-end gap-0.5">
                                        {cur > 0 && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-muted-foreground font-normal">{currentMonthLabel}</span>
                                            <span className="font-semibold text-amber-700 dark:text-amber-400">€{cur.toFixed(2)}</span>
                                          </div>
                                        )}
                                        {prev > 0 && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-muted-foreground font-normal">{prevMonthLabel}</span>
                                            <span className="font-semibold text-orange-700 dark:text-orange-400">€{prev.toFixed(2)}</span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </TableCell>
                                {showAgingColumns && <>
                                  <TableCell className="text-right text-sm text-teal-600 dark:text-teal-400" data-testid={`text-within-terms-${st.customerId}`}>
                                    {parseFloat(ag.withinTermsFuture) > 0 ? `€${parseFloat(ag.withinTermsFuture).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell className="text-right text-sm text-amber-600 dark:text-amber-400" data-testid={`text-overdue-1-30-${st.customerId}`}>
                                    {parseFloat(ag.overdue1_30) > 0 ? `€${parseFloat(ag.overdue1_30).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell className="text-right text-sm text-orange-600 dark:text-orange-400" data-testid={`text-overdue-31-60-${st.customerId}`}>
                                    {parseFloat(ag.overdue31_60) > 0 ? `€${parseFloat(ag.overdue31_60).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell className="text-right text-sm font-semibold text-rose-700 dark:text-rose-500" data-testid={`text-overdue-60plus-${st.customerId}`}>
                                    {parseFloat(ag.overdue60plus) > 0 ? `€${parseFloat(ag.overdue60plus).toFixed(2)}` : <span className="text-muted-foreground font-normal">—</span>}
                                  </TableCell>
                                </>}
                                <TableCell onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center gap-1">
                                    <Button size="icon" variant="ghost" onClick={() => previewStatement(st.customerId)} title="Preview" data-testid={`button-preview-statement-${st.customerId}`}>
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" onClick={() => printStatement(st.customerId)} title="Print" data-testid={`button-print-statement-${st.customerId}`}>
                                      <Printer className="w-4 h-4" />
                                    </Button>
                                    <Button size="icon" variant="ghost" onClick={() => downloadStatement(st.customerId)} title="Download" data-testid={`button-download-statement-${st.customerId}`}>
                                      <Download className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => sendStatementEmail(st.customerId)}
                                      disabled={sendingId === st.customerId}
                                      title="Send by Email"
                                      data-testid={`button-email-statement-${st.customerId}`}
                                    >
                                      {sendingId === st.customerId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>

                              {isExpanded && (() => {
                                const isDetailExpanded = expandedDetail === st.customerId;
                                return (
                                  <TableRow className="bg-muted/20 dark:bg-muted/10">
                                    <TableCell colSpan={colCount} className="p-0">
                                      <div className="mx-6 my-3 space-y-2">

                                        {/* Due by banner */}
                                        {parseFloat(st.dueByEndOfMonth || "0") > 0 && (
                                          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-sm">
                                            <div className="flex items-center gap-3 flex-wrap">
                                              <span className="font-semibold text-amber-800 dark:text-amber-300">Due by {endOfMonthLabel}:</span>
                                              <span className="font-bold text-amber-900 dark:text-amber-200">€{parseFloat(st.dueByEndOfMonth).toFixed(2)}</span>
                                              {parseFloat(st.totalOverdue || "0") > 0 && (
                                                <span className="text-xs text-red-600 dark:text-red-400">(includes €{parseFloat(st.totalOverdue).toFixed(2)} overdue)</span>
                                              )}
                                            </div>
                                            {(parseFloat(st.dueByEomCurrentMonth || "0") > 0 || parseFloat(st.dueByEomPrevMonth || "0") > 0) && (
                                              <div className="flex items-center gap-4 mt-1.5 pt-1.5 border-t border-amber-200/60 dark:border-amber-800/40">
                                                {parseFloat(st.dueByEomCurrentMonth || "0") > 0 && (
                                                  <div className="flex items-center gap-1.5 text-xs">
                                                    <span className="text-amber-700 dark:text-amber-400">{currentMonthLabel}:</span>
                                                    <span className="font-semibold text-amber-800 dark:text-amber-300">€{parseFloat(st.dueByEomCurrentMonth).toFixed(2)}</span>
                                                  </div>
                                                )}
                                                {parseFloat(st.dueByEomPrevMonth || "0") > 0 && (
                                                  <div className="flex items-center gap-1.5 text-xs">
                                                    <span className="text-orange-700 dark:text-orange-400">{prevMonthLabel}:</span>
                                                    <span className="font-semibold text-orange-800 dark:text-orange-300">€{parseFloat(st.dueByEomPrevMonth).toFixed(2)}</span>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* Aging analysis totals — compact summary */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          {parseFloat(ag.withinTermsFuture) > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800">
                                              Within terms: €{parseFloat(ag.withinTermsFuture).toFixed(2)}
                                            </span>
                                          )}
                                          {parseFloat(ag.overdue1_30) > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800">
                                              Overdue 1–30d: €{parseFloat(ag.overdue1_30).toFixed(2)}
                                            </span>
                                          )}
                                          {parseFloat(ag.overdue31_60) > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-orange-50 text-orange-800 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800">
                                              Overdue 31–60d: €{parseFloat(ag.overdue31_60).toFixed(2)}
                                            </span>
                                          )}
                                          {parseFloat(ag.overdue60plus) > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-800">
                                              Overdue 60+d: €{parseFloat(ag.overdue60plus).toFixed(2)}
                                            </span>
                                          )}
                                          {parseFloat(ag.withinTermsFuture) <= 0 && parseFloat(ag.overdue1_30) <= 0 && parseFloat(ag.overdue31_60) <= 0 && parseFloat(ag.overdue60plus) <= 0 && (
                                            <span className="text-xs text-muted-foreground italic">No outstanding balance</span>
                                          )}
                                        </div>

                                        {/* Transaction drill-down toggle */}
                                        <div>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-xs text-muted-foreground gap-1"
                                            onClick={() => setExpandedDetail(isDetailExpanded ? null : st.customerId)}
                                            data-testid={`button-toggle-detail-${st.customerId}`}
                                          >
                                            {isDetailExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                            {isDetailExpanded ? "Hide" : "View"} transactions ({stInvoices.length + stPayments.length})
                                          </Button>
                                        </div>

                                        {/* Transaction detail — second-level drill-down */}
                                        {isDetailExpanded && (
                                          <div className="rounded-lg border border-border overflow-hidden text-xs">
                                            <table className="w-full border-collapse">
                                              <thead>
                                                <tr className="bg-muted/60 dark:bg-muted/30 text-muted-foreground">
                                                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Document</th>
                                                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Inv. Date</th>
                                                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Due Date</th>
                                                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Status</th>
                                                  <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Total</th>
                                                  <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Paid</th>
                                                  <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Balance</th>
                                                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Standing</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {stInvoices.map((inv, i) => {
                                                  const bal = parseFloat(inv.balance || "0");
                                                  const standing = inv.type === "invoice" ? getInvStatus(inv.daysOverdue) : null;
                                                  const isDueThisMonth = inv.effectiveDueDate
                                                    ? new Date(inv.effectiveDueDate) <= new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
                                                      && new Date(inv.effectiveDueDate) >= new Date()
                                                    : false;
                                                  return (
                                                    <tr key={`inv-${i}`} className={`border-t border-border/50 hover:bg-muted/20 ${standing?.overdue ? "bg-red-50/20 dark:bg-red-950/10" : ""}`}>
                                                      <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                                                      <td className="px-3 py-2 text-muted-foreground">{inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</td>
                                                      <td className={`px-3 py-2 font-medium ${standing?.overdue ? "text-red-600 dark:text-red-400" : isDueThisMonth ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                                                        {inv.effectiveDueDate ? new Date(inv.effectiveDueDate).toLocaleDateString("en-GB") : inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}
                                                        {!inv.dueDate && inv.effectiveDueDate && <span className="ml-1 text-[9px] text-muted-foreground">(calc.)</span>}
                                                      </td>
                                                      <td className="px-3 py-2">
                                                        <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                                                          {inv.type === "credit_note" ? "Credit Note" : "Invoice"}
                                                        </span>
                                                        {" "}
                                                        <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted/50 text-muted-foreground">{inv.status}</span>
                                                      </td>
                                                      <td className="px-3 py-2 text-right font-medium">€{parseFloat(inv.total || "0").toFixed(2)}</td>
                                                      <td className="px-3 py-2 text-right text-green-700 dark:text-green-400">
                                                        {parseFloat(inv.paid || "0") > 0 ? `€${parseFloat(inv.paid).toFixed(2)}` : "—"}
                                                      </td>
                                                      <td className={`px-3 py-2 text-right font-semibold ${bal > 0 ? (standing?.overdue ? "text-red-600 dark:text-red-400" : "text-foreground") : "text-muted-foreground"}`}>
                                                        {bal > 0 ? `€${bal.toFixed(2)}` : "—"}
                                                      </td>
                                                      <td className="px-3 py-2">
                                                        {standing && bal > 0 ? (
                                                          standing.overdue ? (
                                                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${standing.color}`}>
                                                              {standing.label}
                                                            </span>
                                                          ) : isDueThisMonth ? (
                                                            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                              Due This Month
                                                            </span>
                                                          ) : (
                                                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${standing.color}`}>
                                                              {standing.label}
                                                            </span>
                                                          )
                                                        ) : null}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}

                                                {stPayments.map((pmt, i) => {
                                                  const method = pmt.paymentMethod || "other";
                                                  const label = methodLabels[method] || method;
                                                  const colorClass = methodColors[method] || methodColors.other;
                                                  const details = [
                                                    pmt.reference ? `Ref: ${pmt.reference}` : null,
                                                    pmt.invoiceNumber ? `Inv: ${pmt.invoiceNumber}` : null,
                                                    pmt.notes && !pmt.notes.startsWith("Applied from balance") ? pmt.notes : null,
                                                  ].filter(Boolean).join(" · ");
                                                  return (
                                                    <tr key={`pmt-${i}`} className="border-t border-border/50 bg-green-50/30 dark:bg-green-950/10 hover:bg-green-50/50">
                                                      <td className="px-3 py-2 font-medium text-green-700 dark:text-green-400">Payment</td>
                                                      <td className="px-3 py-2 text-muted-foreground">{pmt.date ? new Date(pmt.date).toLocaleDateString("en-GB") : "—"}</td>
                                                      <td className="px-3 py-2" />
                                                      <td className="px-3 py-2">
                                                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${colorClass}`}>{label}</span>
                                                        {details && <span className="ml-2 text-muted-foreground">{details}</span>}
                                                      </td>
                                                      <td className="px-3 py-2" />
                                                      <td className="px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400" colSpan={2}>
                                                        −€{parseFloat(pmt.amount || "0").toFixed(2)}
                                                      </td>
                                                      <td className="px-3 py-2" />
                                                    </tr>
                                                  );
                                                })}

                                                {stInvoices.length === 0 && stPayments.length === 0 && (
                                                  <tr>
                                                    <td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">No transactions</td>
                                                  </tr>
                                                )}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}

                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })()}
                            </Fragment>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        <TabsContent value="savings" className="mt-4 space-y-4">
          {/* Filter bar */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs">Customer</Label>
                  <Select value={savingsCustomer} onValueChange={setSavingsCustomer} data-testid="select-savings-customer">
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Select customer…" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">From</Label>
                  <Popover open={savingsFromOpen} onOpenChange={setSavingsFromOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-36 justify-start text-left font-normal"
                        data-testid="input-savings-from"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        {savingsFrom ? savingsFrom : <span className="text-muted-foreground">Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={savingsFrom ? new Date(savingsFrom + "T12:00:00") : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const y = date.getFullYear();
                            const m = String(date.getMonth() + 1).padStart(2, "0");
                            const d = String(date.getDate()).padStart(2, "0");
                            setSavingsFrom(`${y}-${m}-${d}`);
                          }
                          setSavingsFromOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Popover open={savingsToOpen} onOpenChange={setSavingsToOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-36 justify-start text-left font-normal"
                        data-testid="input-savings-to"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        {savingsTo ? savingsTo : <span className="text-muted-foreground">Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={savingsTo ? new Date(savingsTo + "T12:00:00") : undefined}
                        onSelect={(date) => {
                          if (date) {
                            const y = date.getFullYear();
                            const m = String(date.getMonth() + 1).padStart(2, "0");
                            const d = String(date.getDate()).padStart(2, "0");
                            setSavingsTo(`${y}-${m}-${d}`);
                          }
                          setSavingsToOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label className="text-xs invisible">Presets</Label>
                  <div className="flex gap-1">
                    {[
                      { label: "3 Months", months: 3 },
                      { label: "6 Months", months: 6 },
                      { label: "12 Months", months: 12 },
                    ].map(({ label, months }) => (
                      <Button
                        key={label}
                        variant={savingsPreset === String(months) ? "default" : "outline"}
                        size="sm"
                        data-testid={`button-preset-${months}m`}
                        onClick={() => {
                          const to = new Date();
                          const from = new Date();
                          from.setMonth(from.getMonth() - months);
                          setSavingsFrom(from.toISOString().split("T")[0]);
                          setSavingsTo(to.toISOString().split("T")[0]);
                          setSavingsPreset(String(months));
                          localStorage.setItem("savingsDatePreset", String(months));
                        }}
                      >
                        Last {label}
                      </Button>
                    ))}
                    <Button
                      variant={savingsPreset === "this-year" ? "default" : "outline"}
                      size="sm"
                      data-testid="button-preset-this-year"
                      onClick={() => {
                        const now = new Date();
                        setSavingsFrom(`${now.getFullYear()}-01-01`);
                        setSavingsTo(now.toISOString().split("T")[0]);
                        setSavingsPreset("this-year");
                        localStorage.setItem("savingsDatePreset", "this-year");
                      }}
                    >
                      This Year
                    </Button>
                  </div>
                </div>
                {savingsReport && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-export-savings-pdf"
                      onClick={() => window.open(`/api/reports/savings/${savingsCustomer}/${savingsFrom}/${savingsTo}/html?print=1`, "_blank")}
                    >
                      <FileText className="w-4 h-4 mr-1" /> Print / Save as PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-export-savings-excel"
                      onClick={() => { window.location.href = `/api/reports/savings/${savingsCustomer}/${savingsFrom}/${savingsTo}/excel`; }}
                    >
                      <FileSpreadsheet className="w-4 h-4 mr-1" /> Export Excel
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-send-savings-email"
                      onClick={() => {
                        const selectedCust = customers.find(c => c.id === savingsCustomer);
                        setPreviewEmailOverride(selectedCust?.email || "");
                        setShowEmailPreview(true);
                      }}
                    >
                      <Send className="w-4 h-4 mr-1" />
                      Send to Customer
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {!savingsCustomer && (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                <BadgePercent className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>Select a customer to view their savings history.</p>
              </CardContent>
            </Card>
          )}

          {savingsCustomer && savingsLoading && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
            </div>
          )}

          {savingsReport && !savingsLoading && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Savings</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-total-savings">€{savingsReport.totalSavings.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Avg Discount</p>
                    <p className="text-2xl font-bold" data-testid="stat-avg-discount">{savingsReport.avgDiscountPercent.toFixed(1)}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Invoices with Disc</p>
                    <p className="text-2xl font-bold" data-testid="stat-invoice-count">{savingsReport.invoiceCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Best Deal</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-best-deal">€{savingsReport.bestDeal.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Saved vs Catalogue</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="stat-saved-vs-catalogue">€{savingsReport.savedVsCatalogue.toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Monthly Chart with cumulative line */}
              {savingsReport.monthly.length > 0 && (() => {
                let cumulative = 0;
                const chartData = savingsReport.monthly.map(m => {
                  cumulative += m.savings;
                  return { ...m, cumulative: parseFloat(cumulative.toFixed(2)) };
                });
                return (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Monthly Savings Timeline</CardTitle>
                      <p className="text-xs text-muted-foreground">Bars = monthly savings · Line = cumulative total</p>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={240}>
                        <ComposedChart data={chartData} margin={{ top: 5, right: 50, left: 0, bottom: 5 }}>
                          <defs>
                            <linearGradient id="savingsGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="monthly" tickFormatter={(v: number) => `€${v}`} tick={{ fontSize: 11 }} width={60} />
                          <YAxis yAxisId="cumulative" orientation="right" tickFormatter={(v: number) => `€${v}`} tick={{ fontSize: 11 }} width={60} />
                          <RechartTooltip formatter={(value: number, name: string) => [`€${value.toFixed(2)}`, name === "savings" ? "Monthly Savings" : "Cumulative"]} />
                          <Legend formatter={(val: string) => val === "savings" ? "Monthly" : "Cumulative"} />
                          <Area yAxisId="monthly" type="monotone" dataKey="savings" stroke="#10b981" strokeWidth={2} fill="url(#savingsGradient)" />
                          <Line yAxisId="cumulative" type="monotone" dataKey="cumulative" stroke="#6366f1" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Invoice breakdown table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Invoice Breakdown — {savingsReport.customerName}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {savingsReport.invoices.length === 0 ? (
                    <p className="p-6 text-center text-muted-foreground">No discounted invoices found in this period.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right text-emerald-700 dark:text-emerald-400">Savings</TableHead>
                          <TableHead className="text-right">Disc %</TableHead>
                          <TableHead className="w-8 text-center">Trend</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {savingsReport.invoices.map((inv, invIdx) => {
                          const prevInv = savingsReport.invoices[invIdx + 1];
                          const savingsPct = inv.invoiceTotal > 0 ? (inv.totalSavings / inv.invoiceTotal) * 100 : 0;
                          const prevPct = prevInv && prevInv.invoiceTotal > 0 ? (prevInv.totalSavings / prevInv.invoiceTotal) * 100 : null;
                          const trend = prevPct === null ? null : savingsPct > prevPct + 0.1 ? "up" : savingsPct < prevPct - 0.1 ? "down" : "flat";
                          return (
                          <Fragment key={inv.invoiceId}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => setExpandedSavingsInvoice(expandedSavingsInvoice === inv.invoiceId ? null : inv.invoiceId)}
                              data-testid={`row-savings-invoice-${inv.invoiceId}`}
                            >
                              <TableCell className="py-2 pr-0">
                                {expandedSavingsInvoice === inv.invoiceId
                                  ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                              </TableCell>
                              <TableCell className="font-medium py-2">{inv.invoiceNumber}</TableCell>
                              <TableCell className="text-sm text-muted-foreground py-2">{formatDate(inv.invoiceDate)}</TableCell>
                              <TableCell className="text-right py-2">€{inv.invoiceTotal.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400 py-2">€{inv.totalSavings.toFixed(2)}</TableCell>
                              <TableCell className="text-right text-sm py-2">{savingsPct.toFixed(1)}%</TableCell>
                              <TableCell className="text-center py-2">
                                {trend === "up" && <ArrowUp className="w-3.5 h-3.5 text-emerald-500 inline" />}
                                {trend === "down" && <ArrowDown className="w-3.5 h-3.5 text-red-500 inline" />}
                                {trend === "flat" && <Minus className="w-3.5 h-3.5 text-muted-foreground inline" />}
                              </TableCell>
                            </TableRow>
                            {expandedSavingsInvoice === inv.invoiceId && (
                              <TableRow>
                                <TableCell colSpan={5} className="bg-muted/30 py-0">
                                  <div className="px-6 py-3">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-muted-foreground">
                                          <th className="text-left py-1 pr-4">Item</th>
                                          <th className="text-right pr-4">Qty</th>
                                          <th className="text-right pr-4">Unit Price</th>
                                          <th className="text-right pr-4">Disc %</th>
                                          <th className="text-right pr-4">Disc €</th>
                                          <th className="text-right text-emerald-700 dark:text-emerald-400">Saving</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {inv.lines.map((l, li) => (
                                          <tr key={li} className="border-t border-border/40">
                                            <td className="py-1 pr-4">{l.itemName}</td>
                                            <td className="text-right pr-4">{l.qty}</td>
                                            <td className="text-right pr-4">€{l.unitPrice.toFixed(2)}</td>
                                            <td className="text-right pr-4">{l.discountPercent.toFixed(1)}%</td>
                                            <td className="text-right pr-4">€{l.discountAmount.toFixed(2)}</td>
                                            <td className="text-right font-medium text-emerald-600 dark:text-emerald-400">€{l.savings.toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {savingsCustomer && savingsEmailLogs.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" /> Sent Reports History
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savingsEmailLogs.map(log => (
                      <TableRow key={log.id} data-testid={`row-savings-email-log-${log.id}`}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-email-log-recipient-${log.id}`}>{log.toEmail}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.subject}</TableCell>
                        <TableCell>
                          <Badge variant={log.status === "sent" ? "default" : "destructive"} data-testid={`badge-email-log-status-${log.id}`}>
                            {log.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

      </Tabs>

      <Dialog open={showEmailPreview} onOpenChange={(open) => { if (!sendSavingsEmailMutation.isPending) setShowEmailPreview(open); }}>
        <DialogContent className="max-w-3xl w-full" data-testid="dialog-email-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" /> Preview &amp; Send Savings Report
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="preview-email">Recipient Email</Label>
              <Input
                id="preview-email"
                data-testid="input-preview-email"
                type="email"
                value={previewEmailOverride}
                onChange={(e) => setPreviewEmailOverride(e.target.value)}
                placeholder="customer@example.com"
              />
              {!previewEmailOverride && (
                <p className="text-xs text-destructive">No email address set. Enter one to send the report.</p>
              )}
            </div>

            <div className="space-y-1">
              <Label>Email Preview</Label>
              <div className="border rounded-md overflow-hidden" style={{ height: 400 }}>
                {savingsCustomer && savingsFrom && savingsTo && (
                  <iframe
                    data-testid="iframe-email-preview"
                    src={`/api/reports/savings/${savingsCustomer}/${savingsFrom}/${savingsTo}/html`}
                    className="w-full h-full"
                    style={{ border: "none" }}
                    title="Email Preview"
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">This is a preview of the report that will be emailed to the customer.</p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              data-testid="button-cancel-email"
              onClick={() => setShowEmailPreview(false)}
              disabled={sendSavingsEmailMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              data-testid="button-confirm-send-email"
              disabled={!previewEmailOverride || sendSavingsEmailMutation.isPending}
              onClick={() => sendSavingsEmailMutation.mutate(previewEmailOverride)}
            >
              {sendSavingsEmailMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Sending…</>
              ) : (
                <><Send className="w-4 h-4 mr-1" /> Send Report</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
