import { useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch, queryClient } from "../lib/queryClient";

export interface CustomerNotification { id: string; title?: string; body?: string; message?: string; createdAt?: string; read?: boolean; readAt?: string | null; }
export default function Notifications() {
  const { data: notifications = [], isLoading } = useQuery<CustomerNotification[]>({ queryKey: ["/api/customer/notifications"] });
  const unread = notifications.filter(n => !n.read && !n.readAt);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/customer/notifications"] });
  const read = async (id: string) => { await apiFetch(`/api/customer/notifications/${id}/read`, { method: "POST" }); refresh(); };
  const readAll = async () => { await apiFetch("/api/customer/notifications/read-all", { method: "POST" }); refresh(); };
  return <div className="space-y-4"><div className="flex justify-between items-center"><div><h1 className="text-xl font-semibold">Notifications</h1><p className="text-xs text-[hsl(var(--muted-foreground))]">{unread.length ? `${unread.length} unread` : "You're all caught up"}</p></div>{unread.length > 0 && <button onClick={readAll} className="text-xs font-medium text-[hsl(var(--primary))] flex gap-1 items-center"><CheckCheck className="w-4 h-4" />Mark all read</button>}</div>
    {isLoading ? <div className="h-20 rounded-xl bg-[hsl(var(--muted))] animate-pulse" /> : !notifications.length ? <div className="py-16 flex flex-col items-center text-[hsl(var(--muted-foreground))]"><Bell className="w-10 h-10 opacity-30 mb-3" /><p className="text-sm">No notifications yet</p></div> : <div className="space-y-2">{notifications.map(n => { const isUnread = !n.read && !n.readAt; return <article key={n.id} className={`rounded-xl border p-3 ${isUnread ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))] bg-[hsl(var(--card))]"}`}><div className="flex gap-3"><Bell className="w-4 h-4 mt-0.5 flex-none text-[hsl(var(--primary))]" /><div className="flex-1"><p className="text-sm font-semibold">{n.title || "Update"}</p><p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{n.body || n.message}</p>{n.createdAt && <p className="text-[10px] mt-1 text-[hsl(var(--muted-foreground))]">{new Date(n.createdAt).toLocaleString()}</p>}</div>{isUnread && <button onClick={() => read(n.id)} className="text-[10px] text-[hsl(var(--primary))] font-medium">Read</button>}</div></article>; })}</div>}
  </div>;
}