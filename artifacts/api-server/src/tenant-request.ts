import type { Request, Response, NextFunction } from "express";
import { getTenantIds, isMultiTenantMode, runWithTenant } from "./db";

/**
 * Normalize a Host header into the canonical host key used by TENANT_HOSTS.
 * Forwarded host headers are deliberately ignored; Express may otherwise trust
 * them when `trust proxy` is enabled.
 */
export function canonicalRequestHost(rawHost: string | string[] | undefined): string | null {
  if (typeof rawHost !== "string" || !rawHost || /[\s/@?#\\]/.test(rawHost)) return null;

  let host = rawHost;
  if (host.startsWith("[")) {
    const match = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(host);
    if (!match) return null;
    if (match[2] && Number(match[2]) > 65535) return null;
    return `[${match[1].toLowerCase()}]`;
  }

  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(host);
  if (!match) return null;
  host = match[1].replace(/\.$/, "").toLowerCase();
  if (match[2] && Number(match[2]) > 65535) return null;
  if (host.length > 253 || !host) return null;

  // Accept ordinary DNS names (including localhost) and IPv4 addresses only.
  const looksLikeIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  const ipv4 = looksLikeIpv4
    && host.split(".").every(part => Number(part) <= 255);
  const dns = host.split(".").every(label =>
    label.length > 0 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
  return (ipv4 || (dns && !looksLikeIpv4)) ? host : null;
}

function configuredHosts(): Map<string, string> {
  if (!isMultiTenantMode()) return new Map();
  if (!process.env.TENANT_HOSTS) throw new Error("TENANT_HOSTS is required in multi-tenant mode");
  const parsed: unknown = JSON.parse(process.env.TENANT_HOSTS);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid TENANT_HOSTS");
  const result = new Map<string, string>();
  const present = new Set<string>();
  for (const [rawHost, tenantId] of Object.entries(parsed)) {
    const host = canonicalRequestHost(rawHost);
    if (!host || typeof tenantId !== "string" || !getTenantIds().includes(tenantId) || result.has(host)) {
      throw new Error("Invalid or duplicate tenant host mapping");
    }
    result.set(host, tenantId);
    present.add(tenantId);
  }
  if (getTenantIds().some(id => !present.has(id))) throw new Error("Every tenant database needs a hostname");
  return result;
}

const hosts = configuredHosts();

export function bindTenantRequest(req: Request, res: Response, next: NextFunction) {
  if (!isMultiTenantMode()) return next();
  // Infrastructure health checks contain no customer data and may use an
  // internal hostname that cannot be registered as a customer domain.
  if (req.path === "/api/healthz") return next();
  const host = canonicalRequestHost(req.headers.host);
  const tenantId = host ? hosts.get(host) : null;
  if (!tenantId || !getTenantIds().includes(tenantId)) {
    return res.status(403).json({ message: "Unknown tenant host" });
  }
  return runWithTenant(tenantId, () => next());
}