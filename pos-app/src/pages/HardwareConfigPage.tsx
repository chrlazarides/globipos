/**
 * HardwareConfigPage — configure scale, printer, cash drawer, VFD, and
 * card payment gateway credentials from inside the POS terminal.
 *
 * Reads/writes HardwareConfig (schema_meta 'hardware_config') and
 * PaymentConfig (schema_meta 'payment_config') via existing Tauri commands.
 * "Test" buttons invoke the real hardware commands to verify each device.
 */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings, Scale, Printer, CreditCard, Monitor,
  ArrowLeft, CheckCircle, XCircle, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types (mirrors hardware.rs structs) ────────────────────────────────────────

interface HardwareConfig {
  scale_enabled: boolean;
  scale_port: string;
  scale_baud: number;
  scale_protocol: string;
  printer_enabled: boolean;
  printer_port: string;
  printer_columns: number;
  printer_logo: boolean;
  drawer_enabled: boolean;
  drawer_pulse_ms: number;
  customer_display_enabled: boolean;
  customer_display_port: string;
  vfd_enabled: boolean;
  vfd_port: string;
  vfd_baud: number;
  vfd_protocol: string;
  payment_provider: string;
}

interface PaymentConfig {
  provider: string;
  endpoint: string;
  merchant_id: string;
  api_key: string;
  jcc_pos_id?: string;
  jcc_store_id?: string;
  viva_source_code?: string;
  viva_client_id?: string;
  viva_client_secret?: string;
  worldpay_entity?: string;
  // Payabl
  payabl_terminal_id?: string;
  // PBT / Planet PAX
  pbt_terminal_ip?: string;
  pbt_terminal_port?: number;
}

const DEFAULT_HW: HardwareConfig = {
  scale_enabled: false, scale_port: "", scale_baud: 9600, scale_protocol: "toledo",
  printer_enabled: false, printer_port: "", printer_columns: 42, printer_logo: false,
  drawer_enabled: false, drawer_pulse_ms: 200,
  customer_display_enabled: false, customer_display_port: "",
  vfd_enabled: false, vfd_port: "", vfd_baud: 9600, vfd_protocol: "generic",
  payment_provider: "mock",
};

const DEFAULT_PAYMENT: PaymentConfig = {
  provider: "mock", endpoint: "", merchant_id: "", api_key: "",
};

interface HardwareConfigPageProps {
  onClose: () => void;
}

type TestStatus = "idle" | "testing" | "ok" | "error";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-green-600" : "bg-gray-600"}`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wide border-b border-gray-800 pb-2 mb-4">
      <Icon className="h-4 w-4 text-burgundy-400" />
      {title}
    </div>
  );
}

