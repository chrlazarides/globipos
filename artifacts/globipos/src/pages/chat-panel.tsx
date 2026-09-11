import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MessageCircle, Send, Bot, User, Users, Phone, Clock, CheckCheck, AlertCircle, Wifi, WifiOff } from "lucide-react";

interface ChatConversation {
  id: string;
  customerId: string;
  customerName: string;
  channel: string;
  waPhoneNumber: string | null;
  status: string;
  handoffStaffId: string | null;
  lastMessageAt: string;
  createdAt: string;
  unreadCount: number;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "bot" | "staff";
  content: string;
  channel: string;
  intent: string | null;
  createdAt: string;
}

export default function ChatPanel() {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: conversations = [], isLoading: convLoading } = useQuery<ChatConversation[]>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 8000,
  });

  const { data: waStatus } = useQuery<{ configured: boolean; phoneNumberId: string | null; webhookUrl: string; verifyToken: string }>({
    queryKey: ["/api/admin/whatsapp/status"],
    staleTime: 30000,
  });

  const selectedConv = conversations.find((c) => c.id === selectedConvId) ?? null;

  const { data: messages = [], isLoading: msgLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat/conversations", selectedConvId, "messages"],
    queryFn: () =>
      fetch(`/api/chat/conversations/${selectedConvId}/messages`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!selectedConvId,
    refetchInterval: 5000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const takeOverMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/chat/conversations/${id}/handoff`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      toast({ title: "You are now handling this conversation" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const releaseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/chat/conversations/${id}/release`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      toast({ title: "Conversation returned to bot" });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, message }: { id: string; message: string }) => {
      const res = await apiRequest("POST", `/api/chat/conversations/${id}/messages`, { message });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations", selectedConvId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      setReplyText("");
    },
    onError: (e: Error) => toast({ title: "Reply failed", description: e.message, variant: "destructive" }),
  });

  function handleReply() {
    if (!selectedConvId || !replyText.trim()) return;
    replyMutation.mutate({ id: selectedConvId, message: replyText.trim() });
  }

  const handoffConvs = conversations.filter((c) => c.status === "handoff");
  const activeConvs = conversations.filter((c) => c.status === "active");
  const allConvsSorted = [...handoffConvs, ...activeConvs, ...conversations.filter((c) => c.status === "closed")];

  function statusBadge(status: string) {
    if (status === "handoff") return <Badge variant="destructive" className="text-xs">Needs Agent</Badge>;
    if (status === "active") return <Badge variant="secondary" className="text-xs">Active</Badge>;
    return <Badge variant="outline" className="text-xs">Closed</Badge>;
  }

  function channelIcon(channel: string) {
    return channel === "whatsapp"
      ? <Phone className="w-3 h-3 text-green-500" />
      : <MessageCircle className="w-3 h-3 text-blue-500" />;
  }

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <PageHeader
        title="Chat Panel"
        subtitle="View and respond to customer conversations — take over when the bot needs help"
        icon={<MessageCircle className="w-5 h-5" />}
      />

      {/* WhatsApp connection status */}
      {waStatus && (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${waStatus.configured ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"}`}>
          {waStatus.configured
            ? <Wifi className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            : <WifiOff className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${waStatus.configured ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}>
              {waStatus.configured ? `WhatsApp connected — Phone ID: ${waStatus.phoneNumberId}` : "WhatsApp not configured"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {waStatus.configured
                ? `Webhook: ${waStatus.webhookUrl}`
                : "Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID environment variables to enable WhatsApp"}
            </p>
          </div>
        </div>
      )}

      {handoffConvs.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            {handoffConvs.length} conversation{handoffConvs.length > 1 ? "s" : ""} waiting for an agent
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-220px)]">
        {/* Conversation list */}
        <div className="lg:col-span-1 border rounded-lg overflow-y-auto bg-card">
          {convLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : allConvsSorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
              <MessageCircle className="w-8 h-8 opacity-30" />
              <p className="text-sm">No conversations yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {allConvsSorted.map((conv) => (
                <button
                  key={conv.id}
                  className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${selectedConvId === conv.id ? "bg-muted" : ""}`}
                  onClick={() => setSelectedConvId(conv.id)}
                  data-testid={`button-conv-${conv.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-1">
                        {channelIcon(conv.channel)}
                        <span className="text-sm font-medium truncate">{conv.customerName}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {statusBadge(conv.status)}
                        <span className="text-xs text-muted-foreground">
                          {new Date(conv.lastMessageAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message thread */}
        <div className="lg:col-span-2 border rounded-lg flex flex-col bg-card">
          {!selectedConv ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
              <Users className="w-10 h-10 opacity-30" />
              <p className="text-sm">Select a conversation to view messages</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                  {channelIcon(selectedConv.channel)}
                  <div>
                    <p className="font-medium text-sm">{selectedConv.customerName}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      via {selectedConv.channel}
                      {selectedConv.waPhoneNumber && ` • ${selectedConv.waPhoneNumber}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {statusBadge(selectedConv.status)}
                  {selectedConv.status === "handoff" && (
                    <Button
                      size="sm"
                      onClick={() => takeOverMutation.mutate(selectedConv.id)}
                      disabled={takeOverMutation.isPending}
                      data-testid="button-take-over"
                    >
                      Take Over
                    </Button>
                  )}
                  {selectedConv.status === "active" && selectedConv.handoffStaffId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => releaseMutation.mutate(selectedConv.id)}
                      data-testid="button-release-conv"
                    >
                      Return to Bot
                    </Button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {msgLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      data-testid={`chat-msg-${msg.id}`}
                    >
                      {msg.role !== "user" && (
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          {msg.role === "staff" ? (
                            <Users className="w-3.5 h-3.5 text-primary" />
                          ) : (
                            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                      )}
                      <div className={`max-w-[75%] space-y-0.5 ${msg.role === "user" ? "items-end" : ""}`}>
                        <div
                          className={`rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : msg.role === "staff"
                              ? "bg-blue-500 text-white"
                              : "bg-muted"
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            {msg.role === "staff" ? "You" : msg.role === "bot" ? "Bot" : "Customer"}
                            {" · "}
                            {new Date(msg.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {msg.intent && (
                            <span className="text-xs bg-muted px-1 rounded">{msg.intent}</span>
                          )}
                        </div>
                      </div>
                      {msg.role === "user" && (
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className="p-3 border-t flex gap-2">
                {selectedConv.status === "handoff" || selectedConv.handoffStaffId ? (
                  <>
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleReply()}
                      placeholder="Reply to customer..."
                      data-testid="input-staff-reply"
                    />
                    <Button
                      size="icon"
                      onClick={handleReply}
                      disabled={replyMutation.isPending || !replyText.trim()}
                      data-testid="button-send-reply"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground py-2 px-3 bg-muted rounded-md flex-1">
                    Click <strong>Take Over</strong> above to reply to this conversation.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
