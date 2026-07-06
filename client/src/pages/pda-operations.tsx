import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, ArrowLeftRight, Tags, AlertTriangle, CheckCircle2 } from "lucide-react";

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

function statusBadge(status: string) {
  const variant = status === "submitted" || status === "completed" ? "default" : "secondary";
  return <Badge variant={variant} className="capitalize" data-testid={`badge-status-${status}`}>{status}</Badge>;
}

export default function PdaOperations() {
  const sessionsQuery = useQuery<StockTakeSession[]>({ queryKey: ["/api/pda/stock-take/sessions"] });
  const transfersQuery = useQuery<Transfer[]>({ queryKey: ["/api/pda/transfers"] });
  const auditQuery = useQuery<AuditRow[]>({ queryKey: ["/api/pda/agoranomia/audit"] });

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
      </Tabs>
    </div>
  );
}
