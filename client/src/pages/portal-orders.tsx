import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { portalApiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer } from "@shared/schema";

interface PortalOrdersProps {
  customer: Customer;
}

export default function PortalOrders({ customer }: PortalOrdersProps) {
  const { data: orders, isLoading } = useQuery<any[]>({
    queryKey: ["/api/portal/customer", customer.id, "orders"],
  });
  const [reorderingId, setReorderingId] = useState<string | null>(null);
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
    } catch (err: any) {
      toast({ title: "Reorder failed", description: err.message, variant: "destructive" });
    } finally {
      setReorderingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-portal-orders-title">My Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">Track your orders and reorder previous ones</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Receipt className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">No orders yet</p>
          <p className="text-xs mt-1">Visit the Shop to place your first order</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => (
            <Card key={order.id} data-testid={`card-order-${order.id}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">Order #{order.id.slice(0, 8)}</span>
                  <Badge variant={statusVariant(order.status)} data-testid={`badge-order-status-${order.id}`}>
                    {order.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReorder(order.id)}
                    disabled={reorderingId === order.id}
                    data-testid={`button-reorder-${order.id}`}
                    className="h-7 text-xs"
                  >
                    <RefreshCw className={`w-3 h-3 mr-1 ${reorderingId === order.id ? "animate-spin" : ""}`} />
                    {reorderingId === order.id ? "Placing…" : "Reorder"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {order.items && order.items.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {order.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{item.quantity}x {item.itemName}</span>
                        <span>{fmt(item.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="border-t pt-2 space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{fmt(order.subtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">VAT (19%)</span>
                    <span>{fmt(order.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between gap-2 font-semibold">
                    <span>Total</span>
                    <span data-testid={`text-order-total-${order.id}`}>{fmt(order.total)}</span>
                  </div>
                </div>
                {order.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">Notes: {order.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
