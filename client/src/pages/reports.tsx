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
import { BarChart3, Download, FileText, Users } from "lucide-react";
import type { Customer, Invoice } from "@shared/schema";

export default function Reports() {
  const [selectedCustomer, setSelectedCustomer] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: salesReport, isLoading: salesLoading } = useQuery<{
    invoices: (Invoice & { customerName: string })[];
    totalSales: string;
    totalTax: string;
    invoiceCount: number;
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

  const downloadStatement = async (customerId: string) => {
    try {
      const res = await fetch(`/api/reports/statement/${customerId}/pdf`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `statement-${customerId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {}
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Sales</p>
                    <p className="text-2xl font-bold mt-1" data-testid="stat-total-sales">
                      ${parseFloat(salesReport.totalSales).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Tax</p>
                    <p className="text-2xl font-bold mt-1">
                      ${parseFloat(salesReport.totalTax).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Invoices</p>
                    <p className="text-2xl font-bold mt-1">{salesReport.invoiceCount}</p>
                  </CardContent>
                </Card>
              </div>

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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salesReport.invoices.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No invoices in this period</TableCell>
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
                            <TableCell className="text-right font-medium text-sm">${parseFloat(inv.total).toFixed(2)}</TableCell>
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
                    <TableHead className="w-[80px]" />
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
                        <TableCell className="text-right text-sm">${parseFloat(st.totalInvoiced).toFixed(2)}</TableCell>
                        <TableCell className="text-right text-sm">${parseFloat(st.totalPaid).toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-medium text-sm ${parseFloat(st.balance) > 0 ? "text-red-500" : ""}`}>
                          ${parseFloat(st.balance).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => downloadStatement(st.customerId)} data-testid={`button-download-statement-${st.customerId}`}>
                            <Download className="w-4 h-4" />
                          </Button>
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
