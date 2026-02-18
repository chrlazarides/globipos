import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, FileText, Receipt, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { usePriceLevels } from "@/hooks/use-price-levels";
import type { Customer } from "@shared/schema";

interface PortalDashboardProps {
  customer: Customer;
}

export default function PortalDashboard({ customer }: PortalDashboardProps) {
  const priceLevelNames = usePriceLevels();
  const { data: statement, isLoading: loadingStatement } = useQuery<any>({
    queryKey: ["/api/portal/customer", customer.id, "statement"],
  });

  const { data: orders, isLoading: loadingOrders } = useQuery<any[]>({
    queryKey: ["/api/portal/customer", customer.id, "orders"],
  });

  const { data: invoices, isLoading: loadingInvoices } = useQuery<any[]>({
    queryKey: ["/api/portal/customer", customer.id, "invoices"],
  });

  const fmt = (v: string | number) =>
    `€${parseFloat(String(v || 0)).toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-portal-welcome">Welcome, {customer.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">Your account overview and recent activity</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loadingStatement ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Account Balance</p>
                    <p className="text-2xl font-bold mt-1" data-testid="stat-portal-balance">{fmt(statement?.balance || customer.currentBalance)}</p>
                  </div>
                  <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                    <CreditCard className="w-4 h-4 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Invoiced</p>
                    <p className="text-2xl font-bold mt-1" data-testid="stat-portal-invoiced">{fmt(statement?.totalInvoiced || 0)}</p>
                  </div>
                  <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Paid</p>
                    <p className="text-2xl font-bold mt-1" data-testid="stat-portal-paid">{fmt(statement?.totalPaid || 0)}</p>
                  </div>
                  <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                    <TrendingUp className="w-4 h-4 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Orders</p>
                    <p className="text-2xl font-bold mt-1" data-testid="stat-portal-pending">
                      {loadingOrders ? "..." : (orders?.filter((o: any) => o.status === "pending").length || 0)}
                    </p>
                  </div>
                  <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                    <Receipt className="w-4 h-4 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <h3 className="text-sm font-semibold">Account Details</h3>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <div className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Customer Code</span>
              <span className="font-medium" data-testid="text-portal-code">{customer.code}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Payment Terms</span>
              <span className="font-medium">{customer.paymentTerms}</span>
            </div>
            <div className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Price Level</span>
              <span className="font-medium">{priceLevelNames[customer.priceLevel - 1] || `Level ${customer.priceLevel}`}</span>
            </div>
            {customer.email && (
              <div className="flex justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{customer.email}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Phone</span>
                <span className="font-medium">{customer.phone}</span>
              </div>
            )}
            <div className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Credit Limit</span>
              <span className="font-medium">{fmt(customer.creditLimit)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 p-4">
            <h3 className="text-sm font-semibold">Recent Invoices</h3>
            <Link href="/portal/invoices">
              <Button variant="ghost" size="sm" data-testid="link-portal-view-invoices">View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loadingInvoices ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
              </div>
            ) : invoices && invoices.length > 0 ? (
              <div className="space-y-2">
                {invoices.slice(0, 5).map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 text-sm">
                    <div>
                      <span className="font-medium">{inv.invoiceNumber}</span>
                      <span className="text-muted-foreground ml-2">{inv.type}</span>
                    </div>
                    <span className="font-medium">{fmt(inv.total)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/portal/shop">
          <Button data-testid="button-portal-browse-shop">Browse Shop</Button>
        </Link>
        <Link href="/portal/assistant">
          <Button variant="outline" data-testid="button-portal-order-assistant">Order Assistant</Button>
        </Link>
      </div>
    </div>
  );
}
