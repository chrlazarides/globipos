import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Scale, TrendingUp, BarChart3, Receipt } from "lucide-react";

interface TrialBalanceAccount {
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}

interface TrialBalanceData {
  accounts: TrialBalanceAccount[];
  totalDebit: string;
  totalCredit: string;
}

interface ReportAccount {
  id: string;
  code: string;
  name: string;
  balance: string;
}

interface ProfitLossData {
  revenue: ReportAccount[];
  expenses: ReportAccount[];
  totalRevenue: string;
  totalExpenses: string;
  netIncome: string;
}

interface BalanceSheetData {
  assets: ReportAccount[];
  liabilities: ReportAccount[];
  equity: ReportAccount[];
  netIncome: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
}

interface VatCategory {
  count: number;
  netAmount: string;
  vatAmount: string;
  grossAmount?: string;
}

interface VatReturnData {
  period: { from: string; to: string };
  sales: VatCategory;
  creditNotes: VatCategory;
  purchases: VatCategory;
  expenses: VatCategory;
  outputVat: string;
  outputNet: string;
  inputVat: string;
  inputNet: string;
  netVatPayable: string;
}

function formatEUR(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return "€" + (num || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getFirstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getCurrentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function padDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getQuarterDates(qStr: string): { from: string; to: string } {
  const [yearStr, qPart] = qStr.split("-Q");
  const year = parseInt(yearStr);
  const q = parseInt(qPart);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = q * 3;
  const lastDay = new Date(year, endMonth, 0).getDate();
  return { from: padDate(year, startMonth, 1), to: padDate(year, endMonth, lastDay) };
}

function getAvailableQuarters(): string[] {
  const quarters: string[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  for (let y = currentYear - 1; y <= currentYear + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      quarters.push(`${y}-Q${q}`);
    }
  }
  return quarters;
}

function formatQuarterLabel(qStr: string): string {
  const [yearStr, qPart] = qStr.split("-Q");
  const q = parseInt(qPart);
  const months = ["Jan-Mar", "Apr-Jun", "Jul-Sep", "Oct-Dec"];
  return `Q${q} ${yearStr} (${months[q - 1]})`;
}

export default function AccountingReports() {
  const [plFrom, setPlFrom] = useState(getFirstDayOfMonth);
  const [plTo, setPlTo] = useState(getToday);
  const [bsAsOf, setBsAsOf] = useState(getToday);
  const [vatQuarter, setVatQuarter] = useState(getCurrentQuarter);

  const { data: trialBalance, isLoading: tbLoading } = useQuery<TrialBalanceData>({
    queryKey: ["/api/reports/trial-balance"],
  });

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossData>({
    queryKey: ["/api/reports/profit-loss", plFrom, plTo],
  });

  const { data: balanceSheet, isLoading: bsLoading } = useQuery<BalanceSheetData>({
    queryKey: ["/api/reports/balance-sheet", bsAsOf],
  });

  const vatDates = getQuarterDates(vatQuarter);
  const { data: vatReturn, isLoading: vatLoading } = useQuery<VatReturnData>({
    queryKey: ["/api/reports/vat-return", vatDates.from, vatDates.to],
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Accounting Reports"
        description="Trial Balance, Profit & Loss, Balance Sheet, and VAT Return reports"
      />

      <Tabs defaultValue="trial-balance">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="trial-balance" data-testid="tab-trial-balance">
            <Scale className="w-4 h-4 mr-1" /> Trial Balance
          </TabsTrigger>
          <TabsTrigger value="profit-loss" data-testid="tab-profit-loss">
            <TrendingUp className="w-4 h-4 mr-1" /> Profit & Loss
          </TabsTrigger>
          <TabsTrigger value="balance-sheet" data-testid="tab-balance-sheet">
            <BarChart3 className="w-4 h-4 mr-1" /> Balance Sheet
          </TabsTrigger>
          <TabsTrigger value="vat-return" data-testid="tab-vat-return">
            <Receipt className="w-4 h-4 mr-1" /> VAT Return
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trial-balance" className="mt-4 space-y-4">
          <div className="flex items-center justify-end">
            <Button variant="outline" onClick={() => window.print()} data-testid="button-print-trial-balance">
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
          </div>

          {tbLoading ? (
            <Skeleton className="h-64" />
          ) : trialBalance ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="th-tb-code">Code</TableHead>
                      <TableHead data-testid="th-tb-name">Account Name</TableHead>
                      <TableHead data-testid="th-tb-type">Type</TableHead>
                      <TableHead className="text-right" data-testid="th-tb-debit">Debit</TableHead>
                      <TableHead className="text-right" data-testid="th-tb-credit">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.accounts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground" data-testid="text-tb-empty">
                          No accounts found
                        </TableCell>
                      </TableRow>
                    ) : (
                      trialBalance.accounts.map((acc, idx) => (
                        <TableRow key={`${acc.code}-${idx}`} data-testid={`row-tb-${acc.code}`}>
                          <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                          <TableCell className="text-sm">{acc.name}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">{acc.type}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm" data-testid={`text-tb-debit-${acc.code}`}>
                            {formatEUR(acc.debit)}
                          </TableCell>
                          <TableCell className="text-right text-sm" data-testid={`text-tb-credit-${acc.code}`}>
                            {formatEUR(acc.credit)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell colSpan={3}>Totals</TableCell>
                      <TableCell className="text-right" data-testid="text-tb-total-debit">
                        {formatEUR(trialBalance.totalDebit)}
                      </TableCell>
                      <TableCell className="text-right" data-testid="text-tb-total-credit">
                        {formatEUR(trialBalance.totalCredit)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="profit-loss" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input
                    type="date"
                    value={plFrom}
                    onChange={(e) => setPlFrom(e.target.value)}
                    data-testid="input-pl-date-from"
                  />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input
                    type="date"
                    value={plTo}
                    onChange={(e) => setPlTo(e.target.value)}
                    data-testid="input-pl-date-to"
                  />
                </div>
                <Button variant="outline" onClick={() => window.print()} data-testid="button-print-profit-loss">
                  <Printer className="w-4 h-4 mr-2" /> Print
                </Button>
              </div>
            </CardContent>
          </Card>

          {plLoading ? (
            <Skeleton className="h-64" />
          ) : profitLoss ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Revenue</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profitLoss.revenue.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No revenue accounts
                          </TableCell>
                        </TableRow>
                      ) : (
                        profitLoss.revenue.map((acc) => (
                          <TableRow key={acc.id} data-testid={`row-pl-revenue-${acc.code}`}>
                            <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                            <TableCell className="text-sm">{acc.name}</TableCell>
                            <TableCell className="text-right text-sm" data-testid={`text-pl-revenue-amount-${acc.code}`}>
                              {formatEUR(acc.balance)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Revenue</TableCell>
                        <TableCell className="text-right" data-testid="text-pl-total-revenue">
                          {formatEUR(profitLoss.totalRevenue)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Expenses</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profitLoss.expenses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No expense accounts
                          </TableCell>
                        </TableRow>
                      ) : (
                        profitLoss.expenses.map((acc) => (
                          <TableRow key={acc.id} data-testid={`row-pl-expense-${acc.code}`}>
                            <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                            <TableCell className="text-sm">{acc.name}</TableCell>
                            <TableCell className="text-right text-sm" data-testid={`text-pl-expense-amount-${acc.code}`}>
                              {formatEUR(acc.balance)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Expenses</TableCell>
                        <TableCell className="text-right" data-testid="text-pl-total-expenses">
                          {formatEUR(profitLoss.totalExpenses)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardContent className="p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-sm text-muted-foreground">Total Revenue</span>
                      <span className="text-sm font-medium" data-testid="text-pl-summary-revenue">
                        {formatEUR(profitLoss.totalRevenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-sm text-muted-foreground">Total Expenses</span>
                      <span className="text-sm font-medium" data-testid="text-pl-summary-expenses">
                        {formatEUR(profitLoss.totalExpenses)}
                      </span>
                    </div>
                    <div className="border-t pt-2 flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-base font-semibold">Net Income</span>
                      <span
                        className={`text-lg font-bold ${parseFloat(profitLoss.netIncome) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                        data-testid="text-pl-net-income"
                      >
                        {formatEUR(profitLoss.netIncome)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="balance-sheet" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs">As of Date</Label>
                  <Input
                    type="date"
                    value={bsAsOf}
                    onChange={(e) => setBsAsOf(e.target.value)}
                    data-testid="input-bs-date"
                  />
                </div>
                <Button variant="outline" onClick={() => window.print()} data-testid="button-print-balance-sheet">
                  <Printer className="w-4 h-4 mr-2" /> Print
                </Button>
              </div>
            </CardContent>
          </Card>

          {bsLoading ? (
            <Skeleton className="h-64" />
          ) : balanceSheet ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Assets</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balanceSheet.assets.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No asset accounts
                          </TableCell>
                        </TableRow>
                      ) : (
                        balanceSheet.assets.map((acc) => (
                          <TableRow key={acc.id} data-testid={`row-bs-asset-${acc.code}`}>
                            <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                            <TableCell className="text-sm">{acc.name}</TableCell>
                            <TableCell className="text-right text-sm" data-testid={`text-bs-asset-balance-${acc.code}`}>
                              {formatEUR(acc.balance)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Assets</TableCell>
                        <TableCell className="text-right" data-testid="text-bs-total-assets">
                          {formatEUR(balanceSheet.totalAssets)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Liabilities</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balanceSheet.liabilities.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No liability accounts
                          </TableCell>
                        </TableRow>
                      ) : (
                        balanceSheet.liabilities.map((acc) => (
                          <TableRow key={acc.id} data-testid={`row-bs-liability-${acc.code}`}>
                            <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                            <TableCell className="text-sm">{acc.name}</TableCell>
                            <TableCell className="text-right text-sm" data-testid={`text-bs-liability-balance-${acc.code}`}>
                              {formatEUR(acc.balance)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Liabilities</TableCell>
                        <TableCell className="text-right" data-testid="text-bs-total-liabilities">
                          {formatEUR(balanceSheet.totalLiabilities)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Equity</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balanceSheet.equity.length === 0 && parseFloat(balanceSheet.netIncome) === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No equity accounts
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {balanceSheet.equity.map((acc) => (
                            <TableRow key={acc.id} data-testid={`row-bs-equity-${acc.code}`}>
                              <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                              <TableCell className="text-sm">{acc.name}</TableCell>
                              <TableCell className="text-right text-sm" data-testid={`text-bs-equity-balance-${acc.code}`}>
                                {formatEUR(acc.balance)}
                              </TableCell>
                            </TableRow>
                          ))}
                          <TableRow data-testid="row-bs-net-income">
                            <TableCell className="font-mono text-sm text-muted-foreground">—</TableCell>
                            <TableCell className="text-sm text-muted-foreground">Current Year Net Income</TableCell>
                            <TableCell
                              className={`text-right text-sm font-medium ${parseFloat(balanceSheet.netIncome) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                              data-testid="text-bs-net-income"
                            >
                              {formatEUR(balanceSheet.netIncome)}
                            </TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Equity</TableCell>
                        <TableCell className="text-right" data-testid="text-bs-total-equity">
                          {formatEUR(balanceSheet.totalEquity)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardContent className="p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-sm text-muted-foreground">Total Assets</span>
                      <span className="text-sm font-medium" data-testid="text-bs-summary-assets">
                        {formatEUR(balanceSheet.totalAssets)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-sm text-muted-foreground">Total Liabilities + Equity</span>
                      <span className="text-sm font-medium" data-testid="text-bs-summary-liabilities-equity">
                        {formatEUR(
                          parseFloat(balanceSheet.totalLiabilities) + parseFloat(balanceSheet.totalEquity)
                        )}
                      </span>
                    </div>
                    <div className="border-t pt-2 flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-base font-semibold">Balance Check</span>
                      {Math.abs(
                        parseFloat(balanceSheet.totalAssets) -
                          (parseFloat(balanceSheet.totalLiabilities) + parseFloat(balanceSheet.totalEquity))
                      ) < 0.01 ? (
                        <Badge variant="default" data-testid="badge-bs-balanced">Balanced</Badge>
                      ) : (
                        <Badge variant="destructive" data-testid="badge-bs-unbalanced">Unbalanced</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="vat-return" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-end gap-4 flex-wrap">
                <div>
                  <Label className="text-xs">Quarter</Label>
                  <Select value={vatQuarter} onValueChange={setVatQuarter}>
                    <SelectTrigger className="w-[260px]" data-testid="select-vat-quarter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableQuarters().map((q) => (
                        <SelectItem key={q} value={q}>{formatQuarterLabel(q)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-xs text-muted-foreground">
                  Period: {vatDates.from} to {vatDates.to}
                </div>
                <Button variant="outline" onClick={() => window.print()} data-testid="button-print-vat-return">
                  <Printer className="w-4 h-4 mr-2" /> Print
                </Button>
              </div>
            </CardContent>
          </Card>

          {vatLoading ? (
            <Skeleton className="h-64" />
          ) : vatReturn ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Output VAT (Sales)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="th-vat-output-desc">Description</TableHead>
                        <TableHead className="text-center" data-testid="th-vat-output-count">Count</TableHead>
                        <TableHead className="text-right" data-testid="th-vat-output-net">Net Amount</TableHead>
                        <TableHead className="text-right" data-testid="th-vat-output-vat">VAT Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow data-testid="row-vat-sales">
                        <TableCell className="text-sm">Sales Invoices</TableCell>
                        <TableCell className="text-center text-sm" data-testid="text-vat-sales-count">{vatReturn.sales.count}</TableCell>
                        <TableCell className="text-right text-sm" data-testid="text-vat-sales-net">{formatEUR(vatReturn.sales.netAmount)}</TableCell>
                        <TableCell className="text-right text-sm font-medium" data-testid="text-vat-sales-vat">{formatEUR(vatReturn.sales.vatAmount)}</TableCell>
                      </TableRow>
                      {vatReturn.creditNotes.count > 0 && (
                        <TableRow data-testid="row-vat-credit-notes">
                          <TableCell className="text-sm text-red-600 dark:text-red-400">Less: Credit Notes</TableCell>
                          <TableCell className="text-center text-sm text-red-600 dark:text-red-400" data-testid="text-vat-cn-count">{vatReturn.creditNotes.count}</TableCell>
                          <TableCell className="text-right text-sm text-red-600 dark:text-red-400" data-testid="text-vat-cn-net">({formatEUR(vatReturn.creditNotes.netAmount)})</TableCell>
                          <TableCell className="text-right text-sm font-medium text-red-600 dark:text-red-400" data-testid="text-vat-cn-vat">({formatEUR(vatReturn.creditNotes.vatAmount)})</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Output VAT</TableCell>
                        <TableCell className="text-right" data-testid="text-vat-output-net-total">{formatEUR(vatReturn.outputNet)}</TableCell>
                        <TableCell className="text-right" data-testid="text-vat-output-total">{formatEUR(vatReturn.outputVat)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Input VAT (Purchases)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-center">Count</TableHead>
                        <TableHead className="text-right">Net Amount</TableHead>
                        <TableHead className="text-right">VAT Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow data-testid="row-vat-purchases">
                        <TableCell className="text-sm">Purchase Invoices</TableCell>
                        <TableCell className="text-center text-sm" data-testid="text-vat-purch-count">{vatReturn.purchases.count}</TableCell>
                        <TableCell className="text-right text-sm" data-testid="text-vat-purch-net">{formatEUR(vatReturn.purchases.netAmount)}</TableCell>
                        <TableCell className="text-right text-sm font-medium" data-testid="text-vat-purch-vat">{formatEUR(vatReturn.purchases.vatAmount)}</TableCell>
                      </TableRow>
                      <TableRow data-testid="row-vat-expenses">
                        <TableCell className="text-sm">Business Expenses</TableCell>
                        <TableCell className="text-center text-sm" data-testid="text-vat-exp-count">{vatReturn.expenses.count}</TableCell>
                        <TableCell className="text-right text-sm" data-testid="text-vat-exp-net">{formatEUR(vatReturn.expenses.netAmount)}</TableCell>
                        <TableCell className="text-right text-sm font-medium" data-testid="text-vat-exp-vat">{formatEUR(vatReturn.expenses.vatAmount)}</TableCell>
                      </TableRow>
                    </TableBody>
                    <TableFooter>
                      <TableRow className="font-bold">
                        <TableCell colSpan={2}>Total Input VAT</TableCell>
                        <TableCell className="text-right" data-testid="text-vat-input-net-total">{formatEUR(vatReturn.inputNet)}</TableCell>
                        <TableCell className="text-right" data-testid="text-vat-input-total">{formatEUR(vatReturn.inputVat)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">VAT Return Summary — {formatQuarterLabel(vatQuarter)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">Output VAT (collected from sales)</span>
                      <span className="text-sm font-medium" data-testid="text-vat-summary-output">{formatEUR(vatReturn.outputVat)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">Input VAT (paid on purchases & expenses)</span>
                      <span className="text-sm font-medium" data-testid="text-vat-summary-input">{formatEUR(vatReturn.inputVat)}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-base font-semibold">
                        {parseFloat(vatReturn.netVatPayable) >= 0 ? "Net VAT Payable to Tax Department" : "Net VAT Refundable from Tax Department"}
                      </span>
                      <span
                        className={`text-lg font-bold ${parseFloat(vatReturn.netVatPayable) >= 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                        data-testid="text-vat-net-payable"
                      >
                        {formatEUR(Math.abs(parseFloat(vatReturn.netVatPayable)))}
                      </span>
                    </div>
                    <div className="pt-2 text-xs text-muted-foreground">
                      <p>Cyprus VAT Return (Form VAT 4) — Quarterly filing at 19% standard rate</p>
                      <p>Filing deadline: 10th day of the month following the quarter end</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}