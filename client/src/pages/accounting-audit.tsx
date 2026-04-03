import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CheckCircle2,
  XCircle,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  BookOpen,
  ShieldCheck,
  Filter,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────
interface AuditLine {
  id: string;
  journalEntryId: string;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  accountType: string | null;
  debit: string;
  credit: string;
  description: string | null;
}

interface AuditEntry {
  id: string;
  entryNumber: string;
  date: string;
  description: string | null;
  reference: string | null;
  sourceType: string;
  sourceId: string | null;
  status: string;
  totalAmount: string;
  lines: AuditLine[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

// ─── Data Dictionary ───────────────────────────────────────────────────────
const DATA_DICTIONARY = [
  {
    type: "invoice",
    label: "Sales Invoice",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    debitAccounts: "1100 – Accounts Receivable",
    creditAccounts: "4000 – Sales Revenue\n2100 – VAT Payable",
    rule: "Debit AR for gross amount; credit revenue for net; credit VAT for tax portion.",
    validates: "Gross = Net + VAT; total matches invoice total.",
  },
  {
    type: "credit_note",
    label: "Credit Note",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    debitAccounts: "4000 – Sales Revenue\n2100 – VAT Payable",
    creditAccounts: "1100 – Accounts Receivable",
    rule: "Reverse of invoice: debit revenue & VAT, credit AR. Reduces customer balance.",
    validates: "Matches linked invoice; partial credits supported.",
  },
  {
    type: "payment",
    label: "Customer Payment",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    debitAccounts: "1000 – Cash / Bank",
    creditAccounts: "1100 – Accounts Receivable",
    rule: "Debit bank for cash received; credit AR to clear customer balance.",
    validates: "Payment ≤ outstanding AR balance; clears individual invoices.",
  },
  {
    type: "purchase",
    label: "Purchase Invoice",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    debitAccounts: "1200 – Inventory\n1300 – VAT Receivable",
    creditAccounts: "2000 – Accounts Payable",
    rule: "Debit inventory & recoverable VAT; credit AP. Increases stock value.",
    validates: "Stock qty increases on confirmation; AP balance grows.",
  },
  {
    type: "supplier_payment",
    label: "Supplier Payment",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    debitAccounts: "2000 – Accounts Payable",
    creditAccounts: "1000 – Cash / Bank",
    rule: "Debit AP to reduce liability; credit bank for cash paid out.",
    validates: "Payment ≤ outstanding AP balance; supplier balance decreases.",
  },
  {
    type: "expense",
    label: "Business Expense",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    debitAccounts: "5xxx – Expense Account\n1300 – VAT Receivable (if applicable)",
    creditAccounts: "1000 – Cash / Bank",
    rule: "Debit the relevant expense account; credit cash. VAT-recoverable portion goes to VAT Receivable.",
    validates: "Expense account type must be 'expense'; payment account must be 'asset'.",
  },
  {
    type: "manual",
    label: "Manual Journal",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
    debitAccounts: "Any account",
    creditAccounts: "Any account",
    rule: "User-defined adjustments. Must remain balanced (total DR = total CR). Used for accruals, corrections, depreciation.",
    validates: "System enforces DR = CR within ±0.01 before posting.",
  },
];

const ACCOUNT_TYPES = [
  { type: "asset", label: "Asset", normal: "Debit", description: "Cash, AR, Inventory, Equipment" },
  { type: "liability", label: "Liability", normal: "Credit", description: "AP, VAT Payable, Loans" },
  { type: "equity", label: "Equity", normal: "Credit", description: "Owner's Equity, Retained Earnings" },
  { type: "revenue", label: "Revenue", normal: "Credit", description: "Sales Revenue, Other Income" },
  { type: "expense", label: "Expense", normal: "Debit", description: "COGS, Operating Expenses, Interest" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────
function fmt(v: string | number | null | undefined) {
  const n = parseFloat(String(v || "0"));
  if (isNaN(n) || n === 0) return "";
  return "€" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmt(v: string | number | null | undefined) {
  const n = parseFloat(String(v || "0"));
  return "€" + (isNaN(n) ? 0 : n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function srcColor(type: string) {
  const map: Record<string, string> = {
    manual: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    invoice: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    payment: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    purchase: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    expense: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    credit_note: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    supplier_payment: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  };
  return map[type] ?? "bg-gray-100 text-gray-600";
}

function srcLabel(type: string) {
  const map: Record<string, string> = {
    manual: "Manual",
    invoice: "Invoice",
    payment: "Payment",
    purchase: "Purchase",
    expense: "Expense",
    credit_note: "Credit Note",
    supplier_payment: "Supplier Pmt",
  };
  return map[type] ?? type;
}

function exportCSV(entries: AuditEntry[]) {
  const rows: string[][] = [
    ["Entry #", "Date", "Source Type", "Reference", "Description", "Status", "Balanced", "Acct Code", "Acct Name", "Acct Type", "Debit", "Credit", "Line Description"],
  ];
  for (const e of entries) {
    if (e.lines.length === 0) {
      rows.push([e.entryNumber, e.date, e.sourceType, e.reference ?? "", e.description ?? "", e.status, e.balanced ? "YES" : "NO", "", "", "", "", "", ""]);
    } else {
      for (const l of e.lines) {
        rows.push([
          e.entryNumber, e.date, srcLabel(e.sourceType), e.reference ?? "", e.description ?? "",
          e.status, e.balanced ? "YES" : "NO",
          l.accountCode ?? "", l.accountName ?? "", l.accountType ?? "",
          parseFloat(l.debit) > 0 ? l.debit : "",
          parseFloat(l.credit) > 0 ? l.credit : "",
          l.description ?? "",
        ]);
      }
    }
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `accounting-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Audit Row ─────────────────────────────────────────────────────────────
function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const imbalanceAmt = Math.abs(parseFloat(entry.totalDebit) - parseFloat(entry.totalCredit));

  return (
    <>
      <tr
        className={`border-b cursor-pointer select-none transition-colors ${
          !entry.balanced
            ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50"
            : "hover:bg-muted/40"
        }`}
        onClick={() => setOpen(o => !o)}
        data-testid={`audit-row-${entry.entryNumber}`}
      >
        <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground w-6">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </td>
        <td className="px-2 py-1.5 font-mono text-xs font-semibold whitespace-nowrap" data-testid={`text-entry-num-${entry.entryNumber}`}>
          {entry.entryNumber}
        </td>
        <td className="px-2 py-1.5 text-xs whitespace-nowrap">{entry.date}</td>
        <td className="px-2 py-1.5">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${srcColor(entry.sourceType)}`}>
            {srcLabel(entry.sourceType)}
          </span>
        </td>
        <td className="px-2 py-1.5 text-xs text-muted-foreground font-mono whitespace-nowrap">{entry.reference ?? "—"}</td>
        <td className="px-2 py-1.5 text-xs max-w-[200px] truncate" title={entry.description ?? ""}>{entry.description ?? "—"}</td>
        <td className="px-2 py-1.5 text-xs text-right font-mono tabular-nums font-medium">{fmtAmt(entry.totalDebit)}</td>
        <td className="px-2 py-1.5 text-xs text-right font-mono tabular-nums font-medium">{fmtAmt(entry.totalCredit)}</td>
        <td className="px-2 py-1.5 text-center">
          {entry.balanced ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mx-auto" />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <XCircle className="w-3.5 h-3.5 text-red-500 mx-auto" />
              </TooltipTrigger>
              <TooltipContent>Imbalance: €{imbalanceAmt.toFixed(2)}</TooltipContent>
            </Tooltip>
          )}
        </td>
        <td className="px-2 py-1.5 text-center">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${entry.status === "posted" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}>
            {entry.status}
          </span>
        </td>
        <td className="px-2 py-1.5 text-xs text-center text-muted-foreground">{entry.lines.length}</td>
      </tr>

      {open && entry.lines.map((line, idx) => (
        <tr key={line.id} className={`border-b text-xs ${idx % 2 === 0 ? "bg-muted/20" : "bg-muted/10"}`} data-testid={`audit-line-${line.id}`}>
          <td className="px-2 py-1" />
          <td className="px-2 py-1 pl-6 font-mono text-muted-foreground">{idx + 1}</td>
          <td colSpan={2} className="px-2 py-1">
            <span className="font-mono text-xs text-blue-600 dark:text-blue-400 mr-1">{line.accountCode ?? "—"}</span>
          </td>
          <td className="px-2 py-1 text-xs" colSpan={2}>
            <span className="font-medium">{line.accountName ?? "—"}</span>
            {line.accountType && (
              <span className="ml-2 text-[10px] text-muted-foreground capitalize">({line.accountType})</span>
            )}
            {line.description && (
              <span className="ml-2 text-muted-foreground italic">· {line.description}</span>
            )}
          </td>
          <td className="px-2 py-1 text-right font-mono tabular-nums text-green-700 dark:text-green-400 font-medium">
            {parseFloat(line.debit) > 0 ? fmt(line.debit) : ""}
          </td>
          <td className="px-2 py-1 text-right font-mono tabular-nums text-red-600 dark:text-red-400 font-medium">
            {parseFloat(line.credit) > 0 ? fmt(line.credit) : ""}
          </td>
          <td colSpan={3} />
        </tr>
      ))}

      {open && (
        <tr className="border-b bg-muted/30 text-[10px] font-semibold">
          <td colSpan={6} className="px-2 py-1 pl-8 text-muted-foreground">ENTRY TOTAL</td>
          <td className="px-2 py-1 text-right font-mono tabular-nums text-green-700 dark:text-green-400">{fmtAmt(entry.totalDebit)}</td>
          <td className="px-2 py-1 text-right font-mono tabular-nums text-red-600 dark:text-red-400">{fmtAmt(entry.totalCredit)}</td>
          <td className="px-2 py-1 text-center">
            {entry.balanced
              ? <span className="text-green-600">✓ Balanced</span>
              : <span className="text-red-600">✗ IMBALANCED</span>}
          </td>
          <td colSpan={2} />
        </tr>
      )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function AccountingAudit() {
  const [search, setSearch] = useState("");
  const [srcFilter, setSrcFilter] = useState("all");
  const [balFilter, setBalFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandAll, setExpandAll] = useState(false);

  const { data, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/accounting/audit"],
  });

  const entries = data ?? [];

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (srcFilter !== "all" && e.sourceType !== srcFilter) return false;
      if (balFilter === "balanced" && !e.balanced) return false;
      if (balFilter === "imbalanced" && e.balanced) return false;
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.entryNumber.toLowerCase().includes(q) &&
          !e.description?.toLowerCase().includes(q) &&
          !e.reference?.toLowerCase().includes(q) &&
          !e.lines.some(l => l.accountCode?.toLowerCase().includes(q) || l.accountName?.toLowerCase().includes(q))
        ) return false;
      }
      return true;
    });
  }, [entries, srcFilter, balFilter, dateFrom, dateTo, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const balanced = filtered.filter(e => e.balanced).length;
    const imbalanced = total - balanced;
    const totalVol = filtered.reduce((s, e) => s + parseFloat(e.totalDebit), 0);
    const sourceBreakdown = filtered.reduce<Record<string, number>>((acc, e) => {
      acc[e.sourceType] = (acc[e.sourceType] ?? 0) + 1;
      return acc;
    }, {});
    return { total, balanced, imbalanced, totalVol, sourceBreakdown };
  }, [filtered]);

  const SOURCE_TYPES = ["manual", "invoice", "payment", "purchase", "expense", "credit_note", "supplier_payment"];

  return (
    <div className="p-4 max-w-full mx-auto space-y-4">
      <PageHeader
        title="Accounting Audit Grid"
        description="End-to-end transaction verification — balance checks, account mapping, and source tracing"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportCSV(filtered)} data-testid="button-export-csv">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            Transaction Audit
          </TabsTrigger>
          <TabsTrigger value="dict" data-testid="tab-dict">
            <BookOpen className="w-4 h-4 mr-1.5" />
            Data Dictionary
          </TabsTrigger>
        </TabsList>

        {/* ── Transaction Audit Tab ─────────────────────────────────────── */}
        <TabsContent value="audit" className="space-y-3 mt-3">
          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Total Entries</p>
                <p className="text-2xl font-bold" data-testid="stat-total-entries">{stats.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Balanced</p>
                <p className="text-2xl font-bold text-green-600" data-testid="stat-balanced">{stats.balanced}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Errors</p>
                <p className={`text-2xl font-bold ${stats.imbalanced > 0 ? "text-red-600" : "text-muted-foreground"}`} data-testid="stat-errors">
                  {stats.imbalanced}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Total Volume</p>
                <p className="text-lg font-bold font-mono" data-testid="stat-volume">
                  {fmtAmt(stats.totalVol)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Source breakdown pills */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.sourceBreakdown).map(([src, cnt]) => (
              <span key={src} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${srcColor(src)}`}>
                {srcLabel(src)}: <strong>{cnt}</strong>
              </span>
            ))}
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[180px]">
                  <div className="relative">
                    <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      className="pl-7 h-8 text-xs"
                      placeholder="Search entry#, description, account…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      data-testid="input-audit-search"
                    />
                  </div>
                </div>
                <div className="w-[140px]">
                  <Select value={srcFilter} onValueChange={setSrcFilter}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-source-type">
                      <Filter className="w-3 h-3 mr-1" />
                      <SelectValue placeholder="Source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {SOURCE_TYPES.map(s => (
                        <SelectItem key={s} value={s}>{srcLabel(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-[140px]">
                  <Select value={balFilter} onValueChange={setBalFilter}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-balance-filter">
                      <SelectValue placeholder="Balance" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All entries</SelectItem>
                      <SelectItem value="balanced">Balanced only</SelectItem>
                      <SelectItem value="imbalanced">Errors only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Input type="date" className="h-8 text-xs w-[130px]" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-date-from" />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input type="date" className="h-8 text-xs w-[130px]" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-date-to" />
                </div>
                {(search || srcFilter !== "all" || balFilter !== "all" || dateFrom || dateTo) && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSearch(""); setSrcFilter("all"); setBalFilter("all"); setDateFrom(""); setDateTo(""); }}>
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Imbalance alert */}
          {stats.imbalanced > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 text-red-700 dark:text-red-400 text-sm" data-testid="alert-imbalance">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span><strong>{stats.imbalanced}</strong> journal {stats.imbalanced === 1 ? "entry is" : "entries are"} not balanced (DR ≠ CR). These are highlighted in red below.</span>
            </div>
          )}

          {/* Grid */}
          <div className="border rounded-md overflow-auto">
            <table className="w-full text-xs border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-muted/60 border-b sticky top-0 z-10">
                  <th className="px-2 py-2 w-6" />
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Entry #</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Date</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Source</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Reference</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground">Description</th>
                  <th className="px-2 py-2 text-right font-semibold text-green-700 dark:text-green-400">Total DR</th>
                  <th className="px-2 py-2 text-right font-semibold text-red-600 dark:text-red-400">Total CR</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground">✓</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground">Status</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground">Lines</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td colSpan={11} className="px-2 py-2">
                        <Skeleton className="h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                      No entries match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map(entry => <AuditRow key={entry.id} entry={entry} />)
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/50 border-t-2 font-semibold text-xs">
                    <td colSpan={6} className="px-2 py-2 text-right text-muted-foreground">
                      {filtered.length} entries
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-green-700 dark:text-green-400">
                      {fmtAmt(filtered.reduce((s, e) => s + parseFloat(e.totalDebit), 0))}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-red-600 dark:text-red-400">
                      {fmtAmt(filtered.reduce((s, e) => s + parseFloat(e.totalCredit), 0))}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {stats.imbalanced === 0
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                        : <XCircle className="w-4 h-4 text-red-500 mx-auto" />}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Click any row to expand its debit/credit lines. Green = Debit, Red = Credit. DR totals must equal CR totals for each entry.
          </p>
        </TabsContent>

        {/* ── Data Dictionary Tab ───────────────────────────────────────── */}
        <TabsContent value="dict" className="space-y-4 mt-3">
          <div className="grid gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Transaction Type → Account Mapping Rules</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted/60 border-b">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Transaction Type</th>
                        <th className="px-3 py-2 text-left font-semibold text-green-700 dark:text-green-400">Debit (DR)</th>
                        <th className="px-3 py-2 text-left font-semibold text-red-600 dark:text-red-400">Credit (CR)</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Business Rule</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Validates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DATA_DICTIONARY.map((row, i) => (
                        <tr key={row.type} className={`border-b ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="px-3 py-2.5 align-top">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${row.color}`}>
                              {row.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-green-700 dark:text-green-400 whitespace-pre-line">{row.debitAccounts}</td>
                          <td className="px-3 py-2.5 align-top font-mono text-red-600 dark:text-red-400 whitespace-pre-line">{row.creditAccounts}</td>
                          <td className="px-3 py-2.5 align-top text-muted-foreground leading-relaxed">{row.rule}</td>
                          <td className="px-3 py-2.5 align-top text-muted-foreground leading-relaxed">{row.validates}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Account Type Normal Balances (Debit/Credit Rules)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted/60 border-b">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Account Type</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Normal Balance</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Increased By</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Decreased By</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Examples</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ACCOUNT_TYPES.map((row, i) => (
                        <tr key={row.type} className={`border-b ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="px-3 py-2 font-semibold capitalize">{row.label}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${row.normal === "Debit" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"}`}>
                              {row.normal}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{row.normal === "Debit" ? "Debit (DR)" : "Credit (CR)"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.normal === "Debit" ? "Credit (CR)" : "Debit (DR)"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{row.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">System Integrity Rules</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {[
                    "Every journal entry must have total Debits = total Credits (within ±€0.01 tolerance).",
                    "Auto-generated entries (Invoice, Payment, Purchase, Expense) are created by the system when transactions are posted/confirmed.",
                    "Manual journal entries require at least 2 lines and must be balanced before saving.",
                    "Account balances are recalculated by summing all journal entry lines; use 'Recalculate' to rebuild from scratch.",
                    "The Trial Balance report verifies all account balances: total DR side must equal total CR side.",
                    "Accounts Receivable (1100) balance should match the sum of all unpaid customer invoice amounts.",
                    "Accounts Payable (2000) balance should match the sum of all confirmed, unpaid purchase invoices.",
                    "VAT Payable (2100) = Output VAT on sales. VAT Receivable (1300) = Input VAT on purchases. Net VAT = 2100 − 1300.",
                    "Sales Revenue (4000) should reconcile with sum of all posted sales invoice subtotals (ex-VAT).",
                    "Each invoice, payment, purchase and expense record stores its sourceType and sourceId so entries can be traced back.",
                  ].map((rule, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="shrink-0 font-mono text-muted-foreground/60">{i + 1}.</span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
