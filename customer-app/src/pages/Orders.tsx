import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, queryClient } from "../lib/queryClient";
import { type CustomerSession } from "../lib/auth";
import { Receipt, RefreshCw, Star } from "lucide-react";

interface OrdersProps { customer: CustomerSession; }

function fmt(v: string | number) {
  return `€${parseFloat(String(v || 0)).toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
    confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    shipped: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  };
  return map[status] || "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Orders({ customer }: OrdersProps) {
  const { data: orders = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/customer/orders"] });
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<string[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("globi_feedback_submitted") || "[]"); } catch { return []; }
  });

  async function handleReorder(id: string) {
    setReorderingId(id);
    try {
      await apiFetch(`/api/customer/orders/${id}/reorder`, { method: "POST", body: JSON.stringify({}) });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer/loyalty"] });
      alert("Reorder placed successfully!");
    } catch (err: any) {
      alert(err.message || "Failed to reorder");
    } finally { setReorderingId(null); }
  }
  async function submitFeedback(orderId: string) {
    if (!rating) return;
    setSubmittingFeedback(true);
    try {
      await apiFetch("/api/customer/feedback", { method: "POST", body: JSON.stringify({ rating, comment: comment.trim() || undefined, context: "order", orderId }) });
      const submitted = [...feedbackSubmitted, orderId];
      setFeedbackSubmitted(submitted);
      sessionStorage.setItem("globi_feedback_submitted", JSON.stringify(submitted));
      setFeedbackOrderId(null); setRating(0); setComment("");
    } catch (err: any) { alert(err.message || "Could not send feedback"); } finally { setSubmittingFeedback(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">My Orders</h1>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Track orders and reorder with one tap</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-[hsl(var(--muted))] animate-pulse" />
          ))}
        </div>
      ) : !orders.length ? (
        <div className="flex flex-col items-center py-16 text-[hsl(var(--muted-foreground))]">
          <Receipt className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No orders yet</p>
          <p className="text-xs mt-1">Browse the shop to place your first order</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => (
            <div key={order.id} className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl p-4" data-testid={`card-order-${order.id}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">#{order.id.slice(0, 8)}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(order.status)}`}>
                    {order.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">{formatDate(order.createdAt)}</span>
                  <button
                    onClick={() => handleReorder(order.id)}
                    disabled={reorderingId === order.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
                    data-testid={`button-reorder-${order.id}`}
                  >
                    <RefreshCw className={`w-3 h-3 ${reorderingId === order.id ? "animate-spin" : ""}`} />
                    Reorder
                  </button>
                </div>
              </div>
              {order.items?.length > 0 && (
                <div className="space-y-0.5 mb-2">
                  {order.items.slice(0, 3).map((item: any, i: number) => (
                    <p key={i} className="text-xs text-[hsl(var(--muted-foreground))]">
                      {item.quantity}× {item.itemName}
                    </p>
                  ))}
                  {order.items.length > 3 && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">+{order.items.length - 3} more</p>
                  )}
                </div>
              )}
              <div className="flex justify-between items-center text-sm border-t border-[hsl(var(--border))] pt-2 mt-2">
                <span className="text-[hsl(var(--muted-foreground))]">Total</span>
                <span className="font-bold" data-testid={`text-order-total-${order.id}`}>{fmt(order.total)}</span>
              </div>
              {order.notes && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 italic">{order.notes}</p>}
               {order.status !== "cancelled" && !feedbackSubmitted.includes(order.id) && (
                 feedbackOrderId === order.id ? (
                   <form onSubmit={(e) => { e.preventDefault(); submitFeedback(order.id); }} className="mt-3 pt-3 border-t border-[hsl(var(--border))] space-y-2">
                     <p className="text-xs font-medium">How was this order?</p>
                     <div className="flex gap-1" aria-label="Order rating">{[1,2,3,4,5].map(value => <button type="button" key={value} onClick={() => setRating(value)} aria-label={`${value} star${value > 1 ? "s" : ""}`} className={value <= rating ? "text-amber-400" : "text-[hsl(var(--border))]"}><Star className="w-5 h-5" fill="currentColor" /></button>)}</div>
                     <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Tell us more (optional)" className="w-full px-2 py-1.5 text-xs rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]" />
                     <div className="flex gap-2"><button type="submit" disabled={!rating || submittingFeedback} className="px-3 py-1.5 rounded-lg text-xs text-white disabled:opacity-50" style={{ background: "hsl(var(--primary))" }}>{submittingFeedback ? "Sending…" : "Send feedback"}</button><button type="button" onClick={() => setFeedbackOrderId(null)} className="text-xs text-[hsl(var(--muted-foreground))]">Not now</button></div>
                   </form>
                 ) : <button onClick={() => { setFeedbackOrderId(order.id); setRating(0); setComment(""); }} className="mt-3 text-xs flex items-center gap-1 text-[hsl(var(--primary))]"><Star className="w-3.5 h-3.5" />Rate this order</button>
               )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