export default function HardwareConfigPage({ onClose }: HardwareConfigPageProps) {
  const [hw, setHw]           = useState<HardwareConfig>(DEFAULT_HW);
  const [pay, setPay]         = useState<PaymentConfig>(DEFAULT_PAYMENT);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [testScale, setTestScale]   = useState<TestStatus>("idle");
  const [testPrint, setTestPrint]   = useState<TestStatus>("idle");
  const [testDrawer, setTestDrawer] = useState<TestStatus>("idle");

  useEffect(() => {
    invoke<HardwareConfig>("get_hardware_config").then(setHw).catch(() => {});
    invoke<PaymentConfig>("get_payment_config").then(setPay).catch(() => {});
  }, []);

  const updateHw = <K extends keyof HardwareConfig>(key: K, value: HardwareConfig[K]) =>
    setHw((prev) => ({ ...prev, [key]: value }));
  const updatePay = <K extends keyof PaymentConfig>(key: K, value: PaymentConfig[K]) =>
    setPay((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true); setSaved(false); setError(null);
    try {
      await invoke("save_hardware_config", { config: { ...hw, payment_provider: pay.provider } });
      await invoke("save_payment_config", { config: pay });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(
    setter: (s: TestStatus) => void,
    fn: () => Promise<unknown>
  ) {
    setter("testing");
    try {
      await fn();
      setter("ok");
      setTimeout(() => setter("idle"), 3000);
    } catch {
      setter("error");
      setTimeout(() => setter("idle"), 4000);
    }
  }

  function TestBtn({ status, onTest }: { status: TestStatus; onTest: () => void }) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onTest}
        disabled={status === "testing"}
        className="shrink-0"
      >
        {status === "testing" && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
        {status === "ok"      && <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-500" />}
        {status === "error"   && <XCircle className="h-3.5 w-3.5 mr-1 text-red-500" />}
        {status === "idle" ? "Test" : status === "testing" ? "Testing…" : status === "ok" ? "OK" : "Failed"}
      </Button>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Settings className="h-5 w-5 text-burgundy-400" />
        <h1 className="text-lg font-semibold">Hardware & Payment Configuration</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-8">

        {/* ── Scale ──────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Scale} title="Scale" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Scale enabled</Label>
              <Toggle checked={hw.scale_enabled} onChange={(v) => updateHw("scale_enabled", v)} />
            </div>
            {hw.scale_enabled && (
              <>
                <div className="space-y-1">
                  <Label>Port</Label>
                  <div className="flex gap-2">
                    <Input
                      className="bg-gray-800 border-gray-700 text-white"
                      placeholder="/dev/ttyUSB0 or COM3"
                      value={hw.scale_port}
                      onChange={(e) => updateHw("scale_port", e.target.value)}
                    />
                    <TestBtn
                      status={testScale}
                      onTest={() => runTest(setTestScale, () => invoke("scale_read_weight"))}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Baud rate</Label>
                    <Input
                      type="number"
                      className="bg-gray-800 border-gray-700 text-white"
                      value={hw.scale_baud}
                      onChange={(e) => updateHw("scale_baud", parseInt(e.target.value) || 9600)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Protocol</Label>
                    <select
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2 text-sm"
                      value={hw.scale_protocol}
                      onChange={(e) => updateHw("scale_protocol", e.target.value)}
                    >
                      <option value="toledo">Toledo</option>
                      <option value="mettler">Mettler</option>
                      <option value="digi">Digi</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Printer ────────────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={Printer} title="Receipt Printer" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Printer enabled</Label>
              <Toggle checked={hw.printer_enabled} onChange={(v) => updateHw("printer_enabled", v)} />
            </div>
            {hw.printer_enabled && (
              <>
                <div className="space-y-1">
                  <Label>Port</Label>
                  <div className="flex gap-2">
                    <Input
                      className="bg-gray-800 border-gray-700 text-white"
                      placeholder="/dev/usb/lp0 or USB001"
                      value={hw.printer_port}
                      onChange={(e) => updateHw("printer_port", e.target.value)}
                    />
                    <TestBtn
                      status={testPrint}
                      onTest={() =>
                        runTest(setTestPrint, () =>
                          invoke("print_receipt", {
                            lines: [
                              { text: "Hardware Test", align: "center", bold: true },
                              { divider: true },
                              { text: new Date().toLocaleString(), align: "center" },
                              { divider: true },
                              { text: "Test OK", align: "center" },
                            ],
                          })
                        )
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Columns (characters)</Label>
                    <Input
                      type="number"
                      min={32}
                      max={80}
                      className="bg-gray-800 border-gray-700 text-white"
                      value={hw.printer_columns}
                      onChange={(e) => updateHw("printer_columns", parseInt(e.target.value) || 42)}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-6">
                    <Label>Print logo</Label>
                    <Toggle checked={hw.printer_logo} onChange={(v) => updateHw("printer_logo", v)} />
                  </div>
                </div>

                {/* Cash drawer */}
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <Label>Cash drawer (RJ-11)</Label>
                    <Toggle checked={hw.drawer_enabled} onChange={(v) => updateHw("drawer_enabled", v)} />
                  </div>
                  {hw.drawer_enabled && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1">
                        <Label>Pulse duration (ms)</Label>
                        <Input
                          type="number"
                          min={50}
                          max={500}
                          className="bg-gray-800 border-gray-700 text-white"
                          value={hw.drawer_pulse_ms}
                          onChange={(e) => updateHw("drawer_pulse_ms", parseInt(e.target.value) || 200)}
                        />
                      </div>
                      <div className="mt-6">
                        <TestBtn
                          status={testDrawer}
                          onTest={() => runTest(setTestDrawer, () => invoke("open_cash_drawer"))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Customer / VFD Display ──────────────────────────────────── */}
        <section>
          <SectionHeader icon={Monitor} title="Customer Display (VFD)" />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>VFD display enabled</Label>
              <Toggle checked={hw.vfd_enabled} onChange={(v) => updateHw("vfd_enabled", v)} />
            </div>
            {hw.vfd_enabled && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>VFD port</Label>
                  <Input
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="/dev/ttyUSB1"
                    value={hw.vfd_port}
                    onChange={(e) => updateHw("vfd_port", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>VFD baud rate</Label>
                    <Input
                      type="number"
                      className="bg-gray-800 border-gray-700 text-white"
                      value={hw.vfd_baud}
                      onChange={(e) => updateHw("vfd_baud", parseInt(e.target.value) || 9600)}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <Label>Multimedia customer screen</Label>
              <Toggle checked={hw.customer_display_enabled} onChange={(v) => updateHw("customer_display_enabled", v)} />
            </div>
            {hw.customer_display_enabled && (
              <div className="space-y-1">
                <Label>Display port (or window)</Label>
                <Input
                  className="bg-gray-800 border-gray-700 text-white"
                  placeholder="/dev/ttyUSB2 or leave blank for overlay"
                  value={hw.customer_display_port}
                  onChange={(e) => updateHw("customer_display_port", e.target.value)}
                />
              </div>
            )}
          </div>
        </section>

        {/* ── Payment Gateway ─────────────────────────────────────────── */}
        <section>
          <SectionHeader icon={CreditCard} title="Card Payment Gateway" />
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Provider</Label>
              <select
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-md px-3 py-2 text-sm"
                value={pay.provider}
                onChange={(e) => { updatePay("provider", e.target.value); updateHw("payment_provider", e.target.value); }}
              >
                <option value="mock">Mock (test / demo)</option>
                <option value="jcc">JCC (Cyprus)</option>
                <option value="viva">Viva Wallet</option>
                <option value="worldpay">Worldpay</option>
                <option value="payabl">Payabl.</option>
                <option value="pbt">PBT / Planet PAX (Cyprus)</option>
              </select>
            </div>

            {pay.provider !== "mock" && (
              <>
                {/* PBT uses a dedicated terminal-IP field — skip the generic URL */}
                {pay.provider !== "pbt" && (
                  <div className="space-y-1">
                    <Label>API endpoint URL</Label>
                    <Input
                      className="bg-gray-800 border-gray-700 text-white"
                      placeholder={
                        pay.provider === "payabl"
                          ? "https://pay4.sandbox.payabl.com  (or pay4.payabl.com)"
                          : "https://gateway.example.com"
                      }
                      value={pay.endpoint}
                      onChange={(e) => updatePay("endpoint", e.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Merchant ID</Label>
                  <Input
                    className="bg-gray-800 border-gray-700 text-white"
                    value={pay.merchant_id}
                    onChange={(e) => updatePay("merchant_id", e.target.value)}
                  />
                </div>
                {/* PBT: api_key is optional (local LAN); shown only for other providers */}
                {pay.provider !== "pbt" && (
                  <div className="space-y-1">
                    <Label>API key / token</Label>
                    <Input
                      type="password"
                      className="bg-gray-800 border-gray-700 text-white"
                      value={pay.api_key}
                      onChange={(e) => updatePay("api_key", e.target.value)}
                    />
                  </div>
                )}
              </>
            )}

            {pay.provider === "jcc" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>POS ID</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white" value={pay.jcc_pos_id ?? ""} onChange={(e) => updatePay("jcc_pos_id", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Store ID</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white" value={pay.jcc_store_id ?? ""} onChange={(e) => updatePay("jcc_store_id", e.target.value)} />
                </div>
              </div>
            )}

            {pay.provider === "viva" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Source code</Label>
                  <Input className="bg-gray-800 border-gray-700 text-white" value={pay.viva_source_code ?? ""} onChange={(e) => updatePay("viva_source_code", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Client ID</Label>
                    <Input className="bg-gray-800 border-gray-700 text-white" value={pay.viva_client_id ?? ""} onChange={(e) => updatePay("viva_client_id", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label>Client secret</Label>
                    <Input type="password" className="bg-gray-800 border-gray-700 text-white" value={pay.viva_client_secret ?? ""} onChange={(e) => updatePay("viva_client_secret", e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {pay.provider === "worldpay" && (
              <div className="space-y-1">
                <Label>Entity ID</Label>
                <Input className="bg-gray-800 border-gray-700 text-white" value={pay.worldpay_entity ?? ""} onChange={(e) => updatePay("worldpay_entity", e.target.value)} />
              </div>
            )}

            {pay.provider === "payabl" && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400 bg-gray-900 rounded-md px-3 py-2 border border-gray-700">
                  <strong>Payabl.</strong> — Use <code>https://pay4.sandbox.payabl.com</code> for testing or{" "}
                  <code>https://pay4.payabl.com</code> for production. API key and Merchant ID are provided in your Payabl merchant portal.
                </div>
                <div className="space-y-1">
                  <Label>Terminal ID</Label>
                  <Input
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="01 (default)"
                    value={pay.payabl_terminal_id ?? ""}
                    onChange={(e) => updatePay("payabl_terminal_id", e.target.value)}
                  />
                  <p className="text-xs text-gray-500">Physical terminal identifier from your Payabl dashboard.</p>
                </div>
              </div>
            )}

            {pay.provider === "pbt" && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400 bg-gray-900 rounded-md px-3 py-2 border border-gray-700">
                  <strong>PBT / Planet PAX</strong> — The PAX terminal must be on the same local network as this POS.
                  Leave API key blank (local LAN — no bearer auth required). Merchant ID is the reference
                  printed on your PBT terminal configuration slip.
                </div>
                <div className="space-y-1">
                  <Label>Terminal LAN IP address</Label>
                  <Input
                    className="bg-gray-800 border-gray-700 text-white font-mono"
                    placeholder="192.168.1.100"
                    value={pay.pbt_terminal_ip ?? ""}
                    onChange={(e) => updatePay("pbt_terminal_ip", e.target.value)}
                  />
                  <p className="text-xs text-gray-500">Local IP of the PAX terminal (Planet Integra service).</p>
                </div>
                <div className="space-y-1">
                  <Label>Terminal port</Label>
                  <Input
                    type="number"
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder="10009"
                    value={pay.pbt_terminal_port ?? ""}
                    onChange={(e) => updatePay("pbt_terminal_port", e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                  <p className="text-xs text-gray-500">Default: 10009 (Planet Integra). Change only if your terminal is configured differently.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Save ───────────────────────────────────────────────────── */}
        <div className="pt-4 pb-8">
          {error && (
            <div className="mb-3 text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-2">
              {error}
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-burgundy-700 hover:bg-burgundy-600 text-white py-3 text-base font-semibold"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</> :
             saved  ? <><CheckCircle className="h-4 w-4 mr-2 text-green-400" /> Saved!</> :
             "Save Configuration"}
          </Button>
        </div>
      </div>
    </div>
  );
}
