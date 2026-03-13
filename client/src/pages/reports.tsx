import { useState, Fragment } from "react";
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
import type { Customer, Invoice } from "@shared/schema";

export default function Reports() {
  const { toast } = useToast();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [expandedStatement, setExpandedStatement] = useState<string | null>(null);
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
    totalInvoiced: string;
    totalPaid: string;
    balance: string;
    invoiceCount: number;
    aging: {
      current: string;
      days1_30: string;
      days31_60: string;
      days61_90: string;
      days90plus: string;
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

      <Tabs defaultValue="sales">
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
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Sales (incl. VAT)</p>
                    <p className="text-xl font-bold mt-1" data-testid="stat-total-sales">
                      €{parseFloat(salesReport.totalSales).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                    </p>
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
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Margin</p>
                    <p className={`text-xl font-bold mt-1 ${parseFloat(salesReport.overallMargin) >= 0 ? "text-green-600" : "text-red-500"}`} data-testid="stat-overall-margin">
                      {salesReport.overallMargin}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Tax</p>
                    <p className="text-xl font-bold mt-1">
                      €{parseFloat(salesReport.totalTax).toLocaleString("el-CY", { minimumFractionDigits: 2 })}
                    </p>
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
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead className="text-center">Invoices</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">Profit</TableHead>
                          <TableHead className="text-right">Margin</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {salesReport.customerProfits.map((cp) => (
                          <TableRow key={cp.customerId}>
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
                        ))}
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
                        <TableHead className="text-right">Total</TableHead>
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
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right text-green-700 dark:text-green-400">Current</TableHead>
                    <TableHead className="text-right text-yellow-600 dark:text-yellow-400">1–30 Days</TableHead>
                    <TableHead className="text-right text-orange-600 dark:text-orange-400">31–60 Days</TableHead>
                    <TableHead className="text-right text-red-600 dark:text-red-400">61–90 Days</TableHead>
                    <TableHead className="text-right text-red-700 dark:text-red-500">90+ Days</TableHead>
                    <TableHead className="w-[160px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerStatements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No data available</TableCell>
                    </TableRow>
                  ) : (
                    customerStatements.map((st) => {
                      const ag = st.aging || { current: "0", days1_30: "0", days31_60: "0", days61_90: "0", days90plus: "0" };
                      const hasOverdue = parseFloat(ag.days1_30) > 0 || parseFloat(ag.days31_60) > 0 || parseFloat(ag.days61_90) > 0 || parseFloat(ag.days90plus) > 0;
                      const isExpanded = expandedStatement === st.customerId;
                      const stInvoices: any[] = st.invoices || [];
                      const stPayments: any[] = st.payments || [];
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
                            <TableCell className={`text-right font-semibold text-sm ${parseFloat(st.balance) > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid={`text-balance-${st.customerId}`}>
                              €{parseFloat(st.balance).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-sm text-green-700 dark:text-green-400" data-testid={`text-aging-current-${st.customerId}`}>
                              {parseFloat(ag.current) > 0 ? `€${parseFloat(ag.current).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm text-yellow-600 dark:text-yellow-400" data-testid={`text-aging-1-30-${st.customerId}`}>
                              {parseFloat(ag.days1_30) > 0 ? `€${parseFloat(ag.days1_30).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm text-orange-600 dark:text-orange-400" data-testid={`text-aging-31-60-${st.customerId}`}>
                              {parseFloat(ag.days31_60) > 0 ? `€${parseFloat(ag.days31_60).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm text-red-600 dark:text-red-400" data-testid={`text-aging-61-90-${st.customerId}`}>
                              {parseFloat(ag.days61_90) > 0 ? `€${parseFloat(ag.days61_90).toFixed(2)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold text-red-700 dark:text-red-500" data-testid={`text-aging-90plus-${st.customerId}`}>
                              {parseFloat(ag.days90plus) > 0 ? `€${parseFloat(ag.days90plus).toFixed(2)}` : <span className="text-muted-foreground font-normal">—</span>}
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
                            <TableRow key={`${st.customerId}-detail`} className="bg-muted/20 dark:bg-muted/10">
                              <TableCell colSpan={9} className="p-0">
                                <div className="mx-6 my-3 rounded-lg border border-border overflow-hidden text-xs">
                                  <table className="w-full border-collapse">
                                    <thead>
                                      <tr className="bg-muted/60 dark:bg-muted/30 text-muted-foreground">
                                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Document</th>
                                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Date</th>
                                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Due Date</th>
                                        <th className="text-left px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Details</th>
                                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Total</th>
                                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Paid</th>
                                        <th className="text-right px-3 py-2 font-semibold uppercase tracking-wide text-[10px]">Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {stInvoices.map((inv: any, i: number) => (
                                        <tr key={`inv-${i}`} className="border-t border-border/50 hover:bg-muted/20">
                                          <td className="px-3 py-2 font-medium">{inv.invoiceNumber}</td>
                                          <td className="px-3 py-2 text-muted-foreground">{inv.date ? new Date(inv.date).toLocaleDateString("en-GB") : "—"}</td>
                                          <td className="px-3 py-2 text-muted-foreground">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-GB") : "—"}</td>
                                          <td className="px-3 py-2">
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                              {inv.type === "credit_note" ? "Credit Note" : inv.type === "invoice" ? "Invoice" : inv.type}
                                            </Badge>
                                            {" "}
                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{inv.status}</Badge>
                                          </td>
                                          <td className="px-3 py-2 text-right font-medium">€{parseFloat(inv.total || "0").toFixed(2)}</td>
                                          <td className="px-3 py-2 text-right text-green-700 dark:text-green-400">
                                            {parseFloat(inv.paid || "0") > 0 ? `€${parseFloat(inv.paid).toFixed(2)}` : "—"}
                                          </td>
                                          <td className={`px-3 py-2 text-right font-semibold ${parseFloat(inv.balance || "0") > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                                            €{parseFloat(inv.balance || "0").toFixed(2)}
                                          </td>
                                        </tr>
                                      ))}

                                      {stPayments.map((pmt: any, i: number) => {
                                        const method = pmt.paymentMethod || "other";
                                        const label = methodLabels[method] || method;
                                        const colorClass = methodColors[method] || methodColors.other;
                                        const details = [
                                          pmt.reference ? `Ref: ${pmt.reference}` : null,
                                          pmt.invoiceNumber ? `Invoice: ${pmt.invoiceNumber}` : null,
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
                                            <td className="px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400">
                                              −€{parseFloat(pmt.amount || "0").toFixed(2)}
                                            </td>
                                            <td className="px-3 py-2" />
                                          </tr>
                                        );
                                      })}

                                      {stInvoices.length === 0 && stPayments.length === 0 && (
                                        <tr>
                                          <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">No transactions</td>
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
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
