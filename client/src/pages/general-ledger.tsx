import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import type { Account } from "@shared/schema";

function formatEUR(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(value);
}

interface LedgerEntry {
  date: string;
  entryNumber: string;
  description: string;
  reference: string | null;
  debit: string;
  credit: string;
}

interface LedgerResponse {
  entries: LedgerEntry[];
  openingBalance: string;
}

export default function GeneralLedger() {
  const { accountId } = useParams<{ accountId: string }>();

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  const account = accounts.find((a) => a.id === accountId);

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<LedgerResponse>({
    queryKey: ["/api/reports/general-ledger", accountId, dateFrom, dateTo],
    enabled: !!accountId && !!dateFrom && !!dateTo,
  });

  const isDebitNormal = account
    ? ["asset", "expense"].includes(account.type)
    : true;

  const entries = ledgerData?.entries ?? [];
  const openingBalance = parseFloat(ledgerData?.openingBalance ?? "0");

  let runningBalance = openingBalance;
  const rowsWithBalance = entries.map((entry) => {
    const debit = parseFloat(entry.debit || "0");
    const credit = parseFloat(entry.credit || "0");
    if (isDebitNormal) {
      runningBalance += debit - credit;
    } else {
      runningBalance += credit - debit;
    }
    return { ...entry, runningBalance };
  });

  const isLoading = accountsLoading || ledgerLoading;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={account ? `${account.code} - ${account.name}` : "General Ledger"}
        description="View account transactions and running balance"
        action={
          <Link href="/accounting/chart-of-accounts">
            <Button variant="outline" data-testid="button-back-to-coa">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Chart of Accounts
            </Button>
          </Link>
        }
      />

      {accountsLoading ? (
        <Skeleton className="h-24" />
      ) : account ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Account Code</span>
                <p className="font-medium" data-testid="text-account-code">{account.code}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Account Name</span>
                <p className="font-medium" data-testid="text-account-name">{account.name}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Type</span>
                <div className="mt-1">
                  <Badge variant="secondary" data-testid="badge-account-type">
                    {account.type}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Opening Balance</span>
                <p className="font-medium" data-testid="text-opening-balance">{formatEUR(openingBalance)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-center text-muted-foreground" data-testid="text-account-not-found">
            Account not found
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Running Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsWithBalance.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground" data-testid="text-empty-state">
                      No transactions found for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    <TableRow>
                      <TableCell colSpan={6} className="font-medium text-sm text-muted-foreground">
                        Opening Balance
                      </TableCell>
                      <TableCell className="text-right font-medium text-sm" data-testid="text-opening-balance-row">
                        {formatEUR(openingBalance)}
                      </TableCell>
                    </TableRow>
                    {rowsWithBalance.map((entry, index) => (
                      <TableRow key={index} data-testid={`row-ledger-entry-${index}`}>
                        <TableCell className="text-sm">
                          {formatDate(entry.date)}
                        </TableCell>
                        <TableCell className="text-sm font-medium" data-testid={`text-entry-number-${index}`}>
                          {entry.entryNumber}
                        </TableCell>
                        <TableCell className="text-sm">{entry.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{entry.reference || "-"}</TableCell>
                        <TableCell className="text-right text-sm" data-testid={`text-debit-${index}`}>
                          {parseFloat(entry.debit) > 0 ? formatEUR(parseFloat(entry.debit)) : "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm" data-testid={`text-credit-${index}`}>
                          {parseFloat(entry.credit) > 0 ? formatEUR(parseFloat(entry.credit)) : "-"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium" data-testid={`text-running-balance-${index}`}>
                          {formatEUR(entry.runningBalance)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
