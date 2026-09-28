import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";

/**
 * A customer installation owns a whole PostgreSQL database. Keeping the
 * existing tables unscoped is safe only when every query (including raw SQL
 * and transactions) uses the pool belonging to the current installation.
 * No request is allowed to fall back to the original database in multi mode.
 */
const tenantContext = new AsyncLocalStorage<string>();
const LEGACY_TENANT = "legacy";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

function configuredDatabases(): { urls: Record<string, string>; originalTenantId: string | null } | null {
  const raw = process.env.TENANT_DATABASES;
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || !Object.keys(parsed).length) {
    throw new Error("TENANT_DATABASES must be a nonempty object");
  }
  const result: Record<string, string> = {};
  let originalTenantId: string | null = null;
  const seen = new Set<string>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id) || typeof value !== "string") {
      throw new Error("Invalid tenant database configuration");
    }
    if (value === "$DATABASE_URL") originalTenantId = id;
    const url = value === "$DATABASE_URL" ? process.env.DATABASE_URL! : value;
    const parsedUrl = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || !parsedUrl.pathname.slice(1)) {
      throw new Error("Invalid tenant database URL");
    }
    // Different URLs for the same database must not become two tenants.
    const identity = `${parsedUrl.hostname.toLowerCase()}:${parsedUrl.port || "5432"}/${decodeURIComponent(parsedUrl.pathname)}:${decodeURIComponent(parsedUrl.username)}`;
    if (seen.has(identity)) throw new Error("Multiple tenants cannot share a database");
    seen.add(identity);
    result[id] = url;
  }
  return { urls: result, originalTenantId };
}

const configuration = configuredDatabases();
const databases = configuration?.urls ?? null;
export const isMultiTenantMode = () => Boolean(databases);
export const getTenantIds = (): string[] => databases ? Object.keys(databases) : [LEGACY_TENANT];
export const getOriginalTenantId = (): string | null =>
  databases ? configuration!.originalTenantId : LEGACY_TENANT;

export function getTenantId(): string {
  const id = tenantContext.getStore();
  if (id && (databases ? Object.hasOwn(databases, id) : id === LEGACY_TENANT)) return id;
  if (databases) throw new Error("Tenant context required for database access");
  return LEGACY_TENANT;
}

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (!getTenantIds().includes(tenantId)) throw new Error("Unknown tenant");
  return tenantContext.run(tenantId, fn);
}

const clients = new Map<string, { pool: Pool; db: ReturnType<typeof drizzle<typeof schema>> }>();
function current() {
  const id = getTenantId();
  let client = clients.get(id);
  if (!client) {
    const pool = new Pool({ connectionString: databases ? databases[id] : process.env.DATABASE_URL });
    // The workspace has separate pg type copies in the API and DB library.
    client = { pool, db: drizzle(pool as any, { schema }) };
    clients.set(id, client);
  }
  return client;
}

// Bind functions to their real instance; the proxy itself must never carry a
// query or transaction across a tenant boundary.
function scoped<T extends object>(select: () => T): T {
  return new Proxy({} as T, {
    get(_target, key) {
      const value = Reflect.get(select(), key);
      return typeof value === "function" ? value.bind(select()) : value;
    },
  });
}

export const pool: Pool = scoped(() => current().pool);
export const db: ReturnType<typeof drizzle<typeof schema>> = scoped(() => current().db);

/** Check actual connections, not just the strings supplied by an operator. */
export async function verifyTenantDatabases(): Promise<void> {
  if (!databases) return;
  // These credentials are still process-wide. Do not send one merchant's
  // payments or messages on behalf of every tenant.
  if (Object.keys(process.env).some(key => /^(JCC_|VIVA_|WORLDPAY_|WHATSAPP_)/.test(key) && process.env[key])) {
    throw new Error("Shared payment or WhatsApp credentials are not supported in multi-tenant mode");
  }
  const identities = new Set<string>();
  for (const tenantId of getTenantIds()) {
    const result = await runWithTenant(tenantId, () => pool.query<{
      database_name: string;
      address: string | null;
      port: number | null;
      users_table: string | null;
      items_table: string | null;
    }>(`SELECT current_database() AS database_name,
      inet_server_addr()::text AS address, inet_server_port() AS port,
      to_regclass('public.users')::text AS users_table,
      to_regclass('public.items')::text AS items_table`));
    const row = result.rows[0];
    if (!row?.users_table || !row.items_table) {
      throw new Error(`Tenant ${tenantId} database is not migrated; refusing to serve requests`);
    }
    const identity = `${row.address}:${row.port}/${row.database_name}`;
    if (identities.has(identity)) throw new Error("Tenant database connections resolve to the same database");
    identities.add(identity);
  }
}