import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, RefreshCw, MessageSquarePlus, XCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { getPortalQueryFn, portalApiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";
import PortalFeedbackDialog from "./portal-feedback-dialog";

interface PortalOrdersProps {
  customer: Customer;
}

export default function PortalOrders({ customer }: PortalOrdersProps) {
  const { data: orders, isLoading } = useQuery<any[]>({
    queryKey: ["/api/portal/customer", customer.id, "orders"],
    queryFn: getPortalQueryFn(`/api/portal/customer/${customer.id}/orders`),
  });
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [feedbackOrderId, setFeedbackOrderId] = useState<string | null>(null);
  const { toast } = useToast();

  const fmt = (v: string | number) =>
    `€${parseFloat(String(v || 0)).toLocaleString("el-CY", { minimumFractionDigits: 2 })}`;

  const statusVariant = (status: string) => {
    switch (status) {
      case "pending":   return "secondary";
      case "confirmed": return "default";
      case "shipped":   return "outline";
      case "completed": return "default";
      case "cancelled": return "destructive";
      default:          return "secondary";
    }
  };

  const handleReorder = async (orderId: string) => {
    setReorderingId(orderId);
    try {
      await portalApiRequest("POST", `/api/portal/orders/${orderId}/reorder`, { customerId: customer.id });
      toast({ title: "Reorder placed", description: "A new order has been submitted based on your previous one." });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "loyalty"] });
    } catch (err: any) {
      toast({ title: "Reorder failed", description: err.message, variant: "destructive" });
    } finally {
      setReorderingId(null);
    }
  };

  const handleCancel = async (orderId: string) => {
    if (!confirm("Are you sure you want to cancel this order?")) return;
    setCancellingId(orderId);
    try {
      await portalApiRequest("POST", `/api/portal/customer/${customer.id}/orders/${orderId}/cancel`);
      toast({ title: "Order cancelled", description: "Your pending order has been cancelled." });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/customer", customer.id, "orders"] });
    } catch (err: any) {
      toast({ title: "Cancellation failed", description: err.message, variant: "destructive" });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground" data-testid="text-portal-orders-title">My Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Track, manage, and reorder previous purchases</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setFeedbackOrderId("general")}
          className="gap-2"
          data-testid="button-general-feedback"
        >
          <MessageSquarePlus className="w-4 h-4" />
          Give Feedback
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed rounded-xl bg-muted/10">
          <Receipt className="w-12 h-12 mb-4 opacity-20" />
          <p className="text-base font-medium text-foreground">No orders yet</p>
          <p className="text-sm mt-1">Visit the Shop to place your first order</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order: any) => (
            <Card key={order.id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow" data-testid={`card-order-${order.id}`}>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-muted/30 pb-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-base">Order #{order.id.slice(0, 8)}</span>
                  <Badge variant={statusVariant(order.status)} className="uppercase text-[10px] font-bold tracking-wider px-2 py-0.5" data-testid={`badge-order-status-${order.id}`}>
                    {order.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-medium hidden sm:inline-block border-l pl-3 border-border">
                    {formatDate(order.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {order.status === "pending" && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleCancel(order.id)}
                      disabled={cancellingId === order.id}
                      data-testid={`button-cancel-${order.id}`}
                      className="h-8 text-xs flex-1 sm:flex-none"
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1.5" />
                      {cancellingId === order.id ? "..." : "Cancel"}
                    </Button>
                  )}
                  {order.status === "completed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFeedbackOrderId(order.id)}
                      data-testid={`button-feedback-${order.id}`}
                      className="h-8 text-xs flex-1 sm:flex-none bg-background"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5 mr-1.5" />
                      Rate
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleReorder(order.id)}
                    disabled={reorderingId === order.id}
                    data-testid={`button-reorder-${order.id}`}
                    className="h-8 text-xs flex-1 sm:flex-none"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${reorderingId === order.id ? "animate-spin" : ""}`} />
                    {reorderingId === order.id ? "..." : "Reorder"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Items</h4>
                    {order.items && order.items.length > 0 ? (
                      <div className="space-y-2">
                        {order.items.map((item: any, i: number) => (
                          <div key={i} className="flex justify-between gap-3 text-sm group">
                            <span className="font-medium text-foreground">
                              <span className="text-muted-foreground w-6 inline-block">{item.quantity}x</span>
                              {item.itemName}
                            </span>
                            <span className="text-muted-foreground group-hover:text-foreground transition-colors">{fmt(item.total)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No items listed</p>
                    )}
                  </div>

                  <div className="bg-muted/30 p-4 rounded-lg flex flex-col justify-center">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span>{fmt(order.subtotal)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">VAT (19%)</span>
                        <span>{fmt(order.vatAmount)}</span>
                      </div>
                      {order.cashbackApplied > 0 && (
                        <div className="flex justify-between gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                          <span>Cash Back</span>
                          <span>-{fmt(order.cashbackApplied)}</span>
                        </div>
                      )}
                      <div className="pt-2 mt-2 border-t flex justify-between gap-2 font-bold text-lg">
                        <span>Total</span>
                        <span data-testid={`text-order-total-${order.id}`}>{fmt(order.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {order.notes && (
                  <div className="mt-4 pt-4 border-t border-dashed">
                    <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">Notes:</span> {order.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {feedbackOrderId && (
        <PortalFeedbackDialog
          customer={customer}
          orderId={feedbackOrderId === "general" ? undefined : feedbackOrderId}
          isOpen={!!feedbackOrderId}
          onClose={() => setFeedbackOrderId(null)}
        />
      )}
    </div>
  );
}
