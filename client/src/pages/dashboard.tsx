import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Users, FileText, Euro, AlertTriangle, TrendingUp, BarChart3, GitFork } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, ComposedChart, Line, ReferenceLine, Legend, Area,
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
const CASH_COLOR    = "#0ea5e9";

const EOMDot = (props: any) => {
  const { cx, cy, value } = props;
  if (!cx || !cy || !value) return null;
  const s = 5;
  return (
    <polygon
      points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
      fill={REVENUE_COLOR}
      stroke="white"
      strokeWidth={1.5}
    />
  );
};

const MonthlyTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const rev = payload.find((p: any) => p.dataKey === "revenue")?.value ?? 0;
  const profit = payload.find((p: any) => p.dataKey === "profit")?.value ?? 0;
  const inv = payload.find((p: any) => p.dataKey === "invoices")?.value ?? 0;
  const netCash = payload.find((p: any) => p.dataKey === "netCash")?.value ?? 0;
  const margin = rev > 0 ? ((profit / rev) * 100).toFixed(1) : "—";
  const avgInv = rev > 0 && inv > 0 ? (rev / inv).toFixed(0) : "—";
  const fmt = (v: number) => `€${v.toLocaleString("el-CY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 shadow-lg text-xs space-y-1.5 min-w-[190px]">
      <p className="font-semibold text-sm border-b border-slate-100 dark:border-slate-700 pb-1.5 mb-1.5 flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
        {label} · End of Month
      </p>
      <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-2 h-2 rounded-full inline-block" style={{ background: REVENUE_COLOR }} />Revenue</span><span className="font-mono font-semibold">{fmt(rev)}</span></div>
      <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-2 h-2 rounded-full inline-block" style={{ background: PROFIT_COLOR }} />Profit</span><span className={`font-mono font-semibold ${profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{fmt(profit)}</span></div>
      <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-2 h-2 rounded-full inline-block" style={{ background: CASH_COLOR }} />Net Cash</span><span className={`font-mono font-semibold ${netCash >= 0 ? "text-sky-600 dark:text-sky-400" : "text-red-500"}`}>{fmt(netCash)}</span></div>
      <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><span className="w-2 h-2 rounded-full inline-block bg-amber-400" />Invoices</span><span className="font-mono font-semibold">{inv}</span></div>
      <div className="border-t border-slate-100 dark:border-slate-700 pt-1.5 mt-1 space-y-1">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Margin</span><span className={`font-semibold ${parseFloat(margin) >= 15 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{margin !== "—" ? `${margin}%` : "—"}</span></div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Avg / Invoice</span><span className="font-mono">{avgInv !== "—" ? `€${avgInv}` : "—"}</span></div>
      </div>
    </div>
  );
};

export default function Dashboard() {
  const { data: settings = [] } = useQuery<SystemSetting[]>({ queryKey: ["/api/settings"] });
  const companyName = settings.find(s => s.key === "company_name")?.value || "Mediterranean Fine Foods";

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
    monthlySales: { month: string; endDate: string; revenue: number; profit: number; invoices: number; cashIn: number; cashOut: number; netCash: number }[];
    topCustomers: { name: string; revenue: number }[];
    invoiceStatus: { status: string; count: number; amount: number }[];
    paretoCustomers: { name: string; revenue: number; cumPct: number }[];
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
  const c = charts || { monthlySales: [], topCustomers: [], invoiceStatus: [], paretoCustomers: [] };

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

      {/* Main Chart — Sales & Profit (multi-dimensional) */}
      {(() => {
        const activeMonths = c.monthlySales.filter(m => m.revenue > 0 || m.invoices > 0);
        const avgRevenue = activeMonths.length > 0
          ? Math.round(activeMonths.reduce((s, m) => s + m.revenue, 0) / activeMonths.length)
          : 0;
        const maxInvoices = Math.max(...c.monthlySales.map(m => m.invoices), 1);
        const hasData = c.monthlySales.some(m => m.revenue > 0);
        const now = new Date();
        const currentLabel = now.toLocaleString("en-GB", { month: "short", year: "2-digit" });
        const fmtEndDate = (iso: string) => {
          const d = new Date(iso + "T00:00:00");
          const day = d.getDate();
          const mon = d.toLocaleString("en-GB", { month: "short" });
          return `${day} ${mon}`;
        };
        const enriched = c.monthlySales.map(m => ({
          ...m,
          isCurrent: m.month === currentLabel,
          marginPct: m.revenue > 0 ? parseFloat(((m.profit / m.revenue) * 100).toFixed(1)) : 0,
          eomLabel: m.endDate ? fmtEndDate(m.endDate) : m.month,
        }));
        return (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-primary" />
                    Sales &amp; Profit — Last 6 Months
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Avg margin: <span className="font-semibold">{avgMargin}%</span>
                    {avgRevenue > 0 && <> · Avg monthly revenue: <span className="font-semibold">€{avgRevenue.toLocaleString()}</span></>}
                    {" "}· <span className="italic">◆ markers = end of month</span>
                  </p>
                </div>
                <div className="hidden sm:flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: REVENUE_COLOR, opacity: 0.4 }} />Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 inline-block rounded-full" style={{ background: PROFIT_COLOR }} />Gross Profit</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-0.5 inline-block rounded-full" style={{ background: CASH_COLOR }} />Net Cash</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block bg-amber-400" />Invoice Count</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-1">
              {chartsLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : !hasData ? (
                <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No sales data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={enriched} margin={{ top: 12, right: 52, left: 4, bottom: 0 }} barCategoryGap="40%">
                    <defs>
                      <linearGradient id="areaRevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={REVENUE_COLOR} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={REVENUE_COLOR} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="barProfGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#059669" stopOpacity={0.8} />
                      </linearGradient>
                    </defs>

                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />

                    <XAxis
                      dataKey="eomLabel"
                      tick={({ x, y, payload, index }: any) => {
                        const item = enriched[index];
                        const isCur = item?.isCurrent;
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text x={0} y={0} dy={14} textAnchor="middle" fill={isCur ? REVENUE_COLOR : "#94a3b8"} fontSize={10.5} fontWeight={isCur ? 700 : 400}>
                              {payload.value}{isCur ? " *" : ""}
                            </text>
                          </g>
                        );
                      }}
                      tickLine={false}
                      axisLine={false}
                      height={28}
                    />

                    {/* Left Y-axis — revenue / profit in € */}
                    <YAxis
                      yAxisId="left"
                      tickFormatter={v => `€${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />

                    {/* Right Y-axis — invoice count */}
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tickFormatter={v => `${v}`}
                      tick={{ fontSize: 10, fill: "#f59e0b" }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                      domain={[0, maxInvoices + Math.ceil(maxInvoices * 0.2)]}
                    />

                    <Tooltip content={<MonthlyTooltip />} cursor={{ fill: "rgba(99,102,241,0.05)" }} />

                    {/* Average revenue reference line */}
                    {avgRevenue > 0 && (
                      <ReferenceLine
                        yAxisId="left"
                        y={avgRevenue}
                        stroke={REVENUE_COLOR}
                        strokeDasharray="5 3"
                        strokeOpacity={0.45}
                        label={{ value: "Avg", position: "insideTopLeft", fontSize: 9, fill: REVENUE_COLOR, opacity: 0.7 }}
                      />
                    )}

                    {/* Revenue — filled area */}
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue (ex-VAT)"
                      stroke={REVENUE_COLOR}
                      strokeWidth={2}
                      fill="url(#areaRevGrad)"
                      dot={<EOMDot />}
                      activeDot={{ r: 6, fill: REVENUE_COLOR, stroke: "white", strokeWidth: 2 }}
                    />

                    {/* Gross Profit — continuous line */}
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="profit"
                      name="Gross Profit"
                      stroke={PROFIT_COLOR}
                      strokeWidth={2}
                      dot={{ r: 3.5, fill: PROFIT_COLOR, stroke: "white", strokeWidth: 1.5 }}
                      activeDot={{ r: 6, fill: PROFIT_COLOR, stroke: "white", strokeWidth: 2 }}
                    />

                    {/* Net Cash Flow — sky blue line */}
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="netCash"
                      name="Net Cash"
                      stroke={CASH_COLOR}
                      strokeWidth={2}
                      strokeDasharray="6 2"
                      dot={{ r: 3.5, fill: CASH_COLOR, stroke: "white", strokeWidth: 1.5 }}
                      activeDot={{ r: 6, fill: CASH_COLOR, stroke: "white", strokeWidth: 2 }}
                    />

                    {/* Invoice count — secondary line */}
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="invoices"
                      name="Invoices"
                      stroke="#f59e0b"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={{ r: 3.5, fill: "#f59e0b", stroke: "#f59e0b", strokeWidth: 1 }}
                      activeDot={{ r: 5, fill: "#f59e0b", stroke: "white", strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
              {hasData && (
                <p className="text-[10px] text-muted-foreground mt-1 text-right pr-1">
                  * current month (partial) · ◆ end-of-month · dashed = avg revenue · amber line = invoice count (right axis)
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

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

      {/* Pareto Chart — Customer Revenue Concentration */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <GitFork className="w-4 h-4 text-primary" />
              Customer Revenue Pareto
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customers sorted by revenue — orange line shows cumulative % · 80% threshold marked
            </p>
          </div>
          {c.paretoCustomers.length > 0 && (() => {
            const eightyIdx = c.paretoCustomers.findIndex(p => p.cumPct >= 80);
            const count = eightyIdx >= 0 ? eightyIdx + 1 : c.paretoCustomers.length;
            const pct = Math.round(count / c.paretoCustomers.length * 100);
            return (
              <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{count} of {c.paretoCustomers.length} customers</span>
                <span>drive 80% of revenue ({pct}% of base)</span>
              </div>
            );
          })()}
        </CardHeader>
        <CardContent className="pt-2">
          {chartsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : c.paretoCustomers.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No revenue data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={c.paretoCustomers} margin={{ top: 8, right: 48, left: 8, bottom: 20 }}>
                <defs>
                  <linearGradient id="gradPareto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                  height={50}
                />
                <YAxis
                  yAxisId="revenue"
                  orientation="left"
                  tickFormatter={v => `€${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  domain={[0, 100]}
                  tickFormatter={v => `${v}%`}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const rev = payload.find(p => p.dataKey === "revenue");
                    const cum = payload.find(p => p.dataKey === "cumPct");
                    return (
                      <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
                        <p className="font-semibold text-sm">{label}</p>
                        {rev && <p className="text-muted-foreground">Revenue: <span className="font-medium text-foreground">{fmtEur(Number(rev.value))}</span></p>}
                        {cum && <p className="text-muted-foreground">Cumulative: <span className="font-medium text-foreground">{cum.value}%</span></p>}
                      </div>
                    );
                  }}
                />
                <ReferenceLine yAxisId="pct" y={80} stroke="#f59e0b" strokeDasharray="5 3" strokeWidth={1.5}
                  label={{ value: "80%", position: "right", fontSize: 10, fill: "#f59e0b" }}
                />
                <Bar yAxisId="revenue" dataKey="revenue" name="Revenue" fill="url(#gradPareto)" radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="cumPct"
                  name="Cumulative %"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#f97316", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

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
