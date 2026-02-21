import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, FileText, WifiOff, Wifi, Loader2, Trash2 } from "lucide-react";
import { StatusBadge } from "./dashboard";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { offlineStore } from "@/lib/offline-store";
import type { Invoice, Customer } from "@shared/schema";

interface InvoiceWithCustomer extends Invoice {
  customerName: string;
}

export default function Invoices({ docType = "invoice" }: { docType?: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [, navigate] = useLocation();
  const { isOnline, pendingCount, syncing, syncPending, refreshPendingCount } = useOnlineStatus();
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);

  useEffect(() => {
    offlineStore.getPendingInvoices().then(p => setPendingInvoices(p)).catch(() => {});
  }, [pendingCount]);

  const discardPending = async (offlineId: string) => {
    await offlineStore.removePendingInvoice(offlineId);
    await refreshPendingCount();
  };

  const { data: invoices = [], isLoading } = useQuery<InvoiceWithCustomer[]>({
    queryKey: ["/api/invoices/type", docType],
  });

  const typeLabel: Record<string, string> = {
    invoice: "Invoices",
    credit_note: "Credit Notes",
    proforma: "Proforma Invoices",
    quotation: "Quotations",
  };

  const filtered = invoices.filter((inv) => {
    const matchSearch = inv.invoiceNumber.toLowerCase().includes(search.toLowerCase()) || inv.customerName?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const columns: Column<InvoiceWithCustomer>[] = [
    {
      key: "number",
      header: "Number",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{row.invoiceNumber}</p>
            <p className="text-xs text-muted-foreground">{new Date(row.date).toLocaleDateString()}</p>
          </div>
        </div>
      ),
    },
    { key: "customer", header: "Customer", cell: (row) => <span className="text-sm">{row.customerName}</span> },
    {
      key: "dueDate",
      header: "Due Date",
      cell: (row) => <span className="text-sm">{row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "-"}</span>,
    },
    {
      key: "total",
      header: "Total",
      cell: (row) => <span className="text-sm font-medium">€{parseFloat(row.total).toLocaleString("el-CY", { minimumFractionDigits: 2 })}</span>,
      className: "text-right",
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      {!isOnline && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800" data-testid="offline-banner-list">
          <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-sm text-amber-700 dark:text-amber-300 font-medium">You are offline.</span>
          <span className="text-xs text-amber-600 dark:text-amber-400">You can still create invoices &mdash; they will sync when you reconnect.</span>
        </div>
      )}
      <PageHeader
        title={typeLabel[docType] || "Invoices"}
        description={`Manage your ${(typeLabel[docType] || "invoices").toLowerCase()}`}
        action={
          <Link href={`/invoices/new?type=${docType}`}>
            <Button data-testid="button-new-invoice">
              <Plus className="w-4 h-4 mr-1" /> New {docType === "credit_note" ? "Credit Note" : docType === "proforma" ? "Proforma" : docType === "quotation" ? "Quotation" : "Invoice"}
            </Button>
          </Link>
        }
      />

      {pendingInvoices.length > 0 && docType === "invoice" && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium">Pending Offline Invoices ({pendingInvoices.length})</span>
              </div>
              {isOnline && (
                <Button size="sm" variant="outline" onClick={syncPending} disabled={syncing} data-testid="button-sync-all">
                  {syncing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Wifi className="w-3 h-3 mr-1" />}
                  {syncing ? "Syncing..." : "Sync All"}
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {pendingInvoices.map((inv: any) => (
                <div key={inv.offlineId} className="flex items-center justify-between p-3 rounded-md border bg-muted/30" data-testid={`pending-invoice-${inv.offlineId}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-amber-100 dark:bg-amber-900">
                      <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{inv.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(inv.createdAt).toLocaleString()} &mdash; €{parseFloat(inv.payload?.total || "0").toFixed(2)}
                        {inv.payload?.items?.length && ` (${inv.payload.items.length} item${inv.payload.items.length > 1 ? "s" : ""})`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => discardPending(inv.offlineId)} data-testid={`button-discard-${inv.offlineId}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-invoices" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-status-filter">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="No invoices found" onRowClick={(inv) => navigate(`/invoices/${inv.id}`)} />
        </CardContent>
      </Card>
    </div>
  );
}
