import net from "node:net";
import { isPublicAddress } from "./domain-readiness";

const ZONE = "globipos.shop";
const API = `https://api.godaddy.com/v3/domains/zones/${ZONE}/dns-records`;
export type RequestedDns = { hostname: string; address: string; txtName: string; txtValue: string };
export type DnsPlan = { records: Array<{ type: "A" | "TXT"; name: string; data: string; action: "create" | "already_present" }> };

export class DnsSetupError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function relativeName(full: string, hostname: string, isTxt: boolean): string {
  const normalized = full.trim().toLowerCase().replace(/\.$/, "");
  if (normalized !== hostname && !(isTxt && normalized.endsWith(`.${hostname}`))) {
    throw new DnsSetupError("DNS record name must be the selected customer hostname or a name below it.", 400);
  }
  const relative = normalized.slice(0, -(ZONE.length + 1));
  if (!relative || !relative.split(".").every(label => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label))) {
    throw new DnsSetupError("Invalid DNS record name.", 400);
  }
  return relative;
}

function requestedRecords(input: RequestedDns) {
  if (!/^[a-z0-9-]+\.globipos\.shop$/.test(input.hostname)) throw new DnsSetupError("Only a customer subdomain of globipos.shop can be configured.", 400);
  if (net.isIP(input.address) !== 4 || !isPublicAddress(input.address)) throw new DnsSetupError("Enter the public IPv4 address shown by Replit.", 400);
  if (!input.txtValue || input.txtValue.length > 1024 || /[\r\n]/.test(input.txtValue)) throw new DnsSetupError("Enter the exact TXT value shown by Replit.", 400);
  return [
    { type: "A" as const, name: relativeName(input.hostname, input.hostname, false), data: input.address },
    { type: "TXT" as const, name: relativeName(input.txtName, input.hostname, true), data: input.txtValue },
  ];
}

type DnsRecord = { type: string; name: string; data: string };
type Fetcher = typeof fetch;

async function callDns(token: string, url: string, fetcher: Fetcher, method = "GET", body?: object) {
  let response: Response;
  try {
    response = await fetcher(url, {
      method, signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new DnsSetupError("Could not reach GoDaddy. Check its status and try again.", 502);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new DnsSetupError("GoDaddy denied DNS access. Check the token, its scopes and account permissions.", 502);
    throw new DnsSetupError(`GoDaddy DNS request failed (HTTP ${response.status}). No existing records were changed.`, 502);
  }
  return response;
}

async function existingRecords(name: string, token: string, fetcher: Fetcher): Promise<DnsRecord[]> {
  const response = await callDns(token, `${API}?name=${encodeURIComponent(name)}`, fetcher);
  let data: { items?: DnsRecord[]; links?: Array<{ rel?: string }> };
  try { data = await response.json() as typeof data; }
  catch { throw new DnsSetupError("GoDaddy returned an invalid DNS response.", 502); }
  if (!Array.isArray(data.items) || data.links?.some(link => link.rel === "next")) {
    throw new DnsSetupError("Could not verify all existing DNS records. No record was created.", 502);
  }
  return data.items.filter(item => item.name?.toLowerCase().replace(/\.$/, "") === name);
}

export async function planDns(input: RequestedDns, token: string, fetcher: Fetcher = fetch): Promise<DnsPlan> {
  const requested = requestedRecords(input);
  const records = await Promise.all(requested.map(async record => {
    const existing = await existingRecords(record.name, token, fetcher);
    if (existing.some(item => item.type === "CNAME" || (item.type === record.type && item.data !== record.data))) {
      throw new DnsSetupError(`An existing DNS record at ${record.name}.${ZONE} differs from Replit's ${record.type} value. Review it in GoDaddy; nothing will be overwritten.`);
    }
    return { ...record, action: existing.some(item => item.type === record.type) ? "already_present" as const : "create" as const };
  }));
  return { records };
}

export async function applyDns(input: RequestedDns, token: string, fetcher: Fetcher = fetch): Promise<DnsPlan> {
  // Re-read the zone at apply time. GoDaddy POST does not offer a conditional write.
  const plan = await planDns(input, token, fetcher);
  for (const record of plan.records.filter(record => record.action === "create")) {
    try {
      await callDns(token, API, fetcher, "POST", { type: record.type, name: record.name, data: record.data, ttl: 600 });
    } catch (error) {
      // A timed-out POST may still have succeeded. Do not blindly retry it.
      throw new DnsSetupError(`Could not confirm creation of ${record.type} at ${record.name}.${ZONE}. Check GoDaddy before retrying. ${error instanceof Error ? error.message : ""}`, 502);
    }
  }
  return plan;
}