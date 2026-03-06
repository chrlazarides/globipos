import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Download, FileText, Users, Printer, Eye, Send, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer, Invoice } from "@shared/schema";

export default function Reports() {
  const { toast } = useToast();
  const [sendingId, setSendingId] = useState<string | null>(null);
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
                            <TableCell className="text-sm">{new Date(inv.date).toLocaleDateString()}</TableCell>
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
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Invoices</TableHead>
                    <TableHead className="text-right">Total Invoiced</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="w-[160px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerStatements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No data available</TableCell>
                    </TableRow>
                  ) : (
                    customerStatements.map((st) => (
                      <TableRow key={st.customerId}>
                        <TableCell className="font-medium text-sm">{st.customerName}</TableCell>
                        <TableCell className="text-sm">{st.invoiceCount}</TableCell>
                        <TableCell className="text-right text-sm">€{parseFloat(st.totalInvoiced).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm">€{parseFloat(st.totalPaid).toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-medium text-sm ${parseFloat(st.balance) > 0 ? "text-red-500" : ""}`}>
                          €{parseFloat(st.balance).toFixed(2)}
                        </TableCell>
                        <TableCell>
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
                    ))
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
