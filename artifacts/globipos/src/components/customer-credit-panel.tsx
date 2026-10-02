import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/App";

export type CreditStatus = "pending" | "approved" | "suspended";
export interface CustomerCredit {
  approvalStatus: CreditStatus;
  limitCents: number;
  balanceCents: number;
  availableCents: number;
  paymentTerms: string;
  overdueCents: number;
  hasOverdue: boolean;
  history?: { id: string; createdAt: string; actorName: string; previous: unknown; next: unknown }[];
}

export const CREDIT_TERMS = ["cash", "credit_7", "credit_14", "credit_30", "credit_60", "credit_90"];
export const termsText = (t: string) => (t === "cash" ? "Cash" : /^credit_(\d+)$/.test(t) ? `${t.slice(7)} days` : t);
const eur = (cents: number) => `€${(cents / 100).toLocaleString("el-CY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Validates a currency amount typed by the admin. Returns the normalized "12.50" string or null. */
export function normalizeCreditLimit(value: string): string | null {
  const v = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(v)) return null;
  return Number(v).toFixed(2);
}

function describe(v: unknown): string {
  if (!v || typeof v !== "object") return v == null ? "-" : String(v);
  const o = v as Record<string, unknown>;
  return Object.entries(o).map(([k, val]) => `${k}: ${String(val)}`).join(", ");
}

export function CustomerCreditPanel({ customerId, open }: { customerId: string; open: boolean }) {
  const { user } = useAuth();
  const canApprove = !!user && (user.role === "admin" || user.role === "superuser" ||
    (user.role === "staff" && !!user.permissions?.includes("customer_credit_approve")));
  const { toast } = useToast();
  const key = ["/api/customer-credit", customerId];
  const { data, isLoading, error, refetch } = useQuery<CustomerCredit>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/customer-credit/${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Failed to load credit (${res.status})`);
      return res.json();
    },
    enabled: open,
  });
  const [status, setStatus] = useState<CreditStatus>("pending");
  const [limit, setLimit] = useState("0.00");
  const [terms, setTerms] = useState("cash");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!data) return;
    setStatus(data.approvalStatus);
    setLimit((data.limitCents / 100).toFixed(2));
    setTerms(data.paymentTerms);
    setReason("");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const creditLimit = normalizeCreditLimit(limit);
      if (!creditLimit) throw new Error("Enter the credit limit as an amount such as 1500.00");
      if (!reason.trim()) throw new Error("A reason is required for every credit change.");
      const res = await apiRequest("PUT", `/api/customer-credit/${customerId}`, { approvalStatus: status, creditLimit, paymentTerms: terms, reason: reason.trim() });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: key }); queryClient.invalidateQueries({ queryKey: ["/api/customers"] }); toast({ title: "Credit terms saved" }); },
    onError: (e: Error) => toast({ title: "Credit not saved", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error || !data) {
    return (
      <div className="py-8 text-center space-y-3" data-testid="credit-error">
        <p className="text-sm text-destructive">{(error as Error | null)?.message || "Credit unavailable."}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-credit-retry">Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="customer-credit-panel">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Limit", eur(data.limitCents)], ["Owed", eur(data.balanceCents)], ["Available", eur(data.availableCents)], ["Terms", termsText(data.paymentTerms)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="text-sm font-bold" data-testid={`text-credit-${l.toLowerCase()}`}>{v}</p>
          </div>
        ))}
      </div>
      {data.hasOverdue && (
        <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" data-testid="credit-overdue">
          <AlertTriangle className="w-4 h-4" /> Overdue {eur(data.overdueCents)}. Overdue debt warns the cashier but does not block sales.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Approval</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as CreditStatus)} disabled={!canApprove}>
            <SelectTrigger data-testid="select-credit-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Credit limit (EUR)</Label>
          <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} data-testid="input-credit-limit" />
        </div>
        <div className="space-y-1.5">
          <Label>Payment terms</Label>
          <Select value={terms} onValueChange={setTerms}>
            <SelectTrigger data-testid="select-credit-terms"><SelectValue /></SelectTrigger>
            <SelectContent>{CREDIT_TERMS.map((t) => <SelectItem key={t} value={t}>{termsText(t)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Reason for change</Label>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Recorded in the audit history" data-testid="input-credit-reason" />
      </div>
      <p className="text-xs text-muted-foreground">Only administrators and staff with the credit approval permission can save changes.</p>
      <Button onClick={() => save.mutate()} disabled={!canApprove || save.isPending} data-testid="button-save-credit">{save.isPending ? "Saving..." : "Save credit terms"}</Button>

      <div>
        <h4 className="text-sm font-semibold mb-2">History</h4>
        {!data.history?.length ? (
          <p className="text-sm text-muted-foreground" data-testid="credit-history-empty">No credit changes recorded yet.</p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {data.history.map((h) => (
              <li key={h.id} className="rounded-md border p-2 text-xs" data-testid={`credit-history-${h.id}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{h.actorName}</span>
                  <Badge variant="outline">{new Date(h.createdAt).toLocaleString()}</Badge>
                </div>
                <p className="text-muted-foreground mt-1">From: {describe(h.previous)}</p>
                <p className="mt-0.5">To: {describe(h.next)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
