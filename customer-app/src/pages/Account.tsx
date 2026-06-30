import { useQuery } from "@tanstack/react-query";
import { type CustomerSession } from "../lib/auth";
import { CreditCard, FileText, TrendingUp, AlertTriangle } from "lucide-react";

interface AccountProps { customer: CustomerSession; }

function fmt(v: string | number) {
  return `€${parseFloat(String(v || 0)).toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function statusColor(s: string) {
  if (s === "overdue") return "text-red-600 dark:text-red-400";
  if (s === "paid") return "text-green-600 dark:text-green-400";
  return "text-[hsl(var(--muted-foreground))]";
}

export default function Account({ customer }: AccountProps) {
  const { data: summary, isLoading: loadSum } = useQuery<any>({ queryKey: ["/api/customer/account-summary"] });
  const { data: invoices = [], isLoading: loadInv } = useQuery<any[]>({ queryKey: ["/api/customer/invoices"] });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">My Account</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{customer.name} · {customer.code}</p>
      </div>

      {/* Account summary */}
      {loadSum ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />)}
        </div>
      ) : summary && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Balance Due</p>
              <p className="text-lg font-bold mt-0.5" data-testid="stat-account-balance">{fmt(summary.balance)}</p>
            </div>
            <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Credit Available</p>
              <p className="text-lg font-bold mt-0.5" data-testid="stat-account-credit">{fmt(summary.availableCredit)}</p>
            </div>
            <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-3">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Credit Limit</p>
              <p className="text-lg font-bold mt-0.5">{fmt(summary.creditLimit)}</p>
            </div>
            <div className={`bg-[hsl(var(--card))] border rounded-xl p-3 ${summary.overdueCount > 0 ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20" : "border-[hsl(var(--border))]"}`}>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Overdue</p>
              <p className={`text-lg font-bold mt-0.5 ${summary.overdueCount > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="stat-account-overdue">
                {summary.overdueCount > 0 ? fmt(summary.overdueAmount) : "None"}
              </p>
            </div>
          </div>

          {/* Credit utilisation bar */}
          {parseFloat(String(summary.creditLimit)) > 0 && (
            <div>
              <div className="flex justify-between text-xs text-[hsl(var(--muted-foreground))] mb-1">
                <span>Credit used</span>
                <span>{Math.round((parseFloat(summary.balance) / parseFloat(summary.creditLimit)) * 100)}%</span>
              </div>
              <div className="w-full bg-[hsl(var(--muted))] rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${parseFloat(summary.balance) / parseFloat(summary.creditLimit) > 0.8 ? "bg-red-500" : "bg-[hsl(var(--primary))]"}`}
                  style={{ width: `${Math.min(100, (parseFloat(summary.balance) / parseFloat(summary.creditLimit)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-lg p-2.5">
            Payment terms: <span className="font-medium">{summary.paymentTerms}</span>
            &ensp;·&ensp;Loyalty points: <span className="font-medium">{Number(summary.loyaltyPoints).toLocaleString()}</span>
          </div>
        </>
      )}

      {/* Invoices */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Invoices</h2>
        {loadInv ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
          </div>
        ) : !invoices.length ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))] py-4 text-center">No invoices yet</p>
        ) : (
          <div className="divide-y divide-[hsl(var(--border))] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
            {invoices.slice(0, 20).map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between px-3 py-2.5 gap-2" data-testid={`row-invoice-${inv.id}`}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{inv.invoiceNumber}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{formatDate(inv.date)} · {inv.type}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-bold">{fmt(inv.total)}</p>
                  <p className={`text-[10px] font-medium capitalize ${statusColor(inv.status)}`}>{inv.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
