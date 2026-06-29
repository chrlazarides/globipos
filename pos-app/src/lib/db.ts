/**
 * Thin wrapper around Tauri invoke() for SQLite operations.
 * All DB queries are handled Rust-side; this file just calls the right command.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Product,
  Category,
  LayoutButton,
  Order,
  OrderLine,
  FallbackRule,
  TerminalConfig,
  SyncStatus,
} from "../types";

// ── Config ────────────────────────────────────────────────────────────────────

export const getConfig = (): Promise<TerminalConfig | null> =>
  invoke<TerminalConfig | null>("get_config");

export const registerTerminal = (
  serverUrl: string,
  terminalCode: string
): Promise<TerminalConfig> =>
  invoke<TerminalConfig>("register_terminal", {
    serverUrl,
    terminalCode,
  });

// ── Products ──────────────────────────────────────────────────────────────────

export const getProducts = (
  categoryId?: string,
  search?: string
): Promise<Product[]> =>
  invoke<Product[]>("get_products", { categoryId, search });

export const getProductByBarcode = (
  barcode: string
): Promise<Product | null> =>
  invoke<Product | null>("get_product_by_barcode", { barcode });

export const getActiveProductsCount = async (): Promise<number> => {
  const all = await getProducts();
  return all.length;
};

// ── Categories ────────────────────────────────────────────────────────────────

export const getCategories = (): Promise<Category[]> =>
  invoke<Category[]>("get_categories");

// ── Layout ────────────────────────────────────────────────────────────────────

export const getLayout = (): Promise<LayoutButton[]> =>
  invoke<LayoutButton[]>("get_layout");

// ── Orders ────────────────────────────────────────────────────────────────────

export const saveOrder = (
  order: Order,
  lines: OrderLine[]
): Promise<void> =>
  invoke<void>("save_order", { order, lines });

export const getHeldOrders = (): Promise<Order[]> =>
  invoke<Order[]>("get_held_orders");

export const getOrderLines = (orderId: string): Promise<OrderLine[]> =>
  invoke<OrderLine[]>("get_order_lines", { orderId });

export const nextOrderNumber = (prefix: string): Promise<string> =>
  invoke<string>("next_order_number", { prefix });

// ── Sync ──────────────────────────────────────────────────────────────────────

export const syncCatalog = (): Promise<number> =>
  invoke<number>("sync_catalog");

export const syncInbox = (): Promise<number> =>
  invoke<number>("sync_inbox");

export const flushOutbox = (): Promise<number> =>
  invoke<number>("flush_outbox");

export const getSyncStatus = (): Promise<SyncStatus> =>
  invoke<SyncStatus>("get_sync_status");

export const sendHeartbeat = (): Promise<boolean> =>
  invoke<boolean>("send_heartbeat");

// ── Fallback rules ────────────────────────────────────────────────────────────

export const getFallbackRules = (): Promise<FallbackRule[]> =>
  invoke<FallbackRule[]>("get_fallback_rules");

export const updateFallbackRule = (
  ruleKey: string,
  offlineBehavior: string
): Promise<void> =>
  invoke<void>("update_fallback_rule", { ruleKey, offlineBehavior });

// ── Customers ─────────────────────────────────────────────────────────────────

export const getCustomerLive = (
  customerId: string
): Promise<Record<string, unknown> | null> =>
  invoke<Record<string, unknown> | null>("get_customer_live", { customerId });

// ── Price overrides ───────────────────────────────────────────────────────────

export const getActivePriceOverrides = (): Promise<
  Array<{ product_id: string; override_price: number; valid_until?: string }>
> => invoke("get_active_price_overrides");

// ── Inbox notifications ───────────────────────────────────────────────────────

export const getInboxNotifications = (): Promise<
  Array<{ id: string; message_type: string; payload: string }>
> => invoke("get_inbox_notifications");

export const markInboxProcessed = (id: string): Promise<void> =>
  invoke<void>("mark_inbox_processed", { id });

// ── Audit ─────────────────────────────────────────────────────────────────────

export const writeAudit = (
  action: string,
  entity?: string,
  entityId?: string,
  detail?: string,
  cashierId?: string,
  cashierName?: string
): Promise<void> =>
  invoke<void>("write_audit", {
    cashierId,
    cashierName,
    action,
    entity,
    entityId,
    detail,
  });

// ── Auth ──────────────────────────────────────────────────────────────────────

export const validatePin = (pin: string) =>
  invoke<{ cashier_id: string; cashier_name: string; role: string; permissions: string[] } | null>(
    "validate_pin",
    { pin }
  );

export const upsertCashier = (
  id: string,
  name: string,
  pin: string,
  role: string
): Promise<void> => invoke<void>("upsert_cashier", { id, name, pin, role });

// ── Outbox counts ─────────────────────────────────────────────────────────────

export const getOutboxCounts = (): Promise<{
  pending: number;
  failed: number;
  synced: number;
}> => invoke("get_outbox_counts");
