/**
 * useHardware — scale, receipt printer, and cash drawer hooks.
 *
 * Polls the scale for live weight data (configurable interval).
 * Formats and sends ESC/POS receipts to the printer.
 * Triggers cash drawer pulse on cash payments.
 * Shows hardware status (online/offline) in the POS header.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScaleReading {
  grams: number;
  kg: number;
  stable: boolean;
  tared: boolean;
}

export interface HardwareConfig {
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
}

export type DeviceStatus = "online" | "offline" | "unknown" | "busy";

export interface PrintReceiptLine {
  text?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: "normal" | "big";
  divider?: boolean;
}

export interface UseHardwareReturn {
  config: HardwareConfig | null;
  scaleWeight: ScaleReading | null;
  scaleError: string | null;
  printerStatus: DeviceStatus;
  printing: boolean;
  printError: string | null;

  // Scale
  readWeight: () => Promise<ScaleReading | null>;
  tare: () => Promise<void>;
  startWeightPolling: (intervalMs?: number) => void;
  stopWeightPolling: () => void;

  // Printer
  printReceipt: (lines: PrintReceiptLine[]) => Promise<boolean>;

  // Cash drawer
  openDrawer: () => Promise<boolean>;

  // VFD
  writeVfd: (line1: string, line2: string) => Promise<boolean>;
  clearVfd: () => Promise<boolean>;

  // Config
  loadConfig: () => Promise<void>;
  saveConfig: (cfg: HardwareConfig) => Promise<void>;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useHardware(): UseHardwareReturn {
  const [config, setConfig] = useState<HardwareConfig | null>(null);
  const [scaleWeight, setScaleWeight] = useState<ScaleReading | null>(null);
  const [scaleError, setScaleError] = useState<string | null>(null);
  const [printerStatus, setPrinterStatus] = useState<DeviceStatus>("unknown");
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<HardwareConfig>("get_hardware_config");
      setConfig(cfg);
    } catch {
      setConfig(null);
    }
  }, []);

  const saveConfig = useCallback(async (cfg: HardwareConfig) => {
    await invoke("save_hardware_config", { config: cfg });
    setConfig(cfg);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // ── Scale ───────────────────────────────────────────────────────────────────

  const readWeight = useCallback(async (): Promise<ScaleReading | null> => {
    setScaleError(null);
    try {
      const w = await invoke<ScaleReading>("scale_read_weight");
      setScaleWeight(w);
      return w;
    } catch (e: any) {
      setScaleError(e?.message ?? "Scale error");
      return null;
    }
  }, []);

  const tare = useCallback(async () => {
    try {
      await invoke("scale_tare");
      setScaleWeight(null);
      setScaleError(null);
    } catch (e: any) {
      setScaleError(e?.message ?? "Tare failed");
    }
  }, []);

  const startWeightPolling = useCallback((intervalMs = 500) => {
    if (pollTimer.current) return; // already polling
    pollTimer.current = setInterval(async () => {
      try {
        const w = await invoke<ScaleReading>("scale_read_weight");
        setScaleWeight(w);
        setScaleError(null);
      } catch (e: any) {
        setScaleError(e?.message ?? "Scale error");
      }
    }, intervalMs);
  }, []);

  const stopWeightPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Auto-stop polling on unmount
  useEffect(() => () => stopWeightPolling(), [stopWeightPolling]);

  // ── Printer ─────────────────────────────────────────────────────────────────

  const printReceipt = useCallback(async (lines: PrintReceiptLine[]): Promise<boolean> => {
    setPrinting(true);
    setPrintError(null);
    try {
      await invoke("print_receipt", { lines });
      setPrinterStatus("online");
      return true;
    } catch (e: any) {
      const msg = e?.message ?? "Print failed";
      setPrintError(msg);
      setPrinterStatus("offline");
      return false;
    } finally {
      setPrinting(false);
    }
  }, []);

  // Periodic printer status check
  useEffect(() => {
    const checkPrinter = async () => {
      try {
        const online = await invoke<boolean>("check_printer_status");
        setPrinterStatus(online ? "online" : "offline");
      } catch {
        setPrinterStatus("unknown");
      }
    };
    checkPrinter();
    const t = setInterval(checkPrinter, 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Cash drawer ─────────────────────────────────────────────────────────────

  const openDrawer = useCallback(async (): Promise<boolean> => {
    try {
      await invoke("open_cash_drawer");
      return true;
    } catch {
      return false;
    }
  }, []);

  const writeVfd = useCallback(async (line1: string, line2: string): Promise<boolean> => {
    if (!config?.vfd_enabled) return false;
    try {
      await invoke("vfd_write", { line1, line2, cfg: config });
      return true;
    } catch {
      return false;
    }
  }, [config]);

  const clearVfd = useCallback(async (): Promise<boolean> => {
    if (!config?.vfd_enabled) return false;
    try {
      await invoke("vfd_clear", { cfg: config });
      return true;
    } catch {
      return false;
    }
  }, [config]);

  return {
    config,
    scaleWeight,
    scaleError,
    printerStatus,
    printing,
    printError,
    readWeight,
    tare,
    startWeightPolling,
    stopWeightPolling,
    printReceipt,
    openDrawer,
    writeVfd,
    clearVfd,
    loadConfig,
    saveConfig,
  };
}
