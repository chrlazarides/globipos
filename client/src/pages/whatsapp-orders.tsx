import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageSquare, ShoppingBag, Loader2, CheckCircle, XCircle, FileText, Bell, BellOff, BellRing, Clock, RefreshCcw, Volume2, VolumeX, Send, ExternalLink, PhoneOff, Moon } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { useWhatsAppAlert } from "@/hooks/use-whatsapp-alert";

type OrderItem = {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: string;
  total: string;
};

type PortalOrder = {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerPhone: string | null;
  source: string;
  status: string;
  subtotal: string;
  vatAmount: string;
  total: string;
  notes: string | null;
  invoiceId: string | null;
  createdAt: string;
  items: OrderItem[];
};

type ChatMessage = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  channel: string;
  intent: string | null;
  createdAt: string;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: "Pending", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
    confirmed: { label: "Confirmed", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    rejected: { label: "Rejected", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    completed: { label: "Completed", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  };
  const s = map[status] || { label: status, className: "bg-gray-100 text-gray-700" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
}

function sourceBadge(source: string) {
  if (source === "whatsapp") {
    return <Badge className="bg-[#25D366] text-white hover:bg-[#25D366]/90 text-xs">WhatsApp</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Portal</Badge>;
}

function MessageThread({ phone, latestSentAt }: { phone: string; latestSentAt?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/whatsapp/messages-by-phone", phone, latestSentAt],
    queryFn: () =>
      fetch(`/api/whatsapp/messages-by-phone/${encodeURIComponent(phone)}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: !!phone,
    refetchInterval: 12000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-8 w-2/3 ml-auto" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-3 italic">
        No messages yet for this customer.
      </p>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex flex-col gap-2 max-h-56 overflow-y-auto px-1 py-2"
      data-testid="whatsapp-message-thread"
    >
      {messages.map(msg => {
        const isStaff = msg.role === "staff";
        const isBot = msg.role === "bot";
        const bubbleAlign = isStaff ? "items-end" : "items-start";
        const bubbleBg = isStaff
          ? "bg-[#25D366] text-white"
          : isBot
          ? "bg-muted/80 text-foreground border border-border"
          : "bg-white dark:bg-muted text-foreground border border-border";
        const label = isStaff ? "Staff" : isBot ? "Bot" : "Customer";

        return (
          <div key={msg.id} className={`flex flex-col ${bubbleAlign} gap-0.5`} data-testid={`msg-bubble-${msg.id}`}>
            <div className={`rounded-2xl px-3 py-1.5 text-sm max-w-[80%] leading-snug ${bubbleBg}`}>
              {msg.content}
            </div>
            <span className="text-[10px] text-muted-foreground px-1">
              {label} · {format(new Date(msg.createdAt), "dd MMM HH:mm")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ChatConvEntry = {
  id: string;
  channel: string;
  status: string;
  waPhoneNumber: string | null;
  lastMessageAt: string;
  createdAt: string;
};

function PortalMessageThread({ customerId }: { customerId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: convLoading } = useQuery<ChatConvEntry[]>({
    queryKey: ["/api/customers", customerId, "chat-history"],
    queryFn: () =>
      fetch(`/api/customers/${customerId}/chat-history`, { credentials: "include" }).then(r => r.json()),
    enabled: !!customerId,
  });

  const portalConv = conversations.find(c => c.channel === "portal");

  const { data: messages = [], isLoading: msgLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/conversations", portalConv?.id, "messages"],
    queryFn: () =>
      fetch(`/api/chat/conversations/${portalConv!.id}/messages`, { credentials: "include" }).then(r => r.json()),
    enabled: !!portalConv?.id,
    refetchInterval: 12000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (convLoading || msgLoading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-8 w-2/3 ml-auto" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    );
  }

  if (!portalConv || messages.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-3 italic">
        No messages yet for this customer.
      </p>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex flex-col gap-2 max-h-56 overflow-y-auto px-1 py-2"
      data-testid="portal-message-thread"
    >
      {messages.map(msg => {
        const isStaff = msg.role === "staff";
        const isBot = msg.role === "bot";
        const bubbleAlign = isStaff ? "items-end" : "items-start";
        const bubbleBg = isStaff
          ? "bg-blue-600 text-white"
          : isBot
          ? "bg-muted/80 text-foreground border border-border"
          : "bg-white dark:bg-muted text-foreground border border-border";
        const label = isStaff ? "Staff" : isBot ? "Bot" : "Customer";

        return (
          <div key={msg.id} className={`flex flex-col ${bubbleAlign} gap-0.5`} data-testid={`msg-bubble-${msg.id}`}>
            <div className={`rounded-2xl px-3 py-1.5 text-sm max-w-[80%] leading-snug ${bubbleBg}`}>
              {msg.content}
            </div>
            <span className="text-[10px] text-muted-foreground px-1">
              {label} · {format(new Date(msg.createdAt), "dd MMM HH:mm")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OrderDetailDialog({ order, onClose }: { order: PortalOrder; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [replyText, setReplyText] = useState("");
  const [lastSentAt, setLastSentAt] = useState<string | undefined>(undefined);

  const sendReply = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/whatsapp/send", {
        to: order.customerPhone,
        message: replyText,
        orderId: order.id,
      }),
    onSuccess: () => {
      setReplyText("");
      setLastSentAt(new Date().toISOString());
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/messages-by-phone", order.customerPhone] });
      toast({ title: "Message sent", description: "WhatsApp reply delivered to customer." });
    },
    onError: (e: any) => toast({ title: "Failed to send", description: e.message, variant: "destructive" }),
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/admin/portal-orders/${order.id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/portal-orders"] });
      toast({ title: "Order updated" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const convertToInvoice = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/portal-orders/${order.id}/convert-to-invoice`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/portal-orders"] });
      const invoiceNum = data?.invoice?.invoiceNumber || "";
      toast({
        title: "Invoice created",
        description: `Draft invoice${invoiceNum ? ` #${invoiceNum}` : ""} created. Order confirmed.`,
      });
      if (data?.invoice?.id) {
        onClose();
        navigate(`/invoices/${data.invoice.id}`);
      } else {
        onClose();
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#25D366]" />
            Order {order.id.slice(0, 8).toUpperCase()}
            <span className="ml-2">{sourceBadge(order.source)}</span>
            <span className="ml-1">{statusBadge(order.status)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Customer</p>
              <p className="font-medium" data-testid="order-customer-name">{order.customerName}</p>
              {order.customerCode && <p className="text-xs text-muted-foreground">{order.customerCode}</p>}
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Date</p>
              <p className="font-medium">{format(new Date(order.createdAt), "dd MMM yyyy HH:mm")}</p>
            </div>
          </div>

          {order.invoiceId && (
            <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3">
              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">Invoice created from this order.</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-blue-600 dark:text-blue-400 h-auto p-0 font-medium flex items-center gap-1"
                onClick={() => { onClose(); navigate(`/invoices/${order.invoiceId}`); }}
                data-testid="link-view-invoice"
              >
                View Invoice <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {order.notes && (
            <div className="bg-muted/50 rounded-md p-3 text-sm italic text-muted-foreground">
              {order.notes}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit Price</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, i) => (
                  <tr key={item.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    <td className="px-3 py-2">{item.itemName}</td>
                    <td className="px-3 py-2 text-right">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">€{parseFloat(item.unitPrice).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-medium">€{parseFloat(item.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 text-xs">
                <tr>
                  <td colSpan={3} className="px-3 py-1 text-right text-muted-foreground">Subtotal</td>
                  <td className="px-3 py-1 text-right">€{parseFloat(order.subtotal).toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="px-3 py-1 text-right text-muted-foreground">VAT</td>
                  <td className="px-3 py-1 text-right">€{parseFloat(order.vatAmount).toFixed(2)}</td>
                </tr>
                <tr className="font-semibold text-sm">
                  <td colSpan={3} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right">€{parseFloat(order.total).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {order.source === "whatsapp" && order.customerPhone && (
          <div className="border rounded-lg bg-[#25D366]/5 border-[#25D366]/30 overflow-hidden">
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs font-semibold text-[#25D366] flex items-center gap-1.5 mb-2">
                <MessageSquare className="w-3.5 h-3.5" />
                Chat History
              </p>
              <MessageThread phone={order.customerPhone} latestSentAt={lastSentAt} />
            </div>
            <div className="border-t border-[#25D366]/20 px-3 py-3 space-y-2 bg-[#25D366]/5">
              <p className="text-xs font-medium text-[#25D366]">Reply via WhatsApp</p>
              <Textarea
                placeholder="Type a message to send to the customer…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={2}
                className="resize-none text-sm"
                data-testid="input-whatsapp-reply"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => sendReply.mutate()}
                  disabled={sendReply.isPending || !replyText.trim()}
                  data-testid="btn-send-whatsapp-reply"
                  className="flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1ebe5d] text-white"
                >
                  {sendReply.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send Message
                </Button>
              </div>
            </div>
          </div>
        )}

        {order.source === "portal" && (
          <div className="border rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 overflow-hidden">
            <div className="px-3 pt-3 pb-3">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 mb-2">
                <MessageSquare className="w-3.5 h-3.5" />
                Chat History
              </p>
              <PortalMessageThread customerId={order.customerId} />
            </div>
          </div>
        )}

        {order.source === "whatsapp" && !order.customerPhone && (
          <div
            className="border rounded-lg bg-muted/40 border-dashed border-muted-foreground/30 overflow-hidden"
            data-testid="whatsapp-no-phone-panel"
          >
            <div className="px-4 py-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <PhoneOff className="w-4 h-4 flex-shrink-0" />
                <p className="text-sm font-medium">WhatsApp reply unavailable</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                No phone number is saved on this customer record. Add a mobile number to the customer profile to enable WhatsApp replies.
              </p>
              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { onClose(); navigate("/customers"); }}
                  data-testid="btn-go-to-customer"
                  className="flex items-center gap-1.5 text-xs h-8"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Customer Record
                </Button>
              </div>
            </div>
            <div className="border-t border-dashed border-muted-foreground/20 px-4 py-3 bg-muted/20 space-y-2 opacity-50 pointer-events-none">
              <p className="text-xs font-medium text-muted-foreground">Reply via WhatsApp</p>
              <Textarea
                placeholder="No phone number — reply disabled"
                disabled
                rows={2}
                className="resize-none text-sm"
                data-testid="input-whatsapp-reply-disabled"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled
                  data-testid="btn-send-whatsapp-reply-disabled"
                  className="flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send Message
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          {order.status === "pending" && (
            <>
              <Button
                variant="destructive"
                onClick={() => updateStatus.mutate("rejected")}
                disabled={updateStatus.isPending}
                data-testid="btn-reject-order"
                className="flex items-center gap-1"
              >
                <XCircle className="w-4 h-4" /> Reject
              </Button>
              <Button
                variant="outline"
                onClick={() => updateStatus.mutate("confirmed")}
                disabled={updateStatus.isPending}
                data-testid="btn-confirm-order"
                className="flex items-center gap-1 border-green-600 text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
              >
                {updateStatus.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Confirm
              </Button>
              {!order.invoiceId && (
                <Button
                  onClick={() => convertToInvoice.mutate()}
                  disabled={convertToInvoice.isPending}
                  data-testid="btn-convert-invoice"
                  className="flex items-center gap-1"
                >
                  {convertToInvoice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Confirm & Create Invoice
                </Button>
              )}
            </>
          )}
          {order.status !== "pending" && (
            <Button variant="secondary" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PushToggle() {
  const { toast } = useToast();
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const endpointRef = useRef<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        if (sub) { setSubscribed(true); endpointRef.current = sub.endpoint; }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  async function toggle() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Push not supported", description: "Your browser does not support push notifications.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (subscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await apiRequest("DELETE", "/api/admin/push/unsubscribe", { endpoint: sub.endpoint });
        }
        setSubscribed(false);
        endpointRef.current = null;
        toast({ title: "Push notifications off" });
      } else {
        const vapidRes = await fetch("/api/public/vapid-key");
        const { publicKey } = await vapidRes.json();
        if (!publicKey) {
          toast({ title: "Push not configured", description: "VAPID keys are not set up on this server.", variant: "destructive" });
          return;
        }
        const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
        const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
        const rawKey = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: rawKey,
        });
        const raw = sub.toJSON() as any;
        await apiRequest("POST", "/api/admin/push/subscribe", {
          endpoint: sub.endpoint,
          keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
        });
        setSubscribed(true);
        endpointRef.current = sub.endpoint;
        toast({ title: "Push notifications on", description: "You'll be notified when new WhatsApp orders arrive." });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (!("PushManager" in window)) return null;

  return (
    <Button
      variant={subscribed ? "default" : "outline"}
      size="sm"
      onClick={toggle}
      disabled={loading}
      data-testid="btn-push-toggle"
      className="flex items-center gap-1.5"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : subscribed ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
      {subscribed ? "Notifications On" : "Enable Notifications"}
    </Button>
  );
}

function hourLabel(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

function QuietHoursSettings() {
  const {
    quietHoursEnabled,
    setQuietHoursEnabled,
    quietHoursStart,
    quietHoursEnd,
    setQuietHours,
    isQuietNow,
    quietHoursOverrideActive,
    overrideQuietHours,
    cancelQuietHoursOverride,
  } = useWhatsAppAlert();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={quietHoursEnabled && isQuietNow ? "secondary" : "outline"}
          size="sm"
          data-testid="btn-quiet-hours"
          title="Configure quiet hours"
          className="flex items-center gap-1.5"
        >
          <Moon className="w-4 h-4" />
          <span className="hidden sm:inline">
            {quietHoursEnabled
              ? (isQuietNow ? "Quiet Now" : (quietHoursOverrideActive ? "Override Active" : "Quiet Hours"))
              : "Quiet Hours"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours-toggle" className="text-sm font-medium">
              Mute chime during off-hours
            </Label>
            <Switch
              id="quiet-hours-toggle"
              checked={quietHoursEnabled}
              onCheckedChange={setQuietHoursEnabled}
              data-testid="switch-quiet-hours"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The chime will stay silent automatically during this time window, even if it isn't manually muted.
          </p>
          <p className="text-xs text-muted-foreground italic" data-testid="text-quiet-hours-device-scope">
            This only applies to this computer/browser — it won't change settings on other devices or for other staff.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Starts at</Label>
              <Select
                value={String(quietHoursStart)}
                onValueChange={(v) => setQuietHours(parseInt(v, 10), quietHoursEnd)}
              >
                <SelectTrigger data-testid="select-quiet-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Ends at</Label>
              <Select
                value={String(quietHoursEnd)}
                onValueChange={(v) => setQuietHours(quietHoursStart, parseInt(v, 10))}
              >
                <SelectTrigger data-testid="select-quiet-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => (
                    <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {quietHoursEnabled && (
            <p className="text-xs text-muted-foreground" data-testid="text-quiet-hours-status">
              {isQuietNow
                ? "Currently in quiet hours — chime is silenced."
                : quietHoursOverrideActive
                  ? "Override active until quiet hours end — chime is on."
                  : "Currently outside quiet hours — chime is active."}
            </p>
          )}
          {quietHoursEnabled && isQuietNow && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-full flex items-center gap-1.5"
              onClick={overrideQuietHours}
              data-testid="btn-override-quiet-hours"
            >
              <BellRing className="w-4 h-4" />
              Override until quiet hours end
            </Button>
          )}
          {quietHoursOverrideActive && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-2 py-1.5">
              <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-quiet-hours-override-active">
                Chime override is on for urgent orders tonight.
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={cancelQuietHoursOverride}
                data-testid="btn-cancel-quiet-hours-override"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function WhatsAppOrders() {
  const targetOrderId = useRef<string | null>(
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("orderId") : null
  ).current;
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<PortalOrder | null>(null);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(targetOrderId);
  const [, navigate] = useLocation();
  const { clearNewOrders, chimeMuted, toggleChimeMuted } = useWhatsAppAlert();
  const orderRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    clearNewOrders();
  }, [clearNewOrders]);

  const { data: orders = [], isLoading, refetch } = useQuery<PortalOrder[]>({
    queryKey: ["/api/admin/portal-orders", sourceFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/admin/portal-orders?${params}`);
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json();
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!targetOrderId || hasScrolledRef.current || isLoading) return;
    const found = orders.find(o => o.id === targetOrderId);
    if (!found) return;
    const el = orderRefs.current[targetOrderId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      hasScrolledRef.current = true;
    }
  }, [orders, isLoading, targetOrderId]);

  useEffect(() => {
    if (!highlightedOrderId) return;
    const timer = setTimeout(() => setHighlightedOrderId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightedOrderId]);

  const pendingCount = orders.filter(o => o.status === "pending").length;
  const whatsappCount = orders.filter(o => o.source === "whatsapp").length;
  const missingPhoneBlockedCount = orders.filter(
    o => o.source === "whatsapp" && o.status === "pending" && !o.customerPhone
  ).length;

  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        title="WhatsApp & Portal Orders"
        description="Review and action orders placed via WhatsApp or the Customer Portal"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant={chimeMuted ? "outline" : "secondary"}
              size="sm"
              onClick={toggleChimeMuted}
              data-testid="btn-toggle-chime"
              title={chimeMuted ? "Chime muted — click to unmute" : "Chime on — click to mute"}
              className="flex items-center gap-1.5"
            >
              {chimeMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{chimeMuted ? "Chime Off" : "Chime On"}</span>
            </Button>
            <QuietHoursSettings />
            <PushToggle />
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="btn-refresh-orders">
              <RefreshCcw className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      {missingPhoneBlockedCount > 0 && (
        <div
          className="flex items-center gap-2 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-sm text-red-700 dark:text-red-300"
          data-testid="banner-missing-phone-warning"
        >
          <PhoneOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong data-testid="text-missing-phone-count">{missingPhoneBlockedCount}</strong> pending WhatsApp order{missingPhoneBlockedCount !== 1 ? "s are" : " is"} blocked because the customer has no phone number on file.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-auto py-1 px-2 text-red-700 dark:text-red-300 font-medium underline underline-offset-2 hover:bg-red-100 dark:hover:bg-red-900/40"
            onClick={() => navigate("/customers")}
            data-testid="btn-fix-missing-phone"
          >
            Fix in Customers
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Orders</p>
            <p className="text-2xl font-bold" data-testid="stat-total-orders">{orders.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pending Action</p>
            <p className="text-2xl font-bold text-yellow-600" data-testid="stat-pending-orders">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Via WhatsApp</p>
            <p className="text-2xl font-bold text-[#25D366]" data-testid="stat-whatsapp-orders">{whatsappCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Via Portal</p>
            <p className="text-2xl font-bold text-blue-600" data-testid="stat-portal-orders">{orders.filter(o => o.source !== "whatsapp").length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-40" data-testid="filter-source">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="portal">Portal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="filter-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <ShoppingBag className="w-12 h-12 text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">No orders found</p>
          <p className="text-sm text-muted-foreground">Orders placed via WhatsApp or the customer portal will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <Card
              key={order.id}
              ref={el => { orderRefs.current[order.id] = el; }}
              className={`cursor-pointer hover:shadow-md transition-shadow border ${
                highlightedOrderId === order.id
                  ? "ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
                  : ""
              }`}
              onClick={() => setSelectedOrder(order)}
              data-testid={`order-card-${order.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 flex-shrink-0">
                      {order.source === "whatsapp"
                        ? <MessageSquare className="w-5 h-5 text-[#25D366]" />
                        : <ShoppingBag className="w-5 h-5 text-blue-500" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm" data-testid={`order-customer-${order.id}`}>{order.customerName}</span>
                        {sourceBadge(order.source)}
                        {statusBadge(order.status)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        #{order.id.slice(0, 8).toUpperCase()} &bull;{" "}
                        <Clock className="w-3 h-3 inline mb-0.5" /> {format(new Date(order.createdAt), "dd MMM yyyy HH:mm")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {order.items.length} item{order.items.length !== 1 ? "s" : ""} &mdash; {order.items.map(i => i.itemName).join(", ").slice(0, 80)}{order.items.map(i => i.itemName).join(", ").length > 80 ? "…" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-base" data-testid={`order-total-${order.id}`}>€{parseFloat(order.total).toFixed(2)}</p>
                    {order.invoiceId && (
                      <button
                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 font-medium flex items-center justify-end gap-0.5 mt-0.5 underline-offset-2 hover:underline"
                        onClick={e => { e.stopPropagation(); navigate(`/invoices/${order.invoiceId}`); }}
                        data-testid={`link-view-invoice-${order.id}`}
                      >
                        <FileText className="w-3 h-3" /> View Invoice →
                      </button>
                    )}
                    {order.status === "pending" && !order.invoiceId && (
                      <span className="text-xs text-yellow-600 font-medium">Needs action</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedOrder && (
        <OrderDetailDialog order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  );
}
