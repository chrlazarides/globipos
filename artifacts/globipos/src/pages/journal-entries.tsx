import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, ChevronDown, ChevronRight, Loader2, RefreshCw, Pencil } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { JournalEntry, JournalEntryLine, Account } from "@shared/schema";

interface JournalEntryWithLines extends JournalEntry {
  lines?: (JournalEntryLine & { accountCode?: string; accountName?: string })[];
}

interface LineItem {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

const sourceTypeBadgeVariant: Record<string, string> = {
  manual: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  invoice: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  payment: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  purchase: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  expense: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  credit_note: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  supplier_payment: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
};

function formatEUR(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return "€" + (num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SourceBadge({ type }: { type: string | null }) {
  const label = type || "unknown";
  const cls = sourceTypeBadgeVariant[label] || sourceTypeBadgeVariant.manual;
  return (
    <Badge variant="outline" className={`no-default-hover-elevate no-default-active-elevate ${cls}`} data-testid={`badge-source-${label}`}>
      {label.replace("_", " ")}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "posted"
    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return (
    <Badge variant="outline" className={`no-default-hover-elevate no-default-active-elevate ${cls}`} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

function ExpandedEntryDetail({ entryId }: { entryId: string }) {
  const { data, isLoading } = useQuery<JournalEntryWithLines>({
    queryKey: ["/api/journal-entries", entryId],
  });

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={8} className="p-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const lines = data?.lines || [];

  return (
    <TableRow data-testid={`entry-detail-${entryId}`}>
      <TableCell colSpan={8} className="p-0">
        <div className="bg-muted/30 p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, idx) => (
                <TableRow key={line.id || idx} data-testid={`entry-line-${idx}`}>
                  <TableCell className="text-sm">{line.accountCode || "-"}</TableCell>
                  <TableCell className="text-sm">{line.accountName || "-"}</TableCell>
                  <TableCell className="text-sm text-right">{parseFloat(line.debit) > 0 ? formatEUR(line.debit) : "-"}</TableCell>
                  <TableCell className="text-sm text-right">{parseFloat(line.credit) > 0 ? formatEUR(line.credit) : "-"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{line.description || "-"}</TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-4">
                    No lines found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </TableCell>
    </TableRow>
  );
}

const emptyLine = (): LineItem => ({ accountId: "", debit: "", credit: "", description: "" });

export default function JournalEntries() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [formDescription, setFormDescription] = useState("");
  const [formReference, setFormReference] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine(), emptyLine()]);
  const [validationError, setValidationError] = useState("");

  const { data: entries = [], isLoading } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal-entries"],
  });

  const { data: accountsList = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await apiRequest("POST", "/api/journal-entries", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({ title: "Journal entry created" });
      resetForm();
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      const res = await apiRequest("PATCH", `/api/journal-entries/${id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({ title: "Journal entry updated" });
      resetForm();
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/journal-entries/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({ title: "Journal entry deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const repostMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounting/repost-journals", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({ title: "Journals reposted", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Repost failed", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormDescription("");
    setFormReference("");
    setLines([emptyLine(), emptyLine()]);
    setValidationError("");
    setEditingId(null);
  }

  function openNew() {
    resetForm();
    setDialogOpen(true);
  }

  async function openEdit(entry: JournalEntry) {
    // Fetch the full entry with lines
    try {
      const res = await fetch(`/api/journal-entries/${entry.id}`, { credentials: "include" });
      const data: JournalEntryWithLines = await res.json();
      const entryDate = typeof entry.date === "string" ? entry.date : new Date(entry.date).toISOString().split("T")[0];
      setEditingId(entry.id);
      setFormDate(entryDate);
      setFormDescription(entry.description || "");
      setFormReference(entry.reference || "");
      setLines(
        (data.lines || []).map((l) => ({
          accountId: l.accountId,
          debit: parseFloat(l.debit) > 0 ? l.debit : "",
          credit: parseFloat(l.credit) > 0 ? l.credit : "",
          description: l.description || "",
        }))
      );
      setValidationError("");
      setDialogOpen(true);
    } catch {
      toast({ title: "Failed to load entry", variant: "destructive" });
    }
  }

  function updateLine(index: number, field: keyof LineItem, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);

  function handleSubmit() {
    if (!formDate || !formDescription) {
      setValidationError("Date and description are required.");
      return;
    }

    const validLines = lines.filter((l) => l.accountId);
    if (validLines.length < 2) {
      setValidationError("At least two lines with accounts are required.");
      return;
    }

    const debitTotal = validLines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const creditTotal = validLines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);

    if (Math.abs(debitTotal - creditTotal) > 0.005) {
      setValidationError(`Total debits (${formatEUR(debitTotal)}) must equal total credits (${formatEUR(creditTotal)}).`);
      return;
    }

    setValidationError("");
    const payload = {
      date: formDate,
      description: formDescription,
      reference: formReference,
      sourceType: "manual",
      lines: validLines.map((l) => ({
        accountId: l.accountId,
        debit: (parseFloat(l.debit) || 0).toFixed(2),
        credit: (parseFloat(l.credit) || 0).toFixed(2),
        description: l.description,
      })),
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Journal Entries"
        description="View and manage accounting journal entries"
        action={
          <div className="flex gap-2">
            <Button
              data-testid="button-repost-journals"
              variant="outline"
              onClick={() => {
                if (confirm("This will delete and regenerate all auto-generated journal entries (purchases, sales, payments, expenses) from the current transaction data. Manual entries are preserved. Continue?")) {
                  repostMutation.mutate();
                }
              }}
              disabled={repostMutation.isPending}
            >
              {repostMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              Repost All
            </Button>
            <Button
              data-testid="button-new-journal-entry"
              onClick={openNew}
            >
              <Plus className="w-4 h-4 mr-1" /> New Journal Entry
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-3" data-testid="loading-skeleton">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table data-testid="table-journal-entries">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Entry #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8" data-testid="text-empty-entries">
                      No journal entries found
                    </TableCell>
                  </TableRow>
                )}
                {entries.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <>
                      <TableRow
                        key={entry.id}
                        className="cursor-pointer hover-elevate"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        data-testid={`row-entry-${entry.id}`}
                      >
                        <TableCell className="w-8">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-date-${entry.id}`}>
                          {formatDate(entry.date)}
                        </TableCell>
                        <TableCell className="text-sm font-medium" data-testid={`text-entry-number-${entry.id}`}>
                          {entry.entryNumber}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-description-${entry.id}`}>
                          {entry.description}
                        </TableCell>
                        <TableCell>
                          <SourceBadge type={entry.sourceType} />
                        </TableCell>
                        <TableCell className="text-sm text-right font-medium" data-testid={`text-amount-${entry.id}`}>
                          {formatEUR(entry.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Edit entry"
                              data-testid={`button-edit-${entry.id}`}
                              onClick={(e) => { e.stopPropagation(); openEdit(entry); }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Delete entry"
                              data-testid={`button-delete-${entry.id}`}
                              disabled={deleteMutation.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Delete journal entry ${entry.entryNumber}? This will reverse its account balance impacts.`)) {
                                  deleteMutation.mutate(entry.id);
                                }
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && <ExpandedEntryDetail key={`detail-${entry.id}`} entryId={entry.id} />}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-journal-entry">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Journal Entry" : "New Journal Entry"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="je-date">Date</Label>
                <Input
                  id="je-date"
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  data-testid="input-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="je-description">Description</Label>
                <Input
                  id="je-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Entry description"
                  data-testid="input-description"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="je-reference">Reference</Label>
                <Input
                  id="je-reference"
                  value={formReference}
                  onChange={(e) => setFormReference(e.target.value)}
                  placeholder="Optional reference"
                  data-testid="input-reference"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <Label>Line Items</Label>
                <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-line">
                  <Plus className="w-3 h-3 mr-1" /> Add Line
                </Button>
              </div>

              <Table data-testid="table-line-items">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">Account</TableHead>
                    <TableHead className="w-[140px]">Debit</TableHead>
                    <TableHead className="w-[140px]">Credit</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={idx} data-testid={`line-item-${idx}`}>
                      <TableCell>
                        <Select
                          value={line.accountId}
                          onValueChange={(v) => updateLine(idx, "accountId", v)}
                        >
                          <SelectTrigger data-testid={`select-account-${idx}`}>
                            <SelectValue placeholder="Select account" />
                          </SelectTrigger>
                          <SelectContent>
                            {accountsList.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id}>
                                {acc.code} - {acc.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.debit}
                          onChange={(e) => updateLine(idx, "debit", e.target.value)}
                          placeholder="0.00"
                          data-testid={`input-debit-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.credit}
                          onChange={(e) => updateLine(idx, "credit", e.target.value)}
                          placeholder="0.00"
                          data-testid={`input-credit-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={line.description}
                          onChange={(e) => updateLine(idx, "description", e.target.value)}
                          placeholder="Line description"
                          data-testid={`input-line-desc-${idx}`}
                        />
                      </TableCell>
                      <TableCell>
                        {lines.length > 2 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeLine(idx)}
                            data-testid={`button-remove-line-${idx}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell className="text-right">Totals</TableCell>
                    <TableCell data-testid="text-total-debit">
                      {formatEUR(totalDebit)}
                    </TableCell>
                    <TableCell data-testid="text-total-credit">
                      {formatEUR(totalCredit)}
                    </TableCell>
                    <TableCell colSpan={2}>
                      {Math.abs(totalDebit - totalCredit) > 0.005 && (
                        <span className="text-sm text-destructive" data-testid="text-balance-warning">
                          Difference: {formatEUR(Math.abs(totalDebit - totalCredit))}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {validationError && (
              <p className="text-sm text-destructive" data-testid="text-validation-error">
                {validationError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setDialogOpen(false); }} data-testid="button-cancel">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="button-submit-entry">
              {isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editingId ? "Save Changes" : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
