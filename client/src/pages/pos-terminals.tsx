/**
 * POS Terminal Hub — live dashboard for all terminals with peripheral health,
 * online/offline status, and full peripheral configuration from the back office.
 *
 * Layout:
 *  Top: summary bar (total / online / offline / pending sync)
 *  Body: terminal cards grouped by location — each card shows:
 *    - Online dot + time since last seen
 *    - 7 peripheral health pills (printer, drawer, scale, card, display, scanner, SCO)
 *    - Cashier name + shift open/closed
 *    - Outbox queue badge
 *    - "Configure" drawer → full peripheral settings panel
 *  Auto-refreshes every 30 s.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPosTerminalSchema } from "@shared/schema";
import type { PosTerminal, PosLocation, PosLayoutSet } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { PosHeartbeatIndicator } from "@/components/pos-heartbeat-indicator";
import {
  Monitor, Plus, Pencil, Trash2, Loader2, Clock, LayoutGrid, MapPin, Cpu,
  Printer, CreditCard, Wifi, WifiOff, Settings2, RefreshCw, AlertTriangle,
  CheckCircle2, CircleDot, Package, User, ShoppingCart, Layers,
  MonitorSmartphone, Scale, ScanLine, ChevronDown, ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PeripheralConfig {
  printer_enabled: boolean;
  printer_port: string;
  printer_columns: number;
  drawer_enabled: boolean;
  drawer_port: string;
  scale_enabled: boolean;
  scale_port: string;
  customer_display_enabled: boolean;
  card_terminal_provider: string;   // none | jcc | viva | worldpay
  barcode_scanner_enabled: boolean;
  sco_mode: boolean;
  price_level: number;
}

interface PeripheralStatus {
  printer?: "online" | "offline" | "error" | "unknown";
  drawer?: "ok" | "error" | "unknown";
  scale?: "connected" | "disconnected" | "error" | "unknown";
  card_terminal?: "connected" | "disconnected" | "error" | "unknown";
  customer_display?: "ok" | "error" | "unknown";
  cashier_name?: string;
  shift_open?: boolean;
  app_version?: string;
  reported_at?: string;
}

type EnrichedTerminal = PosTerminal & {
  locationName?: string;
  peripheralConfig: PeripheralConfig | null;
  peripheralStatus: PeripheralStatus | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PeripheralConfig = {
  printer_enabled: false,
  printer_port: "",
  printer_columns: 42,
  drawer_enabled: false,
  drawer_port: "",
  scale_enabled: false,
  scale_port: "",
  customer_display_enabled: false,
  card_terminal_provider: "none",
  barcode_scanner_enabled: true,
  sco_mode: false,
  price_level: 1,
};

function terminalOnlineStatus(t: PosTerminal) {
  if (!t.lastSeenAt) return { online: false, label: "Never seen", diff: Infinity };
  const diff = Date.now() - new Date(t.lastSeenAt).getTime();
  const online = diff < 5 * 60 * 1000; // 5 min
  const label = formatDistanceToNow(new Date(t.lastSeenAt), { addSuffix: true });
  return { online, label, diff };
}

// ── Peripheral status pill ────────────────────────────────────────────────────

type StatusLevel = "ok" | "warn" | "error" | "off" | "unknown";

function statusColor(level: StatusLevel) {
  switch (level) {
    case "ok":      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "warn":    return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "error":   return "bg-red-500/20 text-red-400 border-red-500/30";
    case "off":     return "bg-gray-500/10 text-gray-500 border-gray-700";
    case "unknown": return "bg-gray-500/10 text-gray-500 border-gray-700";
    default:        return "bg-gray-500/10 text-gray-500 border-gray-700";
  }
}

function PeripheralPill({
  icon: Icon,
  label,
  level,
  tooltip,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  level: StatusLevel;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${statusColor(level)}`}>
          <Icon className="w-2.5 h-2.5" />
          <span>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function buildPeripheralPills(cfg: PeripheralConfig | null, status: PeripheralStatus | null) {
  const c = cfg ?? DEFAULT_CONFIG;
  const s = status ?? {};

  function printerLevel(): StatusLevel {
    if (!c.printer_enabled) return "off";
    if (!s.printer || s.printer === "unknown") return "unknown";
    if (s.printer === "online") return "ok";
    if (s.printer === "error") return "error";
    return "warn";
  }
  function drawerLevel(): StatusLevel {
    if (!c.drawer_enabled) return "off";
    if (!s.drawer || s.drawer === "unknown") return "unknown";
    return s.drawer === "ok" ? "ok" : "error";
  }
  function scaleLevel(): StatusLevel {
    if (!c.scale_enabled) return "off";
    if (!s.scale || s.scale === "unknown") return "unknown";
    if (s.scale === "connected") return "ok";
    if (s.scale === "error") return "error";
    return "warn";
  }
  function cardLevel(): StatusLevel {
    if (!c.card_terminal_provider || c.card_terminal_provider === "none") return "off";
    if (!s.card_terminal || s.card_terminal === "unknown") return "unknown";
    if (s.card_terminal === "connected") return "ok";
    if (s.card_terminal === "error") return "error";
    return "warn";
  }
  function displayLevel(): StatusLevel {
    if (!c.customer_display_enabled) return "off";
    if (!s.customer_display || s.customer_display === "unknown") return "unknown";
    return s.customer_display === "ok" ? "ok" : "error";
  }

  return [
    { icon: Printer, label: "Printer", level: printerLevel(), tooltip: c.printer_enabled ? `Port: ${c.printer_port || "default"} · ${s.printer ?? "no report"}` : "Printer disabled" },
    { icon: Package, label: "Drawer", level: drawerLevel(), tooltip: c.drawer_enabled ? `Cash drawer · ${s.drawer ?? "no report"}` : "Drawer disabled" },
    { icon: Scale, label: "Scale", level: scaleLevel(), tooltip: c.scale_enabled ? `Port: ${c.scale_port || "default"} · ${s.scale ?? "no report"}` : "Scale disabled" },
    { icon: CreditCard, label: c.card_terminal_provider !== "none" && c.card_terminal_provider ? c.card_terminal_provider.toUpperCase() : "Card", level: cardLevel(), tooltip: c.card_terminal_provider !== "none" ? `${c.card_terminal_provider} · ${s.card_terminal ?? "no report"}` : "No card terminal" },
    { icon: MonitorSmartphone, label: "Display", level: displayLevel(), tooltip: c.customer_display_enabled ? `Customer display · ${s.customer_display ?? "no report"}` : "Customer display disabled" },
    { icon: ScanLine, label: "Scanner", level: c.barcode_scanner_enabled ? "ok" as StatusLevel : "off" as StatusLevel, tooltip: c.barcode_scanner_enabled ? "Barcode scanner enabled" : "Barcode scanner disabled" },
    { icon: Layers, label: "SCO", level: c.sco_mode ? "ok" as StatusLevel : "off" as StatusLevel, tooltip: c.sco_mode ? "Self-checkout mode enabled" : "SCO mode off" },
  ];
}

// ── Peripheral Config Sheet ────────────────────────────────────────────────────

function PeripheralConfigSheet({
  terminal,
  open,
  onClose,
}: {
  terminal: EnrichedTerminal;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const cfg: PeripheralConfig = (terminal.peripheralConfig as PeripheralConfig) ?? DEFAULT_CONFIG;
  const status: PeripheralStatus = (terminal.peripheralStatus as PeripheralStatus) ?? {};

  const [form, setForm] = useState<PeripheralConfig>({ ...DEFAULT_CONFIG, ...cfg });

  useEffect(() => {
    setForm({ ...DEFAULT_CONFIG, ...(terminal.peripheralConfig as PeripheralConfig ?? {}) });
  }, [terminal.peripheralConfig, open]);

  const mutation = useMutation({
    mutationFn: async (data: PeripheralConfig) => {
      const res = await apiRequest("PUT", `/api/pos/terminals/${terminal.id}/peripheral-config`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/terminals"] });
      toast({ title: "Peripheral config saved", description: `${terminal.name} will apply settings on next heartbeat.` });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function toggle(key: keyof PeripheralConfig, val: boolean) {
    setForm(f => ({ ...f, [key]: val }));
  }
  function field(key: keyof PeripheralConfig, val: string | number) {
    setForm(f => ({ ...f, [key]: val }));
  }

  const { online } = terminalOnlineStatus(terminal);

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            {terminal.name} — Peripheral Settings
          </SheetTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={`w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-gray-400"}`} />
            {online ? "Online" : "Offline — settings will apply on next connection"}
            {status.app_version && <Badge variant="outline" className="text-[10px] ml-auto">v{status.app_version}</Badge>}
          </div>
        </SheetHeader>

        {/* Current reported status (read-only) */}
        {terminal.peripheralStatus && (
          <div className="mb-6 p-3 rounded-lg bg-muted/50 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Live Status (reported by terminal)</p>
            <div className="flex flex-wrap gap-1.5">
              {buildPeripheralPills(terminal.peripheralConfig as PeripheralConfig, status).map(p => (
                <PeripheralPill key={p.label} icon={p.icon} label={p.label} level={p.level} tooltip={p.tooltip} />
              ))}
            </div>
            {status.cashier_name && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <User className="w-3 h-3" /> Cashier: {status.cashier_name}
                {status.shift_open !== undefined && (
                  <Badge variant={status.shift_open ? "default" : "secondary"} className="ml-1 text-[10px]">
                    Shift {status.shift_open ? "Open" : "Closed"}
                  </Badge>
                )}
              </p>
            )}
            {status.reported_at && (
              <p className="text-[10px] text-muted-foreground/60">Last report: {formatDistanceToNow(new Date(status.reported_at), { addSuffix: true })}</p>
            )}
          </div>
        )}

        <div className="space-y-6">

          {/* Receipt Printer */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Receipt Printer</span>
              </div>
              <Switch checked={form.printer_enabled} onCheckedChange={v => toggle("printer_enabled", v)} data-testid="toggle-printer" />
            </div>
            {form.printer_enabled && (
              <div className="grid grid-cols-2 gap-3 ml-6">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Port / Path</label>
                  <Input value={form.printer_port} onChange={e => field("printer_port", e.target.value)} placeholder="/dev/ttyUSB0" className="h-8 text-xs" data-testid="input-printer-port" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Columns</label>
                  <Input type="number" value={form.printer_columns} onChange={e => field("printer_columns", parseInt(e.target.value) || 42)} min={24} max={80} className="h-8 text-xs" data-testid="input-printer-columns" />
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Cash Drawer */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Cash Drawer</span>
              </div>
              <Switch checked={form.drawer_enabled} onCheckedChange={v => toggle("drawer_enabled", v)} data-testid="toggle-drawer" />
            </div>
            {form.drawer_enabled && (
              <div className="ml-6">
                <label className="text-xs text-muted-foreground">Port / Path (leave blank to use printer port)</label>
                <Input value={form.drawer_port} onChange={e => field("drawer_port", e.target.value)} placeholder="Same as printer" className="h-8 text-xs mt-1" data-testid="input-drawer-port" />
              </div>
            )}
          </div>

          <Separator />

          {/* Weighing Scale */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Weighing Scale</span>
              </div>
              <Switch checked={form.scale_enabled} onCheckedChange={v => toggle("scale_enabled", v)} data-testid="toggle-scale" />
            </div>
            {form.scale_enabled && (
              <div className="ml-6">
                <label className="text-xs text-muted-foreground">Port / Path</label>
                <Input value={form.scale_port} onChange={e => field("scale_port", e.target.value)} placeholder="/dev/ttyUSB1" className="h-8 text-xs mt-1" data-testid="input-scale-port" />
              </div>
            )}
          </div>

          <Separator />

          {/* Customer Display */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="font-medium text-sm">Customer Pole Display</span>
                <p className="text-xs text-muted-foreground">Shows items and total on a secondary screen</p>
              </div>
            </div>
            <Switch checked={form.customer_display_enabled} onCheckedChange={v => toggle("customer_display_enabled", v)} data-testid="toggle-customer-display" />
          </div>

          <Separator />

          {/* Barcode Scanner */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="font-medium text-sm">Barcode Scanner</span>
                <p className="text-xs text-muted-foreground">USB HID keyboard-wedge scanner</p>
              </div>
            </div>
            <Switch checked={form.barcode_scanner_enabled} onCheckedChange={v => toggle("barcode_scanner_enabled", v)} data-testid="toggle-scanner" />
          </div>

          <Separator />

          {/* Card Terminal */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Card Terminal</span>
            </div>
            <Select value={form.card_terminal_provider} onValueChange={v => field("card_terminal_provider", v)}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-card-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None / Not connected</SelectItem>
                <SelectItem value="jcc">JCC</SelectItem>
                <SelectItem value="viva">Viva Wallet</SelectItem>
                <SelectItem value="worldpay">Worldpay</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Self-Checkout Mode */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className="font-medium text-sm">Self-Checkout Mode</span>
                <p className="text-xs text-muted-foreground">Terminal boots directly into SCO screen</p>
              </div>
            </div>
            <Switch checked={form.sco_mode} onCheckedChange={v => toggle("sco_mode", v)} data-testid="toggle-sco" />
          </div>

          <Separator />

          {/* Price Level */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-sm">Default Price Level</span>
            </div>
            <Select value={String(form.price_level)} onValueChange={v => field("price_level", parseInt(v))}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-price-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map(n => (
                  <SelectItem key={n} value={String(n)}>Level {n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 mt-8 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending}
            data-testid="button-save-peripheral-config"
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save & Push to Terminal
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Terminal CRUD form ─────────────────────────────────────────────────────────

const terminalFormSchema = insertPosTerminalSchema.extend({
  name: z.string().min(1, "Name required"),
  code: z.string().min(1, "Code required"),
  locationId: z.string().min(1, "Location required"),
});
type TerminalFormValues = z.infer<typeof terminalFormSchema>;

function TerminalForm({ initial, onClose }: { initial?: PosTerminal; onClose: () => void }) {
  const { toast } = useToast();
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });
  const { data: layouts = [] } = useQuery<PosLayoutSet[]>({ queryKey: ["/api/pos/layouts"] });

  const form = useForm<TerminalFormValues>({
    resolver: zodResolver(terminalFormSchema),
    defaultValues: {
      name: initial?.name ?? "",
      code: initial?.code ?? "",
      locationId: initial?.locationId ?? "",
      description: initial?.description ?? "",
      hardwareType: initial?.hardwareType ?? "desktop",
      layoutSetId: initial?.layoutSetId ?? undefined,
      active: initial?.active ?? true,
      outboxQueueSize: initial?.outboxQueueSize ?? 0,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: TerminalFormValues) => {
      if (initial) {
        const res = await apiRequest("PUT", `/api/pos/terminals/${initial.id}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/pos/terminals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/terminals"] });
      toast({ title: initial ? "Terminal updated" : "Terminal created" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>Terminal Name</FormLabel><FormControl><Input {...field} placeholder="Checkout 1" data-testid="input-terminal-name" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="code" render={({ field }) => (
            <FormItem><FormLabel>Code</FormLabel><FormControl><Input {...field} placeholder="T001" data-testid="input-terminal-code" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="locationId" render={({ field }) => (
          <FormItem>
            <FormLabel>Location</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger data-testid="select-terminal-location"><SelectValue placeholder="Select location" /></SelectTrigger></FormControl>
              <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="layoutSetId" render={({ field }) => (
          <FormItem>
            <FormLabel className="flex items-center gap-1.5"><LayoutGrid className="w-3.5 h-3.5" /> Button Layout</FormLabel>
            <Select value={field.value ?? "none"} onValueChange={v => field.onChange(v === "none" ? undefined : v)}>
              <FormControl>
                <SelectTrigger data-testid="select-terminal-layout"><SelectValue placeholder="No layout assigned" /></SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">— No layout assigned —</SelectItem>
                {layouts.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField control={form.control} name="hardwareType" render={({ field }) => (
          <FormItem>
            <FormLabel>Hardware Type</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="tablet">Tablet</SelectItem>
                <SelectItem value="mobile">Mobile</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} value={field.value ?? ""} placeholder="Optional description" /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="active" render={({ field }) => (
          <FormItem className="flex items-center gap-3">
            <FormControl><Switch checked={field.value ?? true} onCheckedChange={field.onChange} /></FormControl>
            <FormLabel className="!mt-0">Active</FormLabel>
          </FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-terminal">
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initial ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Terminal Card ─────────────────────────────────────────────────────────────

function TerminalCard({
  terminal,
  layouts,
  onEdit,
  onDelete,
}: {
  terminal: EnrichedTerminal;
  layouts: PosLayoutSet[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const seen = terminalOnlineStatus(terminal);
  const cfg = terminal.peripheralConfig as PeripheralConfig | null;
  const status = terminal.peripheralStatus as PeripheralStatus | null;
  const pills = buildPeripheralPills(cfg, status);
  const assignedLayout = layouts.find(l => l.id === terminal.layoutSetId);

  const enabledPeripherals = pills.filter(p => p.level !== "off").length;
  const problemPeripherals = pills.filter(p => p.level === "error" || p.level === "warn").length;

  return (
    <>
      <Card
        data-testid={`card-terminal-${terminal.id}`}
        className={`relative transition-all ${!terminal.active ? "opacity-60" : ""} ${seen.online ? "border-green-500/20" : ""}`}
      >
        {/* Online indicator strip */}
        <div className={`absolute top-0 left-0 right-0 h-0.5 rounded-t-lg ${seen.online ? "bg-green-500" : "bg-gray-600"}`} />

        <CardHeader className="pb-2 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base flex items-center gap-2">
                {seen.online ? (
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 shadow-sm shadow-green-500/50" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gray-500 flex-shrink-0" />
                )}
                <span className="truncate">{terminal.name}</span>
              </CardTitle>
              <div className="flex items-center gap-2 mt-0.5">
                <code className="text-xs text-muted-foreground">{terminal.code}</code>
                <span className="text-muted-foreground/30 text-xs">·</span>
                <span className="text-xs text-muted-foreground capitalize">{terminal.hardwareType}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <PosHeartbeatIndicator online={seen.online} peripheralStatus={status} />
              <Badge
                variant={seen.online ? "default" : "secondary"}
                className={`text-[10px] px-1.5 py-0 ${seen.online ? "bg-green-600 hover:bg-green-600" : ""}`}
              >
                {seen.online ? "Online" : "Offline"}
              </Badge>
              {!terminal.active && <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">Inactive</Badge>}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Location */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" />
            <span>{terminal.locationName || terminal.locationId}</span>
            {assignedLayout && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <LayoutGrid className="w-3 h-3" />
                <span className="truncate max-w-[120px]">{assignedLayout.name}</span>
              </>
            )}
          </div>

          {/* Peripheral health pills */}
          <div className="flex flex-wrap gap-1">
            {pills.map(p => (
              <PeripheralPill key={p.label} icon={p.icon} label={p.label} level={p.level} tooltip={p.tooltip} />
            ))}
          </div>

          {/* Cashier / shift */}
          {status?.cashier_name && (
            <div className="flex items-center gap-1.5 text-xs">
              <User className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">{status.cashier_name}</span>
              {status.shift_open !== undefined && (
                <Badge variant={status.shift_open ? "default" : "outline"} className="text-[10px] px-1.5 py-0">
                  Shift {status.shift_open ? "Open" : "Closed"}
                </Badge>
              )}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {seen.diff === Infinity ? "Never seen" : `${seen.label}`}
            </div>
            <div className="flex items-center gap-2">
              {terminal.outboxQueueSize > 0 && (
                <span className="flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="w-3 h-3" />
                  {terminal.outboxQueueSize} pending
                </span>
              )}
              {problemPeripherals > 0 && (
                <span className="flex items-center gap-1 text-red-500">
                  <AlertTriangle className="w-3 h-3" />
                  {problemPeripherals} issues
                </span>
              )}
              {enabledPeripherals > 0 && problemPeripherals === 0 && (
                <span className="flex items-center gap-1 text-green-500">
                  <CheckCircle2 className="w-3 h-3" />
                  {enabledPeripherals} active
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs"
              onClick={() => setConfigOpen(true)}
              data-testid={`button-configure-${terminal.id}`}
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              Peripherals
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              onClick={onEdit}
              data-testid={`button-edit-terminal-${terminal.id}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-destructive hover:bg-destructive/10"
              onClick={onDelete}
              data-testid={`button-delete-terminal-${terminal.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <PeripheralConfigSheet
        terminal={terminal}
        open={configOpen}
        onClose={() => setConfigOpen(false)}
      />
    </>
  );
}

// ── Main Terminal Hub Page ────────────────────────────────────────────────────

export default function PosTerminalHub() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosTerminal | undefined>();
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: terminals = [], isLoading, refetch, dataUpdatedAt } = useQuery<EnrichedTerminal[]>({
    queryKey: ["/api/pos/terminals"],
    refetchInterval: autoRefresh ? 30_000 : false,
  });
  const { data: locations = [] } = useQuery<PosLocation[]>({ queryKey: ["/api/pos/locations"] });
  const { data: layouts = [] } = useQuery<PosLayoutSet[]>({ queryKey: ["/api/pos/layouts"] });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/pos/terminals/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/pos/terminals"] }); toast({ title: "Terminal deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = locationFilter !== "all" ? terminals.filter(t => t.locationId === locationFilter) : terminals;
  const onlineCount = terminals.filter(t => terminalOnlineStatus(t).online).length;
  const offlineCount = terminals.length - onlineCount;
  const pendingSync = terminals.reduce((s, t) => s + (t.outboxQueueSize ?? 0), 0);

  // Group by location
  const byLocation = locations.reduce<Record<string, EnrichedTerminal[]>>((acc, loc) => {
    acc[loc.id] = filtered.filter(t => t.locationId === loc.id);
    return acc;
  }, {});
  const noLocationTerminals = filtered.filter(t => !locations.find(l => l.id === t.locationId));

  const lastRefreshed = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Monitor className="w-6 h-6" />
            Terminal Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live status, peripheral health &amp; configuration for all POS terminals
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAutoRefresh(a => !a)}
                className={autoRefresh ? "text-green-600 border-green-500/40" : ""}
                data-testid="toggle-auto-refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${autoRefresh ? "animate-spin" : ""}`} style={autoRefresh ? { animationDuration: "4s" } : {}} />
                {autoRefresh ? "Live" : "Paused"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{autoRefresh ? "Auto-refreshing every 30 s" : "Auto-refresh paused"} · Last: {lastRefreshed ?? "—"}</TooltipContent>
          </Tooltip>

          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Refresh
          </Button>

          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button onClick={() => { setEditing(undefined); setOpen(true); }} data-testid="button-add-terminal">
            <Plus className="w-4 h-4 mr-2" />Add Terminal
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Terminals", value: terminals.length, icon: Monitor, color: "text-foreground" },
          { label: "Online", value: onlineCount, icon: Wifi, color: "text-green-500" },
          { label: "Offline", value: offlineCount, icon: WifiOff, color: offlineCount > 0 ? "text-gray-400" : "text-muted-foreground" },
          { label: "Pending Sync", value: pendingSync, icon: AlertTriangle, color: pendingSync > 0 ? "text-amber-500" : "text-muted-foreground" },
        ].map(s => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center gap-3">
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Terminal grid */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Monitor className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No terminals found</p>
            <p className="text-sm mt-1">{locationFilter !== "all" ? "No terminals for this location." : "Add your first POS terminal."}</p>
            <Button className="mt-4" onClick={() => { setEditing(undefined); setOpen(true); }}>Add Terminal</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Terminals grouped by location */}
          {locations.map(loc => {
            const locTerminals = byLocation[loc.id] ?? [];
            if (locTerminals.length === 0) return null;
            const locOnline = locTerminals.filter(t => terminalOnlineStatus(t).online).length;
            return (
              <section key={loc.id}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <h2 className="font-semibold text-sm">{loc.name}</h2>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{locTerminals.length} terminal{locTerminals.length !== 1 ? "s" : ""}</Badge>
                  <Badge variant={locOnline === locTerminals.length ? "default" : "secondary"} className={`text-[10px] ${locOnline === locTerminals.length ? "bg-green-600" : ""}`}>
                    {locOnline}/{locTerminals.length} online
                  </Badge>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {locTerminals.map(t => (
                    <TerminalCard
                      key={t.id}
                      terminal={t}
                      layouts={layouts}
                      onEdit={() => { setEditing(t as PosTerminal); setOpen(true); }}
                      onDelete={() => deleteMutation.mutate(t.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {/* Terminals with no matching location */}
          {noLocationTerminals.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-semibold text-sm text-muted-foreground">Unassigned Location</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {noLocationTerminals.map(t => (
                  <TerminalCard
                    key={t.id}
                    terminal={t}
                    layouts={layouts}
                    onEdit={() => { setEditing(t as PosTerminal); setOpen(true); }}
                    onDelete={() => deleteMutation.mutate(t.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* New/Edit Terminal dialog */}
      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); setEditing(undefined); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Terminal" : "New Terminal"}</DialogTitle></DialogHeader>
          <TerminalForm initial={editing} onClose={() => { setOpen(false); setEditing(undefined); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
