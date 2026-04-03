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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  FlaskConical,
  Play,
  Loader2,
  ArrowDown,
  FileText,
  CreditCard,
  ShoppingCart,
  Wallet,
  Info,
  CircleDot,
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
          <TabsTrigger value="simulation" data-testid="tab-simulation">
            <FlaskConical className="w-4 h-4 mr-1.5" />
            Simulation
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

        {/* ── Simulation Tab ────────────────────────────────────────────── */}
        <TabsContent value="simulation" className="mt-3">
          <TransactionSimulator />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Simulation Types ──────────────────────────────────────────────────────
interface TraceLine {
  id: string;
  accountCode: string | null;
  accountName: string | null;
  accountType: string | null;
  accountSubtype: string | null;
  debit: string;
  credit: string;
  description: string | null;
}

interface TraceJE {
  entryNumber: string;
  date: string;
  description: string;
  reference: string | null;
  status: string;
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  lines: TraceLine[];
}

interface IntegrityCheck {
  name: string;
  pass: boolean;
  severity: string;
  detail: string;
  expected?: string;
  actual?: string;
}

interface TraceResult {
  sourceType: string;
  sourceLabel: string;
  source: Record<string, any> | null;
  journalEntry: TraceJE | null;
  integrityChecks: IntegrityCheck[];
}

// ─── Source type config ───────────────────────────────────────────────────
const SIM_TYPES = [
  { value: "invoice",          label: "Sales Invoice",      apiKey: "/api/invoices",           icon: FileText,     idField: "id", numField: "invoiceNumber",  entityField: "customerName", amtField: "total",  statusField: "status", filterFn: (r: any) => r.type === "invoice" },
  { value: "credit_note",      label: "Credit Note",        apiKey: "/api/invoices",           icon: FileText,     idField: "id", numField: "invoiceNumber",  entityField: "customerName", amtField: "total",  statusField: "status", filterFn: (r: any) => r.type === "credit_note" },
  { value: "payment",          label: "Customer Payment",   apiKey: "/api/payments",           icon: CreditCard,   idField: "id", numField: "id",             entityField: "customerName", amtField: "amount", statusField: null,     filterFn: () => true },
  { value: "purchase",         label: "Purchase Invoice",   apiKey: "/api/purchase-invoices",  icon: ShoppingCart, idField: "id", numField: "invoiceNumber",  entityField: "supplierName", amtField: "total",  statusField: "status", filterFn: () => true },
  { value: "supplier_payment", label: "Supplier Payment",   apiKey: "/api/supplier-payments",  icon: CreditCard,   idField: "id", numField: "id",             entityField: "supplierName", amtField: "amount", statusField: null,     filterFn: () => true },
  { value: "expense",          label: "Business Expense",   apiKey: "/api/expenses",           icon: Wallet,       idField: "id", numField: "id",             entityField: "description",  amtField: "amount", statusField: null,     filterFn: () => true },
];

