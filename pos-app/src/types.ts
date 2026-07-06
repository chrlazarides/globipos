// ── Product & Catalog ─────────────────────────────────────────────────────────

export interface Product {
  id: string;
  server_id: string;
  name: string;
  sku: string;
  barcode?: string;
  description?: string;
  category_id?: string;
  price1: number;
  price2: number;
  price3: number;
  price4: number;
  price5: number;
  cost_price: number;
  vat_rate: number;
  unit_type: string;
  pack_size: number;
  stock_quantity: number;
  active: boolean;
  updated_at?: string;
  timed_price?: number | null; // from price_overrides join
}

export interface Category {
  id: string;
  server_id: string;
  name: string;
  description?: string;
  parent_id?: string;
  vat_rate: number;
  active: boolean;
}

// ── Layout ────────────────────────────────────────────────────────────────────

export type ButtonType = "item" | "category" | "action" | "empty" | "sublayout";

export interface LayoutButton {
  position: number;
  label: string;
  color: string;
  icon?: string;
  button_type: ButtonType;
  item_id?: string;
  category_id?: string;
  action_code?: string;
  sublayout_id?: string;   // panel this button lives in (null = root); for type=sublayout, also the panel it opens
  colspan?: number;        // 1–4, default 1
  rowspan?: number;        // 1–4, default 1
}

// ── Order Engine ──────────────────────────────────────────────────────────────

export interface OrderLine {
  id: string;
  order_id: string;
  product_id?: string;
  description: string;
  sku?: string;
  qty: number;
  unit_price: number;
  override_price?: number;
  line_discount_pct: number;    // % discount on this line
  line_discount_fixed: number;  // fixed € discount on this line
  line_surcharge_pct: number;   // "Pagomena" — per-item surcharge/cover charge % added to this line's price
  vat_rate: number;
  line_total: number;           // after all discounts, excl VAT
  vat_amount: number;
  note?: string;
  voided: boolean;
}

export interface Order {
  id: string;
  order_number: string;
  status: "active" | "held" | "completed" | "voided";
  customer_id?: string;
  cashier_id: string;
  cashier_name: string;
  price_level: number;          // 1-5
  order_discount_pct: number;   // % discount applied to order
  order_discount_fixed: number; // fixed € discount applied to order
  surcharge_pct: number;        // % additional charge/surcharge applied to order (e.g. cover/service charge)
  surcharge_amount: number;     // computed € value of the surcharge
  subtotal: number;             // sum of line totals before order discount
  discount_amount: number;      // total discount (line + order)
  vat_amount: number;
  total: number;
  note?: string;
  payment_method?: string;
  amount_tendered?: number;
  change_due?: number;
  payment_ref?: string;          // gateway auth code / transaction reference
  created_at: string;
}

// ── Computed line amounts ─────────────────────────────────────────────────────

export interface LineAmounts {
  effectiveUnitPrice: number;   // after override_price / price level
  lineSubtotal: number;         // effectiveUnitPrice × qty
  lineDiscount: number;         // fixed + % applied
  lineNet: number;              // lineSubtotal - lineDiscount
  vatAmount: number;
  lineTotal: number;            // lineNet + vatAmount
}

// ── Cashier / Session ─────────────────────────────────────────────────────────

export interface CashierSession {
  cashier_id: string;
  cashier_name: string;
  role: "cashier" | "supervisor" | "manager";
  pin_hash: string;
  permissions: string[];
}

// ── Terminal Config ───────────────────────────────────────────────────────────

export interface TerminalConfig {
  server_url: string;
  terminal_code: string;
  terminal_id: string;
  terminal_name: string;
  location_id: string;
  location_name: string;
  price_level: number;
  /** Optional local mirror server. Outbox is routed here first; primary is the fallback. */
  mirror_server_url?: string;
  /** If true, terminal boots directly into self-checkout mode (no cashier UI). */
  sco_mode?: boolean;
}

// ── Sync ──────────────────────────────────────────────────────────────────────

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  last_catalog_sync?: string;
  last_inbox_sync?: string;
  outbox_pending: number;
  outbox_failed: number;
}

