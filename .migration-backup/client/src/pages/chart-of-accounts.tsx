import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, ChevronDown, ChevronRight, Database, BookOpen, Edit2, RefreshCw, BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertAccountSchema, type Account } from "@shared/schema";
import { z } from "zod";

const accountFormSchema = insertAccountSchema.extend({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
});

const typeConfig: Record<string, { label: string; color: string; bgClass: string; textClass: string }> = {
  asset: { label: "Asset", color: "green", bgClass: "bg-green-500/10", textClass: "text-green-700 dark:text-green-400" },
  liability: { label: "Liability", color: "red", bgClass: "bg-red-500/10", textClass: "text-red-700 dark:text-red-400" },
  equity: { label: "Equity", color: "blue", bgClass: "bg-blue-500/10", textClass: "text-blue-700 dark:text-blue-400" },
  revenue: { label: "Revenue", color: "purple", bgClass: "bg-purple-500/10", textClass: "text-purple-700 dark:text-purple-400" },
  expense: { label: "Expense", color: "orange", bgClass: "bg-orange-500/10", textClass: "text-orange-700 dark:text-orange-400" },
};

const subtypesByType: Record<string, { value: string; label: string }[]> = {
  asset: [
    { value: "current_asset", label: "Current Asset" },
    { value: "fixed_asset", label: "Fixed Asset" },
  ],
  liability: [
    { value: "current_liability", label: "Current Liability" },
    { value: "long_term_liability", label: "Long Term Liability" },
  ],
  equity: [{ value: "equity", label: "Equity" }],
  revenue: [
    { value: "operating", label: "Operating" },
    { value: "other", label: "Other" },
  ],
  expense: [
    { value: "cogs", label: "Cost of Goods Sold" },
    { value: "operating", label: "Operating" },
  ],
};

const typeOrder = ["asset", "liability", "equity", "revenue", "expense"];