// ─── Step component ─────────────────────────────────────────────────────────
function SimStep({
  num, title, status, children,
}: {
  num: number;
  title: string;
  status: "pending" | "pass" | "fail" | "warn" | "info";
  children?: React.ReactNode;
}) {
  const colors = {
    pending: "border-muted bg-muted/30 text-muted-foreground",
    pass:    "border-green-400 bg-green-50 dark:bg-green-950/30",
    fail:    "border-red-400 bg-red-50 dark:bg-red-950/30",
    warn:    "border-amber-400 bg-amber-50 dark:bg-amber-950/30",
    info:    "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
  };
  const numColors = {
    pending: "bg-muted text-muted-foreground",
    pass:    "bg-green-500 text-white",
    fail:    "bg-red-500 text-white",
    warn:    "bg-amber-500 text-white",
    info:    "bg-blue-500 text-white",
  };
  const icons = {
    pending: <CircleDot className="w-3.5 h-3.5" />,
    pass:    <CheckCircle2 className="w-3.5 h-3.5" />,
    fail:    <XCircle className="w-3.5 h-3.5" />,
    warn:    <AlertTriangle className="w-3.5 h-3.5" />,
    info:    <Info className="w-3.5 h-3.5" />,
  };

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${numColors[status]}`}>
          {num}
        </div>
        {children && <div className="w-px flex-1 mt-1 bg-border min-h-[12px]" />}
      </div>
      <div className={`flex-1 mb-3 rounded-lg border-l-4 ${colors[status]} border border-l-4 overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
          {icons[status]}
          <span className="font-semibold text-sm">{title}</span>
          <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-medium ${
            status === "pass" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
            status === "fail" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
            status === "warn" ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
            status === "info" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" :
            "bg-muted text-muted-foreground"
          }`}>
            {status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "warn" ? "WARN" : status === "info" ? "INFO" : "—"}
          </span>
        </div>
        {children && <div className="px-3 py-2.5 text-xs">{children}</div>}
      </div>
    </div>
  );
}

// ─── KV row helper ─────────────────────────────────────────────────────────
function KV({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="text-muted-foreground w-36 shrink-0">{label}</span>
      <span className={`font-medium break-all ${mono ? "font-mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

// ─── Transaction Simulator ─────────────────────────────────────────────────
function TransactionSimulator() {
  const [simType, setSimType] = useState<string>("invoice");
  const [selectedId, setSelectedId] = useState<string>("");
  const [txSearch, setTxSearch] = useState("");
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  const typeConfig = SIM_TYPES.find(t => t.value === simType)!;

  const { data: txList, isLoading: txLoading } = useQuery<any[]>({
    queryKey: [typeConfig.apiKey],
  });

  const filtered = useMemo(() => {
    if (!txList) return [];
    const q = txSearch.toLowerCase();
    return txList
      .filter(typeConfig.filterFn)
      .filter(r => {
        if (!q) return true;
        const num = String(r[typeConfig.numField] ?? "").toLowerCase();
        const entity = String(r[typeConfig.entityField] ?? "").toLowerCase();
        return num.includes(q) || entity.includes(q);
      })
      .slice(0, 60);
  }, [txList, txSearch, typeConfig, simType]);

  async function runTrace() {
    if (!selectedId) return;
    setTracing(true);
    setTraceError(null);
    setTraceResult(null);
    try {
      const res = await fetch(`/api/accounting/trace?type=${simType}&id=${selectedId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message);
      setTraceResult(await res.json());
    } catch (e: any) {
      setTraceError(e.message);
    } finally {
      setTracing(false);
    }
  }

  const passCount = traceResult?.integrityChecks.filter(c => c.pass).length ?? 0;
  const failCount = traceResult?.integrityChecks.filter(c => !c.pass && c.severity === "error").length ?? 0;
  const warnCount = traceResult?.integrityChecks.filter(c => !c.pass && c.severity === "warning").length ?? 0;
  const overallStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : traceResult ? "pass" : "pending";

  const reportImpact: Record<string, string[]> = {
    invoice:          ["Accounts Receivable ↑ (Balance Sheet)", "Sales Revenue ↑ (P&L)", "VAT Payable ↑ (Balance Sheet)", "Trial Balance: AR debit, Revenue credit"],
    credit_note:      ["Accounts Receivable ↓ (Balance Sheet)", "Sales Revenue ↓ (P&L)", "VAT Payable ↓ (Balance Sheet)", "Trial Balance: Revenue debit, AR credit"],
    payment:          ["Cash/Bank ↑ (Balance Sheet)", "Accounts Receivable ↓ (Balance Sheet)", "Trial Balance: Bank debit, AR credit"],
    purchase:         ["Inventory ↑ (Balance Sheet)", "VAT Receivable ↑ (Balance Sheet)", "Accounts Payable ↑ (Balance Sheet)", "Trial Balance: Inventory debit, AP credit"],
    supplier_payment: ["Accounts Payable ↓ (Balance Sheet)", "Cash/Bank ↓ (Balance Sheet)", "Trial Balance: AP debit, Bank credit"],
    expense:          ["Expense Account ↑ (P&L)", "Cash/Bank ↓ (Balance Sheet)", "Trial Balance: Expense debit, Bank credit"],
  };

  const src = traceResult?.source;
  const je = traceResult?.journalEntry;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
      {/* ── Left: Picker ───────────────────────────────────────────────── */}
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-violet-500" />
              Configure Simulation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">1. Transaction Type</label>
              <Select value={simType} onValueChange={v => { setSimType(v); setSelectedId(""); setTraceResult(null); }}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-sim-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIM_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">2. Select Record</label>
              <div className="relative mb-1">
                <Search className="absolute left-2 top-2 w-3 h-3 text-muted-foreground" />
                <Input
                  className="pl-6 h-7 text-xs"
                  placeholder="Search…"
                  value={txSearch}
                  onChange={e => setTxSearch(e.target.value)}
                  data-testid="input-sim-search"
                />
              </div>
              <ScrollArea className="h-[280px] border rounded-md">
                {txLoading ? (
                  <div className="p-3 space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-4 text-center text-xs text-muted-foreground">No records found</div>
                ) : (
                  <div className="divide-y">
                    {filtered.map((r: any) => {
                      const rid = r[typeConfig.idField];
                      const num = r[typeConfig.numField] ?? rid.slice(0, 8);
                      const entity = r[typeConfig.entityField] ?? "—";
                      const amt = parseFloat(r[typeConfig.amtField] ?? "0");
                      const status = typeConfig.statusField ? r[typeConfig.statusField] : null;
                      const isSelected = rid === selectedId;
                      return (
                        <button
                          key={rid}
                          className={`w-full text-left px-2.5 py-2 transition-colors text-xs ${isSelected ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"}`}
                          onClick={() => { setSelectedId(rid); setTraceResult(null); }}
                          data-testid={`sim-record-${rid}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono font-semibold truncate">{typeof num === "string" && num.length > 20 ? num.slice(0, 8) + "…" : num}</span>
                            <span className="font-mono text-right shrink-0">€{amt.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-1 mt-0.5">
                            <span className="text-muted-foreground truncate">{entity}</span>
                            {status && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${status === "paid" ? "bg-green-100 text-green-700" : status === "cancelled" ? "bg-gray-100 text-gray-500" : status === "overdue" ? "bg-red-100 text-red-700" : status === "confirmed" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                                {status}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            <Button
              className="w-full"
              size="sm"
              disabled={!selectedId || tracing}
              onClick={runTrace}
              data-testid="button-run-trace"
            >
              {tracing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {tracing ? "Running trace…" : "Run Simulation"}
            </Button>

            {traceError && (
              <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded p-2 border border-red-200">
                <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {traceError}
              </div>
            )}
          </CardContent>
        </Card>

        {traceResult && (
          <Card>
            <CardContent className="p-3">
              <p className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wide mb-2">Summary</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-green-50 dark:bg-green-950/30 p-2">
                  <p className="text-xl font-bold text-green-600">{passCount}</p>
                  <p className="text-[10px] text-muted-foreground">Pass</p>
                </div>
                <div className={`rounded p-2 ${failCount > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-muted/30"}`}>
                  <p className={`text-xl font-bold ${failCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{failCount}</p>
                  <p className="text-[10px] text-muted-foreground">Error</p>
                </div>
                <div className={`rounded p-2 ${warnCount > 0 ? "bg-amber-50 dark:bg-amber-950/30" : "bg-muted/30"}`}>
                  <p className={`text-xl font-bold ${warnCount > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{warnCount}</p>
                  <p className="text-[10px] text-muted-foreground">Warn</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Right: Trace Pipeline ───────────────────────────────────────── */}
      <div>
        {!traceResult && !tracing && (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3 text-muted-foreground border-2 border-dashed rounded-xl p-8">
            <FlaskConical className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">Select a transaction and run the simulation</p>
            <p className="text-xs text-center max-w-xs">
              The trace will follow the transaction through every accounting step — from source record to journal entry, account impacts, and integrity checks.
            </p>
          </div>
        )}

        {tracing && (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Running trace…</p>
          </div>
        )}

        {traceResult && !tracing && (
          <div className="space-y-0">
            {/* Step 1: Source Transaction */}
            <SimStep num={1} title={`Source: ${traceResult.sourceLabel.replace("_", " ").toUpperCase()}`} status={src ? "info" : "fail"}>
              {src ? (
                <div className="space-y-0.5">
                  <KV label="Record #" value={src.invoice_number ?? src.id?.slice(0, 12)} mono />
                  <KV label="Date" value={src.date ?? src.payment_date} />
                  <KV label="Customer / Supplier" value={src.customer_name ?? src.supplier_name} />
                  {src.status && <KV label="Status" value={<span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${src.status === "paid" || src.status === "confirmed" ? "bg-green-100 text-green-700" : src.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{src.status}</span>} />}
                  {src.subtotal && <KV label="Subtotal (ex-VAT)" value={`€${parseFloat(src.subtotal).toFixed(2)}`} mono />}
                  {src.tax_amount && <KV label="VAT Amount" value={`€${parseFloat(src.tax_amount).toFixed(2)}`} mono />}
                  {src.total && <KV label="Total (incl. VAT)" value={<strong>€{parseFloat(src.total).toFixed(2)}</strong>} />}
                  {src.amount && !src.total && <KV label="Amount" value={<strong>€{parseFloat(src.amount).toFixed(2)}</strong>} />}
                  {src.payment_method && <KV label="Payment Method" value={src.payment_method} />}
                  {src.invoice_number && src.customer_name && src.invoice_number && <KV label="Linked Invoice" value={src.invoice_number} mono />}
                  {src.notes && <KV label="Notes" value={src.notes} />}

                  {src.lines && src.lines.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Line Items ({src.lines.length})</p>
                      <table className="w-full text-xs border-collapse border rounded">
                        <thead>
                          <tr className="bg-muted/50 border-b">
                            <th className="px-2 py-1 text-left text-muted-foreground">Description</th>
                            <th className="px-2 py-1 text-right text-muted-foreground">Qty</th>
                            <th className="px-2 py-1 text-right text-muted-foreground">Unit Price</th>
                            <th className="px-2 py-1 text-right text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {src.lines.map((li: any, i: number) => (
                            <tr key={li.id ?? i} className="border-b last:border-0">
                              <td className="px-2 py-1">{li.description ?? li.item_name}</td>
                              <td className="px-2 py-1 text-right font-mono">{li.quantity}</td>
                              <td className="px-2 py-1 text-right font-mono">€{parseFloat(li.unit_price ?? li.unit_cost ?? "0").toFixed(2)}</td>
                              <td className="px-2 py-1 text-right font-mono font-medium">€{parseFloat(li.total ?? "0").toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-red-600">Source record not found for ID {selectedId}</p>
              )}
            </SimStep>

            <div className="flex justify-center mb-1"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

            {/* Step 2: Journal Entry */}
            <SimStep
              num={2}
              title="Journal Entry Generated"
              status={je ? (je.balanced ? "pass" : "fail") : "fail"}
            >
              {je ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-4 mb-2">
                    <KV label="Entry #" value={je.entryNumber} mono />
                    <KV label="Date" value={je.date} />
                    <KV label="Status" value={<span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${je.status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{je.status}</span>} />
                    <KV label="Description" value={je.description} />
                  </div>

                  <table className="w-full text-xs border-collapse border rounded overflow-hidden">
                    <thead>
                      <tr className="bg-muted/60 border-b">
                        <th className="px-2 py-1.5 text-left text-muted-foreground">Account Code</th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground">Account Name</th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground">Type</th>
                        <th className="px-2 py-1.5 text-right text-green-700 dark:text-green-400">Debit (DR)</th>
                        <th className="px-2 py-1.5 text-right text-red-600 dark:text-red-400">Credit (CR)</th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {je.lines.map((l, i) => (
                        <tr key={l.id} className={`border-b ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="px-2 py-1.5 font-mono text-blue-600 dark:text-blue-400">{l.accountCode ?? "—"}</td>
                          <td className="px-2 py-1.5 font-medium">{l.accountName ?? "DELETED ACCOUNT"}</td>
                          <td className="px-2 py-1.5 capitalize text-muted-foreground">{l.accountType ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-green-700 dark:text-green-400">
                            {parseFloat(l.debit) > 0 ? `€${parseFloat(l.debit).toFixed(2)}` : ""}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-red-600 dark:text-red-400">
                            {parseFloat(l.credit) > 0 ? `€${parseFloat(l.credit).toFixed(2)}` : ""}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground italic">{l.description}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 bg-muted/40 font-semibold">
                        <td colSpan={3} className="px-2 py-1.5 text-right text-muted-foreground">TOTALS</td>
                        <td className="px-2 py-1.5 text-right font-mono text-green-700 dark:text-green-400">€{parseFloat(je.totalDebit).toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-red-600 dark:text-red-400">€{parseFloat(je.totalCredit).toFixed(2)}</td>
                        <td className="px-2 py-1.5">
                          {je.balanced
                            ? <span className="text-green-600 text-xs">✓ Balanced</span>
                            : <span className="text-red-600 text-xs">✗ IMBALANCED</span>}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-red-600 font-medium">No journal entry found for this transaction.</p>
                  <p className="text-muted-foreground">This is expected if the transaction is in draft or cancelled status. Journal entries are only generated when a transaction is confirmed/sent/paid.</p>
                </div>
              )}
            </SimStep>

            <div className="flex justify-center mb-1"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

            {/* Step 3: Account Impact Summary */}
            <SimStep
              num={3}
              title="Account Impact Summary"
              status={je ? "info" : "pending"}
            >
              {je ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-green-700 dark:text-green-400 mb-1.5">Debited Accounts (↑ Asset / ↓ Liability)</p>
                    {je.lines.filter(l => parseFloat(l.debit) > 0).map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-dashed last:border-0">
                        <div>
                          <span className="font-mono text-blue-600 dark:text-blue-400 mr-1">{l.accountCode}</span>
                          <span className="font-medium">{l.accountName}</span>
                          <span className="text-muted-foreground ml-1 capitalize">({l.accountType})</span>
                        </div>
                        <span className="font-mono font-semibold text-green-700 dark:text-green-400 shrink-0">+€{parseFloat(l.debit).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-semibold text-red-600 dark:text-red-400 mb-1.5">Credited Accounts (↑ Liability / ↓ Asset)</p>
                    {je.lines.filter(l => parseFloat(l.credit) > 0).map((l, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-dashed last:border-0">
                        <div>
                          <span className="font-mono text-blue-600 dark:text-blue-400 mr-1">{l.accountCode}</span>
                          <span className="font-medium">{l.accountName}</span>
                          <span className="text-muted-foreground ml-1 capitalize">({l.accountType})</span>
                        </div>
                        <span className="font-mono font-semibold text-red-600 dark:text-red-400 shrink-0">+€{parseFloat(l.credit).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No journal entry — no account impacts to show.</p>
              )}
            </SimStep>

            <div className="flex justify-center mb-1"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

            {/* Step 4: Integrity Checks */}
            <SimStep num={4} title="Integrity Checks" status={overallStatus as any}>
              <div className="space-y-1.5">
                {traceResult.integrityChecks.map((check, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 p-2 rounded border ${
                      check.pass
                        ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                        : check.severity === "error"
                        ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                        : "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                    }`}
                    data-testid={`check-${i}`}
                  >
                    {check.pass
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                      : check.severity === "error"
                      ? <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                      : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{check.name}</p>
                      <p className="text-muted-foreground mt-0.5">{check.detail}</p>
                      {!check.pass && check.expected && (
                        <p className="text-xs mt-1">
                          <span className="text-muted-foreground">Expected:</span> <span className="font-mono text-green-700">€{check.expected}</span>
                          <span className="text-muted-foreground ml-3">Actual:</span> <span className="font-mono text-red-600">€{check.actual}</span>
                        </p>
                      )}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${check.pass ? "bg-green-100 text-green-700" : check.severity === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {check.pass ? "PASS" : check.severity.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </SimStep>

            <div className="flex justify-center mb-1"><ArrowDown className="w-4 h-4 text-muted-foreground" /></div>

            {/* Step 5: Report Impact */}
            <SimStep num={5} title="Report Impact" status="info">
              <div className="space-y-1">
                <p className="text-muted-foreground mb-2">This transaction type affects the following financial reports:</p>
                {(reportImpact[simType] ?? []).map((impact, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <ArrowDown className="w-3 h-3 mt-0.5 text-blue-400 shrink-0" />
                    <span>{impact}</span>
                  </div>
                ))}
                <div className="mt-3 pt-2 border-t grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-500" /> Trial Balance — always affected</div>
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-blue-500" /> General Ledger — per account</div>
                  {(simType === "invoice" || simType === "credit_note" || simType === "expense") && (
                    <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-500" /> Profit & Loss Statement</div>
                  )}
                  {(simType === "invoice" || simType === "credit_note" || simType === "purchase") && (
                    <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-amber-500" /> VAT Return (Output/Input)</div>
                  )}
                  <div className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Balance Sheet — always affected</div>
                </div>
              </div>
            </SimStep>
          </div>
        )}
      </div>
    </div>
  );
}
