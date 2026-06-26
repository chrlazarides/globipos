import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GitCommitHorizontal,
  Rocket,
  Plus,
  Download,
  RotateCcw,
  Trash2,
  Clock,
  User,
  Database,
  ChevronDown,
  ChevronRight,
  GitBranch,
  ShieldAlert,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type Snapshot = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  createdBy: string;
  createdAt: string;
  appVersion: string | null;
  tableCounts: string | null;
};

const TYPE_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  manual: { label: "Manual", variant: "secondary", color: "text-slate-600" },
  publish: { label: "Published", variant: "default", color: "text-emerald-600" },
  auto: { label: "Auto", variant: "outline", color: "text-blue-600" },
};

function TableCountsBadge({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((s, v) => s + (v || 0), 0);
  const [open, setOpen] = useState(false);
  const top = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-table-counts-toggle"
      >
        <Database className="w-3 h-3" />
        {total.toLocaleString()} records
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="absolute z-10 left-0 top-5 bg-popover border rounded-lg shadow-lg p-3 min-w-[200px]">
          <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Table Counts</p>
          {Object.entries(counts)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs py-0.5">
                <span className="capitalize text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                <span className="font-mono font-medium">{v}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function SnapshotCard({
  snap,
  onRollback,
  onDelete,
  onDownload,
  isFirst,
}: {
  snap: Snapshot;
  onRollback: (s: Snapshot) => void;
  onDelete: (s: Snapshot) => void;
  onDownload: (s: Snapshot) => void;
  isFirst: boolean;
}) {
  const meta = TYPE_META[snap.type] || TYPE_META.manual;
  const counts: Record<string, number> = snap.tableCounts ? JSON.parse(snap.tableCounts) : {};
  const createdAt = new Date(snap.createdAt);

  return (
    <div className="flex gap-4" data-testid={`card-snapshot-${snap.id}`}>
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
          snap.type === "publish"
            ? "bg-emerald-50 border-emerald-500 dark:bg-emerald-950"
            : isFirst
            ? "bg-primary/10 border-primary"
            : "bg-muted border-border"
        }`}>
          {snap.type === "publish"
            ? <Rocket className="w-4 h-4 text-emerald-600" />
            : <GitCommitHorizontal className={`w-4 h-4 ${isFirst ? "text-primary" : "text-muted-foreground"}`} />
          }
        </div>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>

      {/* Card content */}
      <div className="flex-1 pb-6">
        <Card className={`${isFirst ? "border-primary/40 shadow-sm" : ""}`}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-semibold text-sm truncate" data-testid={`text-snapshot-name-${snap.id}`}>
                    {snap.name}
                  </h3>
                  <Badge variant={meta.variant} className="text-xs">
                    {meta.label}
                  </Badge>
                  {isFirst && (
                    <Badge variant="outline" className="text-xs text-primary border-primary/40">
                      Latest
                    </Badge>
                  )}
                  {snap.appVersion && (
                    <span className="text-xs text-muted-foreground font-mono">v{snap.appVersion}</span>
                  )}
                </div>

                {snap.description && (
                  <p className="text-sm text-muted-foreground mb-2">{snap.description}</p>
                )}

                <div className="flex items-center gap-4 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span title={format(createdAt, "PPpp")}>
                      {formatDistanceToNow(createdAt, { addSuffix: true })}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="w-3 h-3" />
                    {snap.createdBy}
                  </span>
                  <TableCountsBadge counts={counts} />
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDownload(snap)}
                  title="Download backup"
                  data-testid={`button-download-${snap.id}`}
                >
                  <Download className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRollback(snap)}
                  title="Roll back to this version"
                  data-testid={`button-rollback-${snap.id}`}
                >
                  <RotateCcw className="w-4 h-4 text-amber-600" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(snap)}
                  title="Delete snapshot"
                  data-testid={`button-delete-${snap.id}`}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function VersionControlPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<Snapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Snapshot | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });

  const { data: snapshots = [], isLoading } = useQuery<Snapshot[]>({
    queryKey: ["/api/version-control"],
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string; type: string }) =>
      apiRequest("POST", "/api/version-control", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/version-control"] });
      setCreateOpen(false);
      setPublishOpen(false);
      setForm({ name: "", description: "" });
      toast({ title: "Snapshot created", description: "Version snapshot saved successfully." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rollbackMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/version-control/${id}/rollback`, {}),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/version-control"] });
      const snap = snapshots.find(s => s.id === id);
      setRollbackTarget(null);
      toast({
        title: "Rollback complete",
        description: `Database restored to "${snap?.name}". Please refresh the page.`,
      });
    },
    onError: (e: any) => toast({ title: "Rollback failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/version-control/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/version-control"] });
      setDeleteTarget(null);
      toast({ title: "Snapshot deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleDownload = async (snap: Snapshot) => {
    const res = await fetch(`/api/version-control/${snap.id}/download`, { credentials: "include" });
    if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || `snapshot_${snap.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalRecords = snapshots.length > 0 && snapshots[0].tableCounts
    ? Object.values(JSON.parse(snapshots[0].tableCounts)).reduce((s: number, v: any) => s + (v || 0), 0)
    : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GitBranch className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Version Control</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Named snapshots of your entire database. Roll back data to any checkpoint with one click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => { setForm({ name: "", description: "" }); setCreateOpen(true); }}
            data-testid="button-create-snapshot"
          >
            <Plus className="w-4 h-4 mr-2" />
            Save Snapshot
          </Button>
          <Button
            onClick={() => { setForm({ name: "", description: "" }); setPublishOpen(true); }}
            data-testid="button-publish-version"
          >
            <Rocket className="w-4 h-4 mr-2" />
            Publish Release
          </Button>
        </div>
      </div>

      {/* Stats */}
      {snapshots.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold">{snapshots.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Snapshots</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold">{snapshots.filter(s => s.type === "publish").length}</p>
              <p className="text-xs text-muted-foreground mt-1">Published Releases</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <p className="text-2xl font-bold">{totalRecords.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Records in Latest</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Timeline */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading snapshots…</p>
          </div>
        </div>
      ) : snapshots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GitCommitHorizontal className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="font-semibold text-lg mb-1">No snapshots yet</h3>
          <p className="text-sm text-muted-foreground max-w-xs mb-6">
            Save your first snapshot to start tracking versions of your data. You can roll back to any snapshot at any time.
          </p>
          <Button onClick={() => { setForm({ name: "", description: "" }); setCreateOpen(true); }} data-testid="button-create-first-snapshot">
            <Plus className="w-4 h-4 mr-2" />
            Save First Snapshot
          </Button>
        </div>
      ) : (
        <div>
          {snapshots.map((snap, i) => (
            <SnapshotCard
              key={snap.id}
              snap={snap}
              isFirst={i === 0}
              onRollback={setRollbackTarget}
              onDelete={setDeleteTarget}
              onDownload={handleDownload}
            />
          ))}
          {/* End of timeline */}
          <div className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className="w-9 h-9 rounded-full flex items-center justify-center bg-muted border-2 border-border flex-shrink-0">
                <Database className="w-4 h-4 text-muted-foreground/50" />
              </div>
            </div>
            <div className="flex-1 pb-4 flex items-center">
              <p className="text-xs text-muted-foreground">Beginning of history</p>
            </div>
          </div>
        </div>
      )}

      {/* Create Snapshot Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Snapshot</DialogTitle>
            <DialogDescription>
              Captures the complete database state right now. You can roll back to this point at any time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Name *</label>
              <Input
                placeholder="e.g. Before June billing run"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-snapshot-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <Textarea
                placeholder="What changed or why you're saving this snapshot…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                data-testid="input-snapshot-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-snapshot">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: form.name, description: form.description, type: "manual" })}
              disabled={!form.name.trim() || createMutation.isPending}
              data-testid="button-confirm-snapshot"
            >
              {createMutation.isPending ? "Saving…" : "Save Snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Release Dialog */}
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-emerald-600" />
              Publish Release
            </DialogTitle>
            <DialogDescription>
              Mark this as an official published release. Same as a snapshot but tagged as "Published" for easy identification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Release Name *</label>
              <Input
                placeholder="e.g. v2.1 — Q2 2026 Launch"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-publish-name"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Release Notes (optional)</label>
              <Textarea
                placeholder="What's new in this release…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                data-testid="input-publish-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)} data-testid="button-cancel-publish">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: form.name, description: form.description, type: "publish" })}
              disabled={!form.name.trim() || createMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-confirm-publish"
            >
              {createMutation.isPending ? "Publishing…" : "Publish Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation */}
      <AlertDialog open={!!rollbackTarget} onOpenChange={open => !open && setRollbackTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              Roll Back to This Version?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will <strong>replace the entire database</strong> with the state captured in:
                </p>
                <div className="bg-muted rounded px-3 py-2 text-sm font-medium">
                  {rollbackTarget?.name}
                  {rollbackTarget?.createdAt && (
                    <span className="font-normal text-muted-foreground ml-2">
                      — {format(new Date(rollbackTarget.createdAt), "PPp")}
                    </span>
                  )}
                </div>
                <p className="text-amber-700 dark:text-amber-400 text-sm">
                  All data created <em>after</em> this snapshot will be permanently lost. This cannot be undone.
                </p>
                <p className="text-sm text-muted-foreground">
                  Tip: Save a snapshot of the current state first if you want to be able to return to it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rollback">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rollbackTarget && rollbackMutation.mutate(rollbackTarget.id)}
              disabled={rollbackMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-confirm-rollback"
            >
              {rollbackMutation.isPending ? "Rolling back…" : "Yes, Roll Back"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the snapshot <strong>"{deleteTarget?.name}"</strong> and its stored data. You will no longer be able to roll back to this point.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Snapshot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
