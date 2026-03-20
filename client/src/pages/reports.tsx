import { useState, Fragment, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { BarChart3, Download, FileText, Users, Printer, Eye, Send, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import type { Customer, Invoice } from "@shared/schema";

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

  const [selectedCustomer, setSelectedCustomer] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
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
    dueByEndOfMonth: string;
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

  const previewStatement = (customerId: string) => {
    window.open(`/api/reports/statement/${customerId}/pdf`, "_blank");
  };

  const printStatement = (customerId: string) => {
    window.open(`/api/reports/statement/${customerId}/pdf?print=1`, "_blank");
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
            const endOfMonthLabel = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
            const currentMonthLabel = new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" });
            const prevMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
            const prevMonthLabel = prevMonthDate.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

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

            return (
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-center">Terms</TableHead>
                        <TableHead className="text-right">Balance Due</TableHead>
                        <TableHead className="text-right text-violet-600 dark:text-violet-400">Due by {endOfMonthLabel}</TableHead>
                        <TableHead className="text-right text-teal-600 dark:text-teal-400">Within Terms</TableHead>
                        <TableHead className="text-right text-amber-600 dark:text-amber-400">Overdue 1–30d</TableHead>
                        <TableHead className="text-right text-orange-600 dark:text-orange-400">Overdue 31–60d</TableHead>
                        <TableHead className="text-right text-rose-700 dark:text-rose-500">Overdue 60+d</TableHead>
                        <TableHead className="w-[160px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerStatements.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No data available</TableCell>
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
                                            <span className="font-semibold text-violet-600 dark:text-violet-400">€{cur.toFixed(2)}</span>
                                          </div>
                                        )}
                                        {prev > 0 && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-muted-foreground font-normal">{prevMonthLabel}</span>
                                            <span className="font-semibold text-violet-700 dark:text-violet-500">€{prev.toFixed(2)}</span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </TableCell>
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

                              {isExpanded && (
                                <TableRow className="bg-muted/20 dark:bg-muted/10">
                                  <TableCell colSpan={10} className="p-0">
                                    <div className="mx-6 my-3 space-y-2">

                                      {/* End-of-month summary banner */}
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
                                                  <span className="text-violet-700 dark:text-violet-400">{currentMonthLabel}:</span>
                                                  <span className="font-semibold text-violet-800 dark:text-violet-300">€{parseFloat(st.dueByEomCurrentMonth).toFixed(2)}</span>
                                                </div>
                                              )}
                                              {parseFloat(st.dueByEomPrevMonth || "0") > 0 && (
                                                <div className="flex items-center gap-1.5 text-xs">
                                                  <span className="text-violet-700 dark:text-violet-400">{prevMonthLabel}:</span>
                                                  <span className="font-semibold text-violet-800 dark:text-violet-300">€{parseFloat(st.dueByEomPrevMonth).toFixed(2)}</span>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}

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
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
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
      </Tabs>
    </div>
  );
}