const formatEUR = (val: string | number) => {
  const num = typeof val === "string" ? parseFloat(val) : val;
  return "€" + (num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const subtypeLabel = (subtype: string | null) => {
  if (!subtype) return "-";
  return subtype.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

interface LedgerEntry {
  date: string;
  entryNumber: string;
  description: string;
  reference: string | null;
  debit: string;
  credit: string;
  lineDescription: string | null;
  journalEntryId: string;
}

interface AccountAnalysis {
  account: Account;
  fromDate: string;
  toDate: string;
}

function AccountAnalysisSheet({ analysis, onClose }: { analysis: AccountAnalysis; onClose: () => void }) {
  const [from, setFrom] = useState(analysis.fromDate);
  const [to, setTo] = useState(analysis.toDate);
  const cfg = typeConfig[analysis.account.type] || typeConfig.asset;

  const { data, isLoading } = useQuery<{ entries: LedgerEntry[]; openingBalance: string }>({
    queryKey: ["/api/reports/general-ledger", analysis.account.id, from, to],
    queryFn: async () => {
      const res = await fetch(`/api/reports/general-ledger/${analysis.account.id}/${from}/${to}`, { credentials: "include" });
      return res.json();
    },
  });

  const entries = data?.entries || [];
  const openingBalance = parseFloat(data?.openingBalance || "0");

  const isDebitNormal = analysis.account.type === "asset" || analysis.account.type === "expense";

  // Build rows with running balance
  let runningBalance = openingBalance;
  const rows = entries.map((e) => {
    const debit = parseFloat(e.debit || "0");
    const credit = parseFloat(e.credit || "0");
    if (isDebitNormal) {
      runningBalance += debit - credit;
    } else {
      runningBalance += credit - debit;
    }
    return { ...e, runningBalance };
  });

  const totalDebits = entries.reduce((s, e) => s + parseFloat(e.debit || "0"), 0);
  const totalCredits = entries.reduce((s, e) => s + parseFloat(e.credit || "0"), 0);
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].runningBalance : openingBalance;

  const netMove = closingBalance - openingBalance;

  return (
    <SheetContent side="right" className="w-full sm:max-w-4xl overflow-y-auto p-0">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className={`px-6 py-5 border-b ${cfg.bgClass}`}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-lg bg-white/60 dark:bg-black/30`}>
                <BarChart3 className={`w-5 h-5 ${cfg.textClass}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-sm font-semibold ${cfg.textClass}`}>{analysis.account.code}</span>
                  <span className="text-foreground font-semibold text-lg">{analysis.account.name}</span>
                </div>
                <div className="text-sm text-muted-foreground font-normal">Account Analysis</div>
              </div>
            </SheetTitle>
          </SheetHeader>
          {/* Date filters */}
          <div className="flex items-center gap-3 mt-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground font-medium">From</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 w-36 text-sm bg-white/70 dark:bg-black/30"
                data-testid="input-analysis-from"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground font-medium">To</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 w-36 text-sm bg-white/70 dark:bg-black/30"
                data-testid="input-analysis-to"
              />
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-px bg-border border-b">
          {[
            { label: "Opening Balance", value: openingBalance, icon: Minus, neutral: true },
            { label: "Total Debits", value: totalDebits, icon: TrendingUp, positive: true },
            { label: "Total Credits", value: totalCredits, icon: TrendingDown, negative: true },
            { label: "Closing Balance", value: closingBalance, icon: BarChart3, bold: true },
          ].map(({ label, value, icon: Icon, neutral, positive, negative, bold }) => (
            <div key={label} className="bg-background px-4 py-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${positive ? "text-green-600" : negative ? "text-red-500" : "text-muted-foreground"}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <div className={`text-sm font-semibold tabular-nums ${bold ? cfg.textClass : neutral ? "text-muted-foreground" : positive ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                {formatEUR(value)}
              </div>
            </div>
          ))}
        </div>

        {/* Net movement banner */}
        {entries.length > 0 && (
          <div className={`px-6 py-2 text-xs flex items-center gap-2 border-b ${netMove >= 0 ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"}`}>
            {netMove >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span>
              Net movement for period: <strong>{netMove >= 0 ? "+" : ""}{formatEUR(netMove)}</strong>
              &nbsp;·&nbsp; {entries.length} transaction{entries.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Transactions table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className={`w-16 h-16 rounded-full ${cfg.bgClass} flex items-center justify-center mb-4`}>
                <BarChart3 className={`w-8 h-8 ${cfg.textClass}`} />
              </div>
              <p className="text-muted-foreground text-sm">No transactions in this period</p>
              <p className="text-muted-foreground text-xs mt-1">Try adjusting the date range</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-[100px]">Date</TableHead>
                  <TableHead className="w-[110px]">Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-[110px]">Debit</TableHead>
                  <TableHead className="text-right w-[110px]">Credit</TableHead>
                  <TableHead className="text-right w-[120px] font-semibold">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening balance row */}
                <TableRow className="bg-muted/20 text-muted-foreground text-xs">
                  <TableCell colSpan={5} className="py-2 italic pl-3">Opening Balance</TableCell>
                  <TableCell className="text-right py-2 font-medium tabular-nums text-foreground">
                    {formatEUR(openingBalance)}
                  </TableCell>
                </TableRow>
                {rows.map((row, i) => {
                  const hasDebit = parseFloat(row.debit) > 0;
                  const hasCredit = parseFloat(row.credit) > 0;
                  return (
                    <TableRow key={i} className="text-sm hover:bg-muted/30" data-testid={`row-analysis-${i}`}>
                      <TableCell className="py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                        {new Date(row.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                      </TableCell>
                      <TableCell className="py-2">
                        <span className={`font-mono text-xs font-medium ${cfg.textClass}`}>{row.entryNumber}</span>
                      </TableCell>
                      <TableCell className="py-2 max-w-[200px]">
                        <div className="truncate text-sm">{row.description}</div>
                        {row.lineDescription && row.lineDescription !== row.description && (
                          <div className="truncate text-xs text-muted-foreground">{row.lineDescription}</div>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums">
                        {hasDebit ? (
                          <span className="text-green-700 dark:text-green-400 font-medium">{formatEUR(row.debit)}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums">
                        {hasCredit ? (
                          <span className="text-red-600 dark:text-red-400 font-medium">{formatEUR(row.credit)}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-right tabular-nums font-semibold">
                        <span className={row.runningBalance < 0 ? "text-red-600 dark:text-red-400" : ""}>
                          {formatEUR(Math.abs(row.runningBalance))}{row.runningBalance < 0 ? " Cr" : ""}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Closing balance row */}
                <TableRow className={`font-semibold text-sm ${cfg.bgClass}`}>
                  <TableCell colSpan={3} className="py-2 pl-3">Closing Balance</TableCell>
                  <TableCell className="text-right py-2 tabular-nums text-green-700 dark:text-green-400">{formatEUR(totalDebits)}</TableCell>
                  <TableCell className="text-right py-2 tabular-nums text-red-600 dark:text-red-400">{formatEUR(totalCredits)}</TableCell>
                  <TableCell className={`text-right py-2 tabular-nums ${cfg.textClass}`}>{formatEUR(closingBalance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </SheetContent>
  );
}

export default function ChartOfAccounts() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [analysisAccount, setAnalysisAccount] = useState<Account | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    asset: true, liability: true, equity: true, revenue: true, expense: true,
  });
  const { toast } = useToast();

  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-01-01`;
  const defaultTo = now.toISOString().split("T")[0];

  const { data: accounts = [], isLoading } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });

  const createAccount = useMutation({
    mutationFn: async (data: z.infer<typeof accountFormSchema>) => {
      const res = await apiRequest("POST", "/api/accounts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setDialogOpen(false);
      toast({ title: "Account created successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateAccount = useMutation({
    mutationFn: async (data: z.infer<typeof accountFormSchema>) => {
      if (!editingAccount) return;
      const res = await apiRequest("PUT", `/api/accounts/${editingAccount.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setEditDialogOpen(false);
      setEditingAccount(null);
      toast({ title: "Account updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts/seed-defaults");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Default accounts initialized" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const recalculate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts/recalculate");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({ title: "Accounting recalculated", description: data.message });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleSection = (type: string) => {
    setOpenSections((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const groupedAccounts = typeOrder.reduce<Record<string, Account[]>>((acc, type) => {
    acc[type] = accounts.filter((a) => a.type === type).sort((a, b) => a.code.localeCompare(b.code));
    return acc;
  }, {});

  const totals = typeOrder.reduce<Record<string, number>>((acc, type) => {
    acc[type] = groupedAccounts[type]?.reduce((sum, a) => sum + parseFloat(a.balance), 0) || 0;
    return acc;
  }, {});

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setEditDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Chart of Accounts"
        description="Manage your accounting chart of accounts"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {accounts.length === 0 && (
              <Button
                variant="outline"
                onClick={() => seedDefaults.mutate()}
                disabled={seedDefaults.isPending}
                data-testid="button-seed-defaults"
              >
                <Database className="w-4 h-4 mr-1" />
                {seedDefaults.isPending ? "Initializing..." : "Initialize Chart of Accounts"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => recalculate.mutate()}
              disabled={recalculate.isPending}
              data-testid="button-recalculate"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${recalculate.isPending ? "animate-spin" : ""}`} />
              {recalculate.isPending ? "Recalculating..." : "Recalculate Balances"}
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-account">
                  <Plus className="w-4 h-4 mr-1" /> New Account
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>New Account</DialogTitle>
                </DialogHeader>
                <AccountForm onSubmit={(d) => createAccount.mutate(d)} isPending={createAccount.isPending} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {typeOrder.map((type) => {
          const cfg = typeConfig[type];
          return (
            <Card key={type} data-testid={`card-summary-${type}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{cfg.label}</CardTitle>
                <div className={`flex items-center justify-center w-8 h-8 rounded-md ${cfg.bgClass}`}>
                  <BookOpen className={`w-4 h-4 ${cfg.textClass}`} />
                </div>
              </CardHeader>
              <CardContent>
                <p className={`text-lg font-semibold ${cfg.textClass}`} data-testid={`text-total-${type}`}>
                  {formatEUR(totals[type])}
                </p>
                <p className="text-xs text-muted-foreground">{groupedAccounts[type]?.length || 0} accounts</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Account sections */}
      <div className="space-y-3">
        {typeOrder.map((type) => {
          const cfg = typeConfig[type];
          const accts = groupedAccounts[type] || [];
          const isOpen = openSections[type];
          return (
            <Card key={type} data-testid={`section-${type}`}>
              <Collapsible open={isOpen} onOpenChange={() => toggleSection(type)}>
                <CollapsibleTrigger asChild>
                  <button
                    className="w-full flex items-center justify-between gap-2 p-4 text-left"
                    data-testid={`button-toggle-${type}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-md ${cfg.bgClass}`}>
                        <BookOpen className={`w-4 h-4 ${cfg.textClass}`} />
                      </div>
                      <div>
                        <span className="font-semibold">{cfg.label} Accounts</span>
                        <span className="text-sm text-muted-foreground ml-2">({accts.length})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold ${cfg.textClass}`}>{formatEUR(totals[type])}</span>
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {accts.length === 0 ? (
                    <div className="px-4 pb-4 text-sm text-muted-foreground">No accounts in this category.</div>
                  ) : (
                    <div className="px-4 pb-4">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Code</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead>Subtype</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            <TableHead className="w-[80px]">Status</TableHead>
                            <TableHead className="w-[100px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {accts.map((account) => (
                            <TableRow
                              key={account.id}
                              data-testid={`row-account-${account.id}`}
                              className="cursor-pointer hover:bg-muted/40 group"
                              onClick={() => setAnalysisAccount(account)}
                            >
                              <TableCell>
                                <span className={`font-mono text-sm font-medium ${cfg.textClass}`} data-testid={`text-code-${account.id}`}>
                                  {account.code}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className="font-medium text-sm" data-testid={`text-name-${account.id}`}>{account.name}</span>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm text-muted-foreground">{subtypeLabel(account.subtype)}</span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className="text-sm font-medium" data-testid={`text-balance-${account.id}`}>
                                  {formatEUR(account.balance)}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge variant={account.active ? "default" : "secondary"} data-testid={`badge-status-${account.id}`}>
                                  {account.active ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1 justify-end">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); setAnalysisAccount(account); }}
                                    data-testid={`button-analyse-${account.id}`}
                                    title="Account Analysis"
                                  >
                                    <BarChart3 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={(e) => { e.stopPropagation(); handleEdit(account); }}
                                    data-testid={`button-edit-${account.id}`}
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingAccount(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
          </DialogHeader>
          {editingAccount && (
            <AccountForm
              onSubmit={(d) => updateAccount.mutate(d)}
              isPending={updateAccount.isPending}
              defaultValues={{
                code: editingAccount.code,
                name: editingAccount.name,
                type: editingAccount.type,
                subtype: editingAccount.subtype || "",
                description: editingAccount.description || "",
                active: editingAccount.active,
                balance: editingAccount.balance,
                isSystem: editingAccount.isSystem,
                parentId: editingAccount.parentId || "",
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Account Analysis Sheet */}
      <Sheet open={!!analysisAccount} onOpenChange={(open) => { if (!open) setAnalysisAccount(null); }}>
        {analysisAccount && (
          <AccountAnalysisSheet
            analysis={{ account: analysisAccount, fromDate: defaultFrom, toDate: defaultTo }}
            onClose={() => setAnalysisAccount(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function AccountForm({ onSubmit, isPending, defaultValues }: { onSubmit: (d: any) => void; isPending: boolean; defaultValues?: any }) {
  const form = useForm({
    resolver: zodResolver(accountFormSchema),
    defaultValues: defaultValues || {
      code: "", name: "", type: "asset", subtype: "", description: "", active: true, balance: "0", isSystem: false, parentId: "",
    },
  });

  const selectedType = form.watch("type");
  const availableSubtypes = subtypesByType[selectedType] || [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem>
              <FormLabel>Account Code</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. 1000" data-testid="input-account-code" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem>
              <FormLabel>Account Name</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. Cash" data-testid="input-account-name" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="type" render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select value={field.value} onValueChange={(v) => { field.onChange(v); form.setValue("subtype", ""); }}>
                <FormControl>
                  <SelectTrigger data-testid="select-account-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="asset">Asset</SelectItem>
                  <SelectItem value="liability">Liability</SelectItem>
                  <SelectItem value="equity">Equity</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="subtype" render={({ field }) => (
            <FormItem>
              <FormLabel>Subtype</FormLabel>
              <Select value={field.value || ""} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-account-subtype">
                    <SelectValue placeholder="Select subtype" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {availableSubtypes.map((st) => (
                    <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid="input-account-description" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="active" render={({ field }) => (
          <FormItem className="flex items-center justify-between">
            <FormLabel>Active</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-account-active" />
            </FormControl>
          </FormItem>
        )} />
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending} data-testid="button-save-account">
            {isPending ? "Saving..." : "Save Account"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
