import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bell, Send, Users, User, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";

export default function CustomerPushPage() {
  const { toast } = useToast();

  // Broadcast form
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastUrl, setBroadcastUrl] = useState("/");

  // Individual form
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [indivTitle, setIndivTitle] = useState("");
  const [indivBody, setIndivBody] = useState("");
  const [indivUrl, setIndivUrl] = useState("/");

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: stats } = useQuery<{ total: number; subscribed: number }>({ queryKey: ["/api/admin/push/stats"] });

  const broadcastMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/push/broadcast", {
        title: broadcastTitle,
        body: broadcastBody,
        url: broadcastUrl,
      }),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Broadcast sent", description: `Delivered to ${data.sent} subscriber${data.sent !== 1 ? "s" : ""}` });
      setBroadcastTitle(""); setBroadcastBody(""); setBroadcastUrl("/");
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  const indivMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/admin/push/customer/${selectedCustomerId}`, {
        title: indivTitle,
        body: indivBody,
        url: indivUrl,
      }),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Notification sent", description: data.message || "Push sent successfully" });
      setIndivTitle(""); setIndivBody(""); setIndivUrl("/");
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="w-6 h-6" /> Customer Push Notifications
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Send push notifications directly to customers who have subscribed via the Customer App.
        </p>
      </div>

      {/* Stats banner */}
      {stats && (
        <div className="grid grid-cols-2 gap-4">
          <div className="border rounded-xl p-4 flex items-center gap-3">
            <Users className="w-8 h-8 text-primary opacity-70" />
            <div>
              <p className="text-2xl font-bold">{stats.subscribed}</p>
              <p className="text-xs text-muted-foreground">Push subscribers</p>
            </div>
          </div>
          <div className="border rounded-xl p-4 flex items-center gap-3">
            <User className="w-8 h-8 text-muted-foreground opacity-70" />
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total customers</p>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast */}
      <div className="border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold">Broadcast to All Subscribers</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Sends a push notification to every customer who has enabled notifications in the Customer App.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</label>
            <input
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="e.g. New Special Offer Available!"
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="input-broadcast-title"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
            <textarea
              value={broadcastBody}
              onChange={(e) => setBroadcastBody(e.target.value)}
              placeholder="e.g. Check out our latest seasonal offers — up to 20% off selected wines."
              rows={3}
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              data-testid="input-broadcast-body"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link (optional)</label>
            <input
              value={broadcastUrl}
              onChange={(e) => setBroadcastUrl(e.target.value)}
              placeholder="/"
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="input-broadcast-url"
            />
          </div>
        </div>
        <button
          onClick={() => broadcastMutation.mutate()}
          disabled={broadcastMutation.isPending || !broadcastTitle.trim() || !broadcastBody.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          data-testid="button-send-broadcast"
        >
          {broadcastMutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            : <><Send className="w-4 h-4" /> Send Broadcast</>}
        </button>
        {broadcastMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" /> Broadcast sent successfully
          </div>
        )}
        {broadcastMutation.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" /> Failed to send broadcast
          </div>
        )}
      </div>

      {/* Individual */}
      <div className="border rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold">Send to Individual Customer</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Target a specific customer. Only works if they have push notifications enabled.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Customer</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="select-push-customer"
            >
              <option value="">— Select customer —</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</label>
            <input
              value={indivTitle}
              onChange={(e) => setIndivTitle(e.target.value)}
              placeholder="e.g. Your order has been dispatched"
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="input-indiv-title"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
            <textarea
              value={indivBody}
              onChange={(e) => setIndivBody(e.target.value)}
              placeholder="Your personal notification message…"
              rows={3}
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              data-testid="input-indiv-body"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link (optional)</label>
            <input
              value={indivUrl}
              onChange={(e) => setIndivUrl(e.target.value)}
              placeholder="/"
              className="mt-1 w-full px-3 py-2 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="input-indiv-url"
            />
          </div>
        </div>
        <button
          onClick={() => indivMutation.mutate()}
          disabled={indivMutation.isPending || !selectedCustomerId || !indivTitle.trim() || !indivBody.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          data-testid="button-send-individual"
        >
          {indivMutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            : <><Send className="w-4 h-4" /> Send Notification</>}
        </button>
        {indivMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" /> Notification sent
          </div>
        )}
        {indivMutation.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" /> Failed to send — customer may not be subscribed
          </div>
        )}
      </div>
    </div>
  );
}
