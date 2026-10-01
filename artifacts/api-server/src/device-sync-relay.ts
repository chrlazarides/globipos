import { storage } from "./storage";
import { deviceReportsFromTerminals } from "./sync-telemetry";
import { logger } from "./lib/logger";

/** Runs on a customer installation, never in a POS browser or native installer. */
export function startDeviceSyncRelay(): (() => void) | null {
  const origin = process.env.GLOBIPOS_MASTER_ORIGIN;
  const deploymentId = process.env.GLOBIPOS_DEPLOYMENT_ID;
  const token = process.env.GLOBIPOS_DEPLOYMENT_TOKEN;
  if (!origin && !deploymentId && !token) return null;
  if (!origin || !deploymentId || !token) {
    logger.error("Device sync relay is disabled: master origin, deployment ID and deployment token must all be configured");
    return null;
  }
  let endpoint: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "") || !/^[0-9a-f-]{36}$/i.test(deploymentId)) {
      throw new Error("Invalid master origin or deployment ID");
    }
    endpoint = `${url.origin}/api/control/heartbeat`;
  } catch {
    logger.error("Device sync relay is disabled: use an HTTPS master origin and a valid deployment ID");
    return null;
  }
  let active = false;
  const send = async () => {
    if (active) return;
    active = true;
    try {
      const terminals = await storage.getPosTerminals();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentId, deviceReports: deviceReportsFromTerminals(terminals) }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Master rejected device report (HTTP ${response.status})`);
      const receipt = await response.json() as { ok?: boolean; deploymentId?: string };
      if (!receipt.ok || receipt.deploymentId !== deploymentId) throw new Error("Master did not acknowledge the selected deployment");
    } catch (error) {
      logger.warn({ reason: error instanceof Error ? error.message : "Request failed" }, "Device sync relay unavailable; customer operation continues");
    } finally {
      active = false;
    }
  };
  void send();
  const interval = setInterval(() => void send(), 30_000);
  interval.unref();
  return () => clearInterval(interval);
}