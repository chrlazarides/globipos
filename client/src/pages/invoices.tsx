import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, FileText } from "lucide-react";
import { StatusBadge } from "./dashboard";
import type { Invoice, Customer } from "@shared/schema";

interface InvoiceWithCustomer extends Invoice {
  customerName: string;
}

export default function Invoices({ docType = "invoice" }: { docType?: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [, navigate] = useLocation();

  const { data: invoices = [], isLoading } = useQuery<InvoiceWithCustomer[]>({
    queryKey: ["/api/invoices/type", docType],
  });

  const typeLabel: Record<string, string> = {
    invoice: "Invoices",
    credit_note: "Credit Notes",
    proforma: "Proforma Invoices",
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
      cell: (row) => <span className="text-sm font-medium">${parseFloat(row.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>,
      className: "text-right",
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={typeLabel[docType] || "Invoices"}
        description={`Manage your ${(typeLabel[docType] || "invoices").toLowerCase()}`}
        action={
          <Link href={`/invoices/new?type=${docType}`}>
            <Button data-testid="button-new-invoice">
              <Plus className="w-4 h-4 mr-1" /> New {docType === "credit_note" ? "Credit Note" : docType === "proforma" ? "Proforma" : "Invoice"}
            </Button>
          </Link>
        }
      />

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
