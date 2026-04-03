import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Users, FileText, Euro, AlertTriangle, TrendingUp, BarChart3 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import type { Invoice, Item, SystemSetting } from "@shared/schema";
import { formatDate } from "@/lib/utils";

const PIE_COLORS: Record<string, string> = {
  paid: "#10b981",
  draft: "#94a3b8",
  sent: "#6366f1",
  overdue: "#f43f5e",
  cancelled: "#cbd5e1",
};

const CUSTOMER_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6"];

const REVENUE_COLOR = "#6366f1";
const PROFIT_COLOR  = "#10b981";

export default function Dashboard() {
  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const companyName = settings.find(s => s.key === "company_name")?.value || "VINERIA DI MARE Trading";

  const { data: stats, isLoading } = useQuery<{
    totalItems: number;
    totalCustomers: number;
    totalInvoices: number;
    totalRevenue: string;
    lowStockItems: Item[];
    recentInvoices: (Invoice & { customerName: string })[];
    overdueInvoices: number;
  }>({ queryKey: ["/api/dashboard/stats"] });

  const { data: charts, isLoading: chartsLoading } = useQuery<{
    monthlySales: { month: string; revenue: number; profit: number; invoices: number }[];
    topCustomers: { name: string; revenue: number }[];
    invoiceStatus: { status: string; count: number; amount: number }[];
  }>({ queryKey: ["/api/dashboard/charts"] });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const s = stats || { totalItems: 0, totalCustomers: 0, totalInvoices: 0, totalRevenue: "0.00", lowStockItems: [], recentInvoices: [], overdueInvoices: 0 };
  const c = charts || { monthlySales: [], topCustomers: [], invoiceStatus: [] };

  const totalRevNum = parseFloat(s.totalRevenue);
  const totalProfit = c.monthlySales.reduce((sum, m) => sum + m.profit, 0);
  const avgMargin = c.monthlySales.reduce((sum, m) => sum + m.revenue, 0) > 0
    ? (totalProfit / c.monthlySales.reduce((sum, m) => sum + m.revenue, 0) * 100).toFixed(1)
    : "0.0";

  const fmtEur = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 overflow-hidden flex-shrink-0 flex items-center justify-center" data-testid="img-dashboard-logo">
            <img src="/logo.png" alt="Logo" className="w-[200%] h-[200%] object-contain" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">{companyName}</h1>
            <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-page-description">Operations overview</p>
          </div>
        </div>
        <Link href="/invoices/new">
          <Button data-testid="button-new-invoice">New Invoice</Button>
        </Link>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Items" value={String(s.totalItems)} icon={Package} description="Active products" />
        <StatCard title="Customers" value={String(s.totalCustomers)} icon={Users} description="Active accounts" />
        <StatCard title="Invoices" value={String(s.totalInvoices)} icon={FileText} description={`${s.overdueInvoices} overdue`} />
        <StatCard title="Cash Collected" value={`€${totalRevNum.toLocaleString("el-CY", { minimumFractionDigits: 2 })}`} icon={Euro} />
      </div>

      {/* Main Chart — Sales & Profit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Sales &amp; Profit — Last 6 Months
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Gross profit margin (6-month avg): <span className="font-semibold">{avgMargin}%</span></p>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: REVENUE_COLOR }} />Revenue (ex-VAT)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: PROFIT_COLOR }} />Profit</span>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {chartsLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : c.monthlySales.length === 0 || c.monthlySales.every(m => m.revenue === 0) ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No sales data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={c.monthlySales} barCategoryGap="30%" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.85} />
                  </linearGradient>
                  <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.85} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={v => `€${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(value: number, name: string) => [fmtEur(value), name === "revenue" ? "Revenue (ex-VAT)" : "Gross Profit"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  cursor={{ fill: "rgba(99,102,241,0.06)" }}
                />
                <Bar dataKey="revenue" name="revenue" fill="url(#gradRevenue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="profit" fill="url(#gradProfit)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Two charts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Customers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Top Customers by Revenue
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {chartsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : c.topCustomers.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={c.topCustomers} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tickFormatter={v => `€${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip formatter={(v: number) => [fmtEur(v), "Revenue (ex-VAT)"]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} cursor={{ fill: "rgba(99,102,241,0.06)" }} />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                    {c.topCustomers.map((_, i) => (
                      <Cell key={i} fill={CUSTOMER_COLORS[i % CUSTOMER_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Invoice Status Donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              Invoice Status Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {chartsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : c.invoiceStatus.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No invoices yet</div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={180}>
                  <PieChart>
                    <Pie data={c.invoiceStatus} dataKey="amount" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} stroke="none">
                      {c.invoiceStatus.map((entry) => (
                        <Cell key={entry.status} fill={PIE_COLORS[entry.status] || "#94a3b8"} opacity={0.9} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number, name: string) => [fmtEur(v), name]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 flex-1">
                  {c.invoiceStatus.map(entry => (
                    <div key={entry.status} className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[entry.status] || "#a1a1aa" }} />
                        <span className="capitalize text-muted-foreground">{entry.status}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-semibold">{entry.count}</span>
                        <span className="text-muted-foreground ml-1">({fmtEur(entry.amount)})</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Invoices + Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
            <Link href="/invoices">
              <Button variant="ghost" size="sm" data-testid="link-view-all-invoices">View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {s.recentInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No invoices yet</p>
            ) : (
              <div className="divide-y">
                {s.recentInvoices.slice(0, 5).map((inv) => (
                  <Link key={inv.id} href={`/invoices/${inv.id}`}>
                    <div className="flex items-center justify-between gap-4 px-4 py-3 hover-elevate cursor-pointer" data-testid={`invoice-row-${inv.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{inv.customerName} · {formatDate(inv.date)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{fmtEur(parseFloat(inv.total))}</p>
                        <StatusBadge status={inv.status} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Low Stock Alerts</CardTitle>
            <Link href="/items">
              <Button variant="ghost" size="sm" data-testid="link-view-all-items">View Items</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {s.lowStockItems.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">All stock levels healthy</p>
            ) : (
              <div className="divide-y">
                {s.lowStockItems.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 px-4 py-3" data-testid={`lowstock-row-${item.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.sku}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">{item.stockQuantity} left</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: "bg-secondary text-secondary-foreground",
    sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    partial: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    cancelled: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  };
  const labels: Record<string, string> = {
    draft: "Draft", sent: "Sent", paid: "Paid",
    partial: "Partial", overdue: "Overdue", cancelled: "Cancelled",
  };
  return (
    <Badge variant="outline" className={`text-xs ${variants[status] || ""}`} data-testid={`badge-status-${status}`}>
      {labels[status] || status}
    </Badge>
  );
}

export { StatusBadge };
