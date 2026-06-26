import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Mail, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { EmailLog } from "@shared/schema";

export default function EmailLogs() {
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const { toast } = useToast();

  function copyReplyTo(id: number, address: string) {
    navigator.clipboard.writeText(address).then(() => {
      setCopiedId(id);
      toast({ title: "Copied", description: address });
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    });
  }

  const { data: logs = [], isLoading } = useQuery<EmailLog[]>({ queryKey: ["/api/email-logs"] });

  const filtered = logs.filter((log) => {
    const term = search.toLowerCase();
    return (
      (log.customerName || "").toLowerCase().includes(term) ||
      log.toEmail.toLowerCase().includes(term) ||
      log.subject.toLowerCase().includes(term) ||
      (log.fromEmail || "").toLowerCase().includes(term) ||
      (log.replyTo || "").toLowerCase().includes(term)
    );
  });

  const columns: Column<EmailLog>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <span className="text-sm" data-testid={`text-email-date-${row.id}`}>
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm" data-testid={`text-email-customer-${row.id}`}>{row.customerName || "-"}</p>
            <p className="text-xs text-muted-foreground" data-testid={`text-email-to-${row.id}`}>{row.toEmail}</p>
          </div>
        </div>
      ),
    },
    {
      key: "subject",
      header: "Subject",
      cell: (row) => <span className="text-sm" data-testid={`text-email-subject-${row.id}`}>{row.subject}</span>,
    },
    {
      key: "from",
      header: "From",
      cell: (row) => (
        <span className="text-sm text-muted-foreground" data-testid={`text-email-from-${row.id}`}>
          {row.fromEmail || "—"}
        </span>
      ),
    },
    {
      key: "replyTo",
      header: "Reply-To",
      cell: (row) =>
        row.replyTo ? (
          <button
            onClick={() => copyReplyTo(row.id, row.replyTo!)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
            data-testid={`button-copy-replyto-${row.id}`}
            title="Click to copy"
          >
            <span data-testid={`text-email-replyto-${row.id}`}>{row.replyTo}</span>
            {copiedId === row.id ? (
              <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
            ) : (
              <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </button>
        ) : null,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <Badge variant={row.status === "sent" ? "default" : "destructive"} data-testid={`badge-email-status-${row.id}`}>
          {row.status === "sent" ? "Sent" : "Failed"}
        </Badge>
      ),
    },
    {
      key: "error",
      header: "Details",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">{row.errorMessage || "-"}</span>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Email Log"
        description="All emails sent to customers"
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by customer, email, subject, from, or reply-to..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-email-logs"
            />
          </div>
          <DataTable columns={columns} data={filtered} isLoading={isLoading} emptyMessage="No emails sent yet" />
        </CardContent>
      </Card>
    </div>
  );
}