// ── Peripheral / heartbeat health ────────────────────────────────────────────
// Mirrors the PeripheralStatus shape read by the back-office dashboard
// (client/src/pages/pos-terminals.tsx) — keep field names/values in sync.
export interface PeripheralHealth {
  printer?: "online" | "offline" | "error";
  drawer?: "ok" | "error";
  scale?: "connected" | "disconnected" | "error";
  card_terminal?: "connected" | "disconnected" | "error";
  customer_display?: "ok" | "error";
  cashier_name?: string;
  shift_open?: boolean;
  app_version?: string;
  reported_at?: string;
}

export interface FallbackRule {
  rule_key: string;
  label: string;
  offline_behavior: "allow" | "block" | "block_with_message";
  description?: string;
}

// ── Barcode structure configuration (weight/price/PLU scale barcodes) ─────────

export type BarcodeRuleKind = "weight" | "price" | "plu";

export interface BarcodeRule {
  id: string;
  label: string;
  prefix: string;
  kind: BarcodeRuleKind;
  plu_digits: number;
  value_digits: number;
  value_divisor: number;
  check_digit: boolean;
  enabled: boolean;
}

export interface BarcodeConfig {
  enabled: boolean;
  rules: BarcodeRule[];
}

// ── Numpad context ────────────────────────────────────────────────────────────

export type NumpadMode =
  | "qty"
  | "price_override"
  | "line_discount_pct"
  | "line_discount_fixed"
  | "order_discount_pct"
  | "order_discount_fixed"
  | "amount_tendered"
  | "price_check"
  | "qty_multiplier"
  | "surcharge_pct"
  | "line_surcharge_pct"
  | "cash_in"
  | "cash_out"
  | "petty_cash"
  | "dept_sale";

// ── Action codes ──────────────────────────────────────────────────────────────

export type ActionCode =
  | "CLEAR_ORDER"
  | "VOID_ORDER"
  | "HOLD_ORDER"
  | "RECALL_ORDER"
  | "ADD_NOTE"
  | "ADD_LINE_NOTE"
  | "REPEAT_LAST"
  | "PRICE_CHECK"
  | "LINE_DISCOUNT_PCT"
  | "LINE_DISCOUNT_FIXED"
  | "ORDER_DISCOUNT_PCT"
  | "ORDER_DISCOUNT_FIXED"
  | "PRICE_OVERRIDE"
  | "PRICE_LEVEL_1"
  | "PRICE_LEVEL_2"
  | "PRICE_LEVEL_3"
  | "PRICE_LEVEL_4"
  | "PRICE_LEVEL_5"
  | "REMOVE_DISCOUNT"
  | "TAX_OVERRIDE"
  | "PROMO_CODE"
  | "MANUAL_PROMO"
  | "PAY_CASH"
  | "PAY_CARD"
  | "OPEN_DRAWER"
  | "END_SHIFT"
  | "FALLBACK_RULES"
  | "BARCODE_CONFIG"
  | "NUMPAD"
  | "NO_SALE"
  | "CASH_IN"
  | "CASH_OUT"
  | "PETTY_CASH"
  | "DECLARE_CASH"
  | "SURCHARGE_PCT"
  | "LINE_SURCHARGE_PCT"
  | "DEPT_SALE"
  | "ISSUE_CREDIT_NOTE"
  | "REDEEM_CREDIT_NOTE"
  | "CORRECTION"
  | "REPRINT_LAST"
  | "ISSUE_VOUCHER"
  | "TOGGLE_LANGUAGE";

// ── Credit notes ──────────────────────────────────────────────────────────────

export interface CreditNote {
  id: string;
  code: string;
  order_id?: string;
  order_number?: string;
  customer_id?: string;
  amount: number;
  remaining: number;
  reason?: string;
  cashier_id: string;
  cashier_name: string;
  status: "open" | "redeemed" | "void";
  created_at: string;
  redeemed_at?: string;
}

// ── Gift vouchers ──────────────────────────────────────────────────────────────

export interface GiftVoucher {
  id: string;
  code: string;
  amount: number;
  remaining: number;
  cashier_id: string;
  cashier_name: string;
  status: "open" | "redeemed" | "void";
  created_at: string;
  redeemed_at?: string;
}
