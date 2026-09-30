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
  timed_price?: number | null;
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
  sublayout_id?: string;
  colspan?: number;
  rowspan?: number;
}

export interface OrderLine {
  id: string;
  order_id: string;
  product_id?: string;
  description: string;
  sku?: string;
  qty: number;
  unit_price: number;
  override_price?: number;
  line_discount_pct: number;
  line_discount_fixed: number;
  line_surcharge_pct: number;
  vat_rate: number;
  line_total: number;
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
  price_level: number;
  order_discount_pct: number;
  order_discount_fixed: number;
  surcharge_pct: number;
  surcharge_amount: number;
  subtotal: number;
  discount_amount: number;
  vat_amount: number;
  total: number;
  note?: string;
  payment_method?: string;
  amount_tendered?: number;
  change_due?: number;
  payment_ref?: string;
  created_at: string;
}

export interface CashierSession {
  cashier_id: string;
  cashier_name: string;
  role: "cashier" | "supervisor" | "manager";
  pin_hash: string;
  permissions: string[];
}

export interface TerminalConfig {
  server_url: string;
  terminal_code: string;
  /** Secret created in Back Office for this device; never sent to catalog or layout sync. */
  voucher_device_key?: string;
  terminal_id: string;
  terminal_name: string;
  location_id: string;
  location_name: string;
  price_level: number;
  initial_sync_complete?: boolean;
}

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  last_catalog_sync?: string;
  outbox_pending: number;
  outbox_failed: number;
}
