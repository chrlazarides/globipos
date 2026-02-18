import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Users, FileText, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { Invoice, Customer, Item } from "@shared/schema";

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<{
    totalItems: number;
    totalCustomers: number;
    totalInvoices: number;
    totalRevenue: string;
    lowStockItems: Item[];
    recentInvoices: (Invoice & { customerName: string })[];
    overdueInvoices: number;
  }>({ queryKey: ["/api/dashboard/stats"] });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader title="Dashboard" description="Overview of your wholesale operations" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const s = stats || { totalItems: 0, totalCustomers: 0, totalInvoices: 0, totalRevenue: "0.00", lowStockItems: [], recentInvoices: [], overdueInvoices: 0 };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your wholesale operations"
        action={
          <Link href="/invoices/new">
            <Button data-testid="button-new-invoice">New Invoice</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Items" value={String(s.totalItems)} icon={Package} description="Active products" />
        <StatCard title="Customers" value={String(s.totalCustomers)} icon={Users} description="Active accounts" />
        <StatCard title="Invoices" value={String(s.totalInvoices)} icon={FileText} description={`${s.overdueInvoices} overdue`} />
        <StatCard title="Revenue" value={`$${parseFloat(s.totalRevenue).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} icon={DollarSign} />
      </div>

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
                        <p className="text-xs text-muted-foreground">{inv.customerName}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">${parseFloat(inv.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
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
                    <Badge variant="secondary" className="shrink-0">
                      {item.stockQuantity} left
                    </Badge>
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
    overdue: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <Badge variant="outline" className={`text-xs ${variants[status] || ""}`} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

export { StatusBadge };
