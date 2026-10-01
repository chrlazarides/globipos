import { TerminalHeartbeatBody, DeploymentHeartbeatBody } from "@workspace/api-zod";
import type { PosSyncSnapshot, DeviceSyncReport } from "@workspace/api-zod";

export type ReceivedSync = PosSyncSnapshot & { receivedAt: string };
const snapshotSchema = TerminalHeartbeatBody.shape.syncStatus.unwrap();

export function parseSyncTelemetry(input: unknown): PosSyncSnapshot {
  const value = snapshotSchema.parse(input);
  for (const key of ["lastAttemptAt", "startedAt", "progressAt", "lastServerContactAt", "lastCatalogSyncAt",
    "lastTransactionSyncAt", "lastSuccessAt", "retryAt"] as const) {
    if (value[key] && !Number.isFinite(Date.parse(value[key]!))) throw new Error("Invalid sync timestamp");
  }
  if (value.catalogCommitted > value.catalogReceived) throw new Error("Committed count exceeds received count");
  // Never relay arbitrary error bodies, URLs, credentials or customer details to support monitoring.
  return { ...value, error: value.error ? "Device reported a sync failure. Review local diagnostics." : null };
}

/** Called under a terminal row lock, so concurrent API processes cannot regress the report. */
export function mergeSyncHeartbeat(
  previous: Record<string, unknown>, incoming: Record<string, unknown> | undefined,
  rawSync: unknown, receivedAt: string,
): Record<string, unknown> {
  const next = { ...previous, ...incoming };
  // Preserve the existing SCO acknowledgement rule, including sync-only PWA heartbeats.
  const mode = incoming?.sco_mode;
  if (mode !== undefined) {
    if (previous.sco_override_acknowledged === true && (mode === "attendant_needed" || mode === "age_check")) {
      next.sco_mode = "scanning";
      next.sco_attendant_reason = null;
      next.sco_override_acknowledged = true;
    } else {
      delete next.sco_override_acknowledged;
    }
  }
  // These keys are server-owned; incoming peripheral objects cannot bypass ordering or redaction.
  next.sync = previous.sync;
  next.syncDevices = previous.syncDevices;
  if (rawSync === undefined) return next;
  const sync = parseSyncTelemetry(rawSync);
  const devices = { ...(previous.syncDevices as Record<string, ReceivedSync> | undefined) };
  const old = devices[sync.deviceId] ?? (previous.sync as ReceivedSync | undefined);
  if (old?.deviceId === sync.deviceId && sync.sequence <= old.sequence) return next;
  const received = { ...sync, receivedAt };
  devices[sync.deviceId] = received;
  const recent = Object.values(devices).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 8);
  next.syncDevices = Object.fromEntries(recent.map(item => [item.deviceId, item]));
  next.sync = received;
  return next;
}

export function deviceReportsFromTerminals(terminals: Array<{
  id: string; name: string; peripheralStatus?: unknown;
}>): DeviceSyncReport[] {
  const reports: DeviceSyncReport[] = [];
  for (const terminal of terminals) {
    const status = terminal.peripheralStatus as { sync?: ReceivedSync; syncDevices?: Record<string, ReceivedSync> } | null;
    const candidates = status?.syncDevices ? Object.values(status.syncDevices) : status?.sync ? [status.sync] : [];
    for (const candidate of candidates) {
      try {
        const sync = parseSyncTelemetry(candidate);
        if (!Number.isFinite(Date.parse(candidate.receivedAt))) continue;
        reports.push({ terminalId: terminal.id, terminalName: terminal.name.slice(0, 80), receivedAt: candidate.receivedAt, sync });
      } catch { /* Old/incompatible devices remain visible locally, but aren't reported as current telemetry. */ }
    }
  }
  return reports.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 200);
}

export function parseDeploymentDeviceReports(input: unknown): DeviceSyncReport[] {
  const body = DeploymentHeartbeatBody.parse({ deviceReports: input });
  return (body.deviceReports ?? []).map(report => {
    if (!Number.isFinite(Date.parse(report.receivedAt))) throw new Error("Invalid device report time");
    return { ...report, sync: parseSyncTelemetry(report.sync) };
  });
}

export function mergeDeploymentDeviceReports(previous: DeviceSyncReport[], incoming: DeviceSyncReport[]): DeviceSyncReport[] {
  const map = new Map(previous.map(item => [`${item.terminalId}:${item.sync.deviceId}`, item]));
  for (const item of incoming) {
    const key = `${item.terminalId}:${item.sync.deviceId}`;
    const old = map.get(key);
    // The original customer-received time is preserved. Relay heartbeats cannot make sleeping devices fresh.
    if (!old || item.sync.sequence > old.sync.sequence) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 200);
}