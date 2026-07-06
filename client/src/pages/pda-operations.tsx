import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ClipboardList, ArrowLeftRight, Tags, AlertTriangle, CheckCircle2, ScanLine } from "lucide-react";

interface StockTakeSession {
  id: string;
  reference: string;
  locationLabel: string | null;
  status: string;
  createdByUsername: string;
  createdAt: string;
  submittedAt: string | null;
}

interface Transfer {
  id: string;
  transferNumber: string;
  fromLocation: string;
  toLocation: string;
  status: string;
  createdByUsername: string;
  createdAt: string;
  completedAt: string | null;
}

interface AuditRow {
  itemId: string;
  itemName: string;
  sku: string;
  currentPrice: number;
  lastPrintedPrice: number | null;
  lastPrintedAt: string | null;
  needsReprint: boolean;
}

interface GrvLine {
  id: string;
  descriptionRaw: string;
  itemId: string | null;
  itemName: string | null;
  sku: string | null;
  expectedQuantity: number;
  receivedQuantity: number;
  unitCost: string;
}

interface Grv {
  id: string;
  grvNumber: string;
  supplierId: string | null;
  invoiceNumberRaw: string | null;
  invoiceDateRaw: string | null;
  status: string;
  hasDiscrepancies: boolean;
  purchaseInvoiceId: string | null;
  createdByUsername: string;
  createdAt: string;
  items: GrvLine[];
}

interface SupplierLite {
  id: string;
  name: string;
}

function statusBadge(status: string) {
  const variant = status === "submitted" || status === "completed" ? "default" : "secondary";
  return <Badge variant={variant} className="capitalize" data-testid={`badge-status-${status}`}>{status}</Badge>;
}

function grvStatusBadge(grv: Grv) {
  if (grv.status !== "completed") return <Badge variant="secondary" data-testid={`badge-grv-status-${grv.id}`}>Receiving</Badge>;
  if (grv.hasDiscrepancies) return <Badge variant="destructive" data-testid={`badge-grv-status-${grv.id}`}>Discrepancy</Badge>;
  return <Badge data-testid={`badge-grv-status-${grv.id}`}>Completed</Badge>;
}

interface ItemLite { id: string; name: string; sku: string; }

