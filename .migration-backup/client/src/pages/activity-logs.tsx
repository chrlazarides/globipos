import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, Search, Loader2, LogIn, LogOut, Plus, Pencil, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface ActivityLog {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  description: string | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  login: { label: "Login", icon: <LogIn className="w-3 h-3" />, color: "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900" },
  logout: { label: "Logout", icon: <LogOut className="w-3 h-3" />, color: "text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700" },
  create: { label: "Created", icon: <Plus className="w-3 h-3" />, color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900" },
  update: { label: "Updated", icon: <Pencil className="w-3 h-3" />, color: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900" },
  delete: { label: "Deleted", icon: <Trash2 className="w-3 h-3" />, color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900" },
};

export default function ActivityLogsPage() {
  const [search, setSearch] = useState("");

  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/activity-logs"],
    refetchInterval: 30000,
  });

  const filtered = logs.filter(log => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      log.username?.toLowerCase().includes(q) ||
      log.action?.toLowerCase().includes(q) ||
      log.entity?.toLowerCase().includes(q) ||
      log.description?.toLowerCase().includes(q) ||
      log.ipAddress?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Activity Log"
        description="Full audit trail of all system activity"
      />

      <div className="flex items-center gap-3 mt-6 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by user, action, entity..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-logs"
          />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} events</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No activity records found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(log => {
                  const cfg = ACTION_CONFIG[log.action] || { label: log.action, icon: null, color: "text-muted-foreground bg-muted border-border" };
                  return (
                    <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{log.username || "—"}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
                          {cfg.icon}
                          {cfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm capitalize text-muted-foreground">
                        {log.entity?.replace(/_/g, " ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {log.description || "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {log.ipAddress || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
