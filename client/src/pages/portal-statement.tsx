import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Customer } from "@shared/schema";

interface PortalStatementProps {
  customer: Customer;
}

export default function PortalStatement({ customer }: PortalStatementProps) {
  const { data: invoices, isLoading: loadingInvoices } = useQuery<any[]>({
    queryKey: ["/api/portal/customer", customer.id, "invoices"],
  });

  const { data: statement, isLoading: loadingStatement } = useQuery<any>({
    queryKey: ["/api/portal/customer", customer.id, "statement"],
  });

  const fmt = (v: string | number) =>
    `€${parseFloat(String(v || 0)).toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  const typeLabel = (type: string) => {
    switch (type) {
      case "invoice": return "Invoice";
      case "credit_note": return "Credit Note";
      case "proforma": return "Proforma";
      default: return type;
    }
  };

  const typeVariant = (type: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (type) {
      case "invoice": return "default";
      case "credit_note": return "destructive";
      case "proforma": return "outline";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-portal-invoices-title">Invoices & Statement</h1>
        <p className="text-sm text-muted-foreground mt-1">View your invoices and account statement</p>
      </div>

      {loadingStatement ? (
        <Skeleton className="h-24" />
      ) : statement && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Invoiced</p>
              <p className="text-xl font-bold mt-1" data-testid="stat-statement-invoiced">{fmt(statement.totalInvoiced)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Paid</p>
              <p className="text-xl font-bold mt-1" data-testid="stat-statement-paid">{fmt(statement.totalPaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Balance Due</p>
              <p className="text-xl font-bold mt-1" data-testid="stat-statement-balance">{fmt(statement.balance)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="p-4 pb-2">
          <h3 className="text-sm font-semibold">Invoice History</h3>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loadingInvoices ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : !invoices || invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No invoices found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0" data-testid={`row-invoice-${inv.id}`}>
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium text-sm">{inv.invoiceNumber}</span>
                    <Badge variant={typeVariant(inv.type)} className="text-xs">{typeLabel(inv.type)}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDate(inv.date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={inv.status === "paid" ? "default" : inv.status === "overdue" ? "destructive" : "secondary"} className="text-xs">
                      {inv.status}
                    </Badge>
                    <span className="font-semibold text-sm" data-testid={`text-invoice-total-${inv.id}`}>{fmt(inv.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