function GrvRow({ grv, suppliers, catalogItems }: { grv: Grv; suppliers: SupplierLite[]; catalogItems: ItemLite[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState(grv.supplierId || "");
  const [expanded, setExpanded] = useState(false);
  const unmatchedLines = grv.items.filter((i) => !i.itemId);
  const unmatchedCount = unmatchedLines.length;
  const discrepantCount = grv.items.filter((i) => i.receivedQuantity !== i.expectedQuantity).length;

  const assignSupplier = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/pda/grv/${grv.id}`, { supplierId: id });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pda/grv"] });
      toast({ title: "Supplier assigned" });
    },
    onError: (e: any) => toast({ title: "Failed to assign supplier", description: e.message, variant: "destructive" }),
  });

  const matchItem = useMutation({
    mutationFn: async ({ lineId, itemId }: { lineId: string; itemId: string }) => {
      const res = await apiRequest("PATCH", `/api/pda/grv/items/${lineId}`, { itemId });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/pda/grv"] });
    },
    onError: (e: any) => toast({ title: "Failed to match item", description: e.message, variant: "destructive" }),
  });

  return (
    <>
    <TableRow data-testid={`row-grv-${grv.id}`}>
      <TableCell className="font-medium">{grv.grvNumber}</TableCell>
      <TableCell>{grv.invoiceNumberRaw || "—"}</TableCell>
      <TableCell>
        {grv.status === "completed" ? (
          suppliers.find((s) => s.id === grv.supplierId)?.name || "—"
        ) : (
          <Select value={supplierId} onValueChange={(v) => { setSupplierId(v); assignSupplier.mutate(v); }}>
            <SelectTrigger className="w-[180px]" data-testid={`select-grv-supplier-${grv.id}`}>
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell>
        {unmatchedCount > 0 ? (
          <button
            className="text-xs text-destructive underline"
            onClick={() => setExpanded((e) => !e)}
            data-testid={`button-toggle-unmatched-${grv.id}`}
          >
            {unmatchedCount} unmatched line(s)
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">All matched</span>
        )}
      </TableCell>
      <TableCell>
        {discrepantCount > 0 ? (
          <Badge variant="destructive" data-testid={`badge-discrepancy-count-${grv.id}`}>{discrepantCount} line(s)</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell>
        {grv.purchaseInvoiceId ? (
          <a
            href={`/invoices/${grv.purchaseInvoiceId}`}
            className="text-xs text-primary underline"
            data-testid={`link-purchase-invoice-${grv.id}`}
          >
            View invoice
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>{grv.createdByUsername}</TableCell>
      <TableCell>{new Date(grv.createdAt).toLocaleString()}</TableCell>
      <TableCell>{grvStatusBadge(grv)}</TableCell>
    </TableRow>
    {expanded && unmatchedCount > 0 && (
      <TableRow data-testid={`row-grv-${grv.id}-matching`}>
        <TableCell colSpan={9} className="bg-muted/40">
          <div className="space-y-2 py-2">
            {unmatchedLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 text-sm" data-testid={`row-unmatched-${line.id}`}>
                <span className="flex-1">{line.descriptionRaw}</span>
                <Select onValueChange={(itemId) => matchItem.mutate({ lineId: line.id, itemId })}>
                  <SelectTrigger className="w-[220px]" data-testid={`select-match-item-${line.id}`}>
                    <SelectValue placeholder="Match to catalog item" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogItems.map((it) => (
                      <SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </TableCell>
      </TableRow>
    )}
    </>
  );
}

export default function PdaOperations() {
  const sessionsQuery = useQuery<StockTakeSession[]>({ queryKey: ["/api/pda/stock-take/sessions"] });
  const transfersQuery = useQuery<Transfer[]>({ queryKey: ["/api/pda/transfers"] });
  const auditQuery = useQuery<AuditRow[]>({ queryKey: ["/api/pda/agoranomia/audit"] });
  const grvQuery = useQuery<Grv[]>({ queryKey: ["/api/pda/grv"] });
  const suppliersQuery = useQuery<SupplierLite[]>({ queryKey: ["/api/suppliers"] });
  const catalogItemsQuery = useQuery<ItemLite[]>({ queryKey: ["/api/items"] });

  const needsReprint = (auditQuery.data || []).filter((r) => r.needsReprint);

  return (
    <div className="space-y-6" data-testid="page-pda-operations">
      <PageHeader
        title="PDA Operations"
        description="Handheld scanner activity: stock take sessions, stock transfers, and shelf-label compliance (Agoranomia)"
      />

      <Tabs defaultValue="stock-take">
        <TabsList>
          <TabsTrigger value="stock-take" data-testid="tab-stock-take">
            <ClipboardList className="w-4 h-4 mr-1.5" /> Stock Take
          </TabsTrigger>
          <TabsTrigger value="transfers" data-testid="tab-transfers">
            <ArrowLeftRight className="w-4 h-4 mr-1.5" /> Transfers
          </TabsTrigger>
          <TabsTrigger value="agoranomia" data-testid="tab-agoranomia">
            <Tags className="w-4 h-4 mr-1.5" /> Agoranomia
          </TabsTrigger>
          <TabsTrigger value="grv" data-testid="tab-grv">
            <ScanLine className="w-4 h-4 mr-1.5" /> Goods Received
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock-take" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock Take Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {sessionsQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(sessionsQuery.data || []).map((s) => (
                      <TableRow key={s.id} data-testid={`row-session-${s.id}`}>
                        <TableCell className="font-medium">{s.reference}</TableCell>
                        <TableCell>{s.locationLabel || "—"}</TableCell>
                        <TableCell>{s.createdByUsername}</TableCell>
                        <TableCell>{new Date(s.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{s.submittedAt ? new Date(s.submittedAt).toLocaleString() : "—"}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                      </TableRow>
                    ))}
                    {(sessionsQuery.data || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No stock take sessions yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transfers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stock Transfers (movement log)</CardTitle>
            </CardHeader>
            <CardContent>
              {transfersQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Transfer #</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(transfersQuery.data || []).map((t) => (
                      <TableRow key={t.id} data-testid={`row-transfer-${t.id}`}>
                        <TableCell className="font-medium">{t.transferNumber}</TableCell>
                        <TableCell>{t.fromLocation}</TableCell>
                        <TableCell>{t.toLocation}</TableCell>
                        <TableCell>{t.createdByUsername}</TableCell>
                        <TableCell>{new Date(t.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{statusBadge(t.status)}</TableCell>
                      </TableRow>
                    ))}
                    {(transfersQuery.data || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No transfers logged yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agoranomia" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {needsReprint.length > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                )}
                Shelf Label Compliance — {needsReprint.length} item{needsReprint.length !== 1 ? "s" : ""} need reprint
              </CardTitle>
            </CardHeader>
            <CardContent>
              {auditQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Last Printed Price</TableHead>
                      <TableHead>Current Price</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {needsReprint.map((row) => (
                      <TableRow key={row.itemId} data-testid={`row-audit-${row.itemId}`}>
                        <TableCell className="font-medium">{row.itemName}</TableCell>
                        <TableCell>{row.sku}</TableCell>
                        <TableCell>{row.lastPrintedPrice !== null ? `€${row.lastPrintedPrice.toFixed(2)}` : "never printed"}</TableCell>
                        <TableCell>€{row.currentPrice.toFixed(2)}</TableCell>
                        <TableCell><Badge variant="destructive">Needs reprint</Badge></TableCell>
                      </TableRow>
                    ))}
                    {needsReprint.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          All shelf labels are up to date.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="grv" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Goods Received Vouchers (OCR Invoice Import)</CardTitle>
            </CardHeader>
            <CardContent>
              {grvQuery.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GRV #</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Matching</TableHead>
                      <TableHead>Discrepancies</TableHead>
                      <TableHead>Purchase Invoice</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(grvQuery.data || []).map((g) => (
                      <GrvRow key={g.id} grv={g} suppliers={suppliersQuery.data || []} catalogItems={catalogItemsQuery.data || []} />
                    ))}
                    {(grvQuery.data || []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                          No goods received vouchers yet. Staff can photograph a supplier invoice from the PDA app.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
