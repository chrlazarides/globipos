import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Scale, TrendingUp, BarChart3 } from "lucide-react";

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
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
}

function formatEUR(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(num || 0);
}

function getFirstDayOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split("T")[0];
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

export default function AccountingReports() {
  const [plFrom, setPlFrom] = useState(getFirstDayOfMonth);
  const [plTo, setPlTo] = useState(getToday);
  const [bsAsOf, setBsAsOf] = useState(getToday);

  const { data: trialBalance, isLoading: tbLoading } = useQuery<TrialBalanceData>({
    queryKey: ["/api/reports/trial-balance"],
  });

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossData>({
    queryKey: ["/api/reports/profit-loss", plFrom, plTo],
  });

  const { data: balanceSheet, isLoading: bsLoading } = useQuery<BalanceSheetData>({
    queryKey: ["/api/reports/balance-sheet", bsAsOf],
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Accounting Reports"
        description="Trial Balance, Profit & Loss, and Balance Sheet reports"
      />

      <Tabs defaultValue="trial-balance">
        <TabsList>
          <TabsTrigger value="trial-balance" data-testid="tab-trial-balance">
            <Scale className="w-4 h-4 mr-1" /> Trial Balance
          </TabsTrigger>
          <TabsTrigger value="profit-loss" data-testid="tab-profit-loss">
            <TrendingUp className="w-4 h-4 mr-1" /> Profit & Loss
          </TabsTrigger>
          <TabsTrigger value="balance-sheet" data-testid="tab-balance-sheet">
            <BarChart3 className="w-4 h-4 mr-1" /> Balance Sheet
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
                      {balanceSheet.equity.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                            No equity accounts
                          </TableCell>
                        </TableRow>
                      ) : (
                        balanceSheet.equity.map((acc) => (
                          <TableRow key={acc.id} data-testid={`row-bs-equity-${acc.code}`}>
                            <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                            <TableCell className="text-sm">{acc.name}</TableCell>
                            <TableCell className="text-right text-sm" data-testid={`text-bs-equity-balance-${acc.code}`}>
                              {formatEUR(acc.balance)}
                            </TableCell>
                          </TableRow>
                        ))
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
      </Tabs>
    </div>
  );
}