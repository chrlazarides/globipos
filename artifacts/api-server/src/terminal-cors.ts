import cors from "cors";
import type { RequestHandler } from "express";

/**
 * Convert one configured origin to its canonical HTTPS origin.
 *
 * Origins are compared as origins (not URL prefixes): paths, queries,
 * fragments, credentials, wildcard values, and non-HTTPS schemes are never
 * accepted.
 */
export function normalizeTerminalOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate.includes("*") || /[\u0000-\u001f\u007f]/.test(candidate)) {
    return null;
  }

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin === "null"
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Parse, normalize, and deduplicate the explicitly configured origins. */
export function parseTerminalOrigins(value = process.env.GLOBIPOS_TERMINAL_ORIGINS): Set<string> {
  const origins = new Set<string>();
  for (const entry of (value ?? "").split(",")) {
    const normalized = normalizeTerminalOrigin(entry);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

export function isTerminalOriginAllowed(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return false;
  const normalized = normalizeTerminalOrigin(origin);
  return normalized !== null && allowedOrigins.has(normalized);
}

/**
 * CORS for the separate GlobiPOS Terminal browser PWA.
 *
 * A missing Origin (normal same-origin browser/API traffic) is passed through
 * without adding CORS headers. Cross-origin traffic is reflected only when
 * its exact HTTPS origin appears in GLOBIPOS_TERMINAL_ORIGINS.
 */
export function createTerminalCorsMiddleware(
  configuredOrigins = parseTerminalOrigins(),
): RequestHandler {
  const middleware = cors({
    origin: (origin, callback) => {
      callback(null, isTerminalOriginAllowed(origin, configuredOrigins) ? origin : false);
    },
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Accept", "Content-Type", "X-Terminal-Code"],
    optionsSuccessStatus: 204,
  });

  return (req, res, next) => {
    // Keep caches from reusing an allowed response for a different Origin,
    // including denied cross-origin responses.
    if (req.headers.origin) res.vary("Origin");
    middleware(req, res, next);
  };
}

const TERMINAL_CORS_PATHS = new Set([
  "/api/pos/terminals/register",
  "/api/pos/sync/cashiers",
  "/api/sync/catalog",
  "/api/sync/bills",
  "/api/pos/sync/audit-logs",
]);

export function isTerminalCorsPath(path: string): boolean {
  return TERMINAL_CORS_PATHS.has(path);
}

/**
 * Preserve the API's established permissive CORS behavior everywhere except
 * the small set of endpoints used by the separately hosted Terminal PWA.
 */
export function createApiCorsMiddleware(
  configuredOrigins = parseTerminalOrigins(),
): RequestHandler {
  const terminalCors = createTerminalCorsMiddleware(configuredOrigins);
  const existingApiCors = cors();
  return (req, res, next) => {
    if (isTerminalCorsPath(req.path)) return terminalCors(req, res, next);
    return existingApiCors(req, res, next);
  };
}