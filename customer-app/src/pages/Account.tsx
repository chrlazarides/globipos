import { useQuery } from "@tanstack/react-query";
import { type CustomerSession, getToken } from "../lib/auth";
import { CreditCard, FileText, ExternalLink, AlertTriangle } from "lucide-react";

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
function agingBucket(dueDate: string | null): string {
  if (!dueDate) return "Current";
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  if (days <= 0) return "Current";
  if (days <= 30) return "1–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
}

export default function Account({ customer }: AccountProps) {
  const { data: summary, isLoading: loadSum } = useQuery<any>({ queryKey: ["/api/customer/account-summary"] });
  const { data: invoices = [], isLoading: loadInv } = useQuery<any[]>({ queryKey: ["/api/customer/invoices"] });
  const { data: statement, isLoading: loadStmt } = useQuery<any>({ queryKey: ["/api/customer/statement"] });

  const token = getToken();

  // Build aging buckets from statement data
  const aging: Record<string, number> = {};
  if (statement?.invoices) {
    for (const inv of statement.invoices) {
      if (inv.balance > 0) {
        const bucket = agingBucket(inv.dueDate);
        aging[bucket] = (aging[bucket] || 0) + parseFloat(inv.balance);
      }
    }
  }
  const agingBuckets = ["Current", "1–30 days", "31–60 days", "61–90 days", "90+ days"].filter(b => aging[b] > 0);

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

      {/* Aging analysis */}
      {!loadStmt && agingBuckets.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            Outstanding Balance Aging
          </h2>
          <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
            <table className="w-full text-sm" data-testid="table-aging">
              <thead className="bg-[hsl(var(--muted))]">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">Period</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {agingBuckets.map((bucket) => (
                  <tr key={bucket} data-testid={`row-aging-${bucket.replace(/\s+/g, "-").toLowerCase()}`}>
                    <td className="px-3 py-2 text-xs">{bucket}</td>
                    <td className={`px-3 py-2 text-xs font-bold text-right ${bucket !== "Current" ? "text-orange-600 dark:text-orange-400" : ""}`}>
                      {fmt(aging[bucket])}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[hsl(var(--muted))]">
                  <td className="px-3 py-2 text-xs font-semibold">Total Outstanding</td>
                  <td className="px-3 py-2 text-xs font-bold text-right">
                    {fmt(Object.values(aging).reduce((s, v) => s + v, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs font-bold">{fmt(inv.total)}</p>
                    <p className={`text-[10px] font-medium capitalize ${statusColor(inv.status)}`}>{inv.status}</p>
                  </div>
                  {token && (
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/customer/invoices/${inv.id}/pdf`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        if (!res.ok) return;
                        const html = await res.text();
                        const win = window.open("", "_blank");
                        if (win) { win.document.write(html); win.document.close(); }
                      }}
                      className="flex-shrink-0 p-1.5 rounded-md hover:bg-[hsl(var(--muted))] transition-colors"
                      title="View PDF"
                      data-testid={`link-invoice-pdf-${inv.id}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Statement — due date listing */}
      {!loadStmt && statement?.invoices?.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <FileText className="w-4 h-4" />
            Statement
          </h2>
          <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl overflow-hidden">
            <table className="w-full text-xs" data-testid="table-statement">
              <thead className="bg-[hsl(var(--muted))]">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-[hsl(var(--muted-foreground))]">Invoice</th>
                  <th className="text-left px-3 py-2 font-semibold text-[hsl(var(--muted-foreground))] hidden sm:table-cell">Due</th>
                  <th className="text-right px-3 py-2 font-semibold text-[hsl(var(--muted-foreground))]">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {statement.invoices
                  .filter((inv: any) => parseFloat(inv.balance || 0) !== 0)
                  .slice(0, 15)
                  .map((inv: any) => {
                    const overdue = inv.dueDate && new Date(inv.dueDate) < new Date() && parseFloat(inv.balance) > 0;
                    return (
                      <tr key={inv.id} data-testid={`row-stmt-${inv.id}`}>
                        <td className="px-3 py-2">
                          <span className="font-medium">{inv.invoiceNumber}</span>
                          <span className="text-[hsl(var(--muted-foreground))] ml-1.5">{formatDate(inv.date)}</span>
                        </td>
                        <td className={`px-3 py-2 hidden sm:table-cell ${overdue ? "text-red-600 dark:text-red-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}`}>
                          {inv.dueDate ? formatDate(inv.dueDate) : "—"}
                          {overdue && <span className="ml-1 text-[10px]">(overdue)</span>}
                        </td>
                        <td className={`px-3 py-2 text-right font-bold ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                          {fmt(inv.balance)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
