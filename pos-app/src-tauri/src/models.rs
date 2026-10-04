use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    pub server_url: String,
    pub terminal_code: String,
    pub terminal_id: String,
    pub terminal_name: String,
    pub location_id: String,
    pub location_name: String,
    pub price_level: i32,
    /// Optional local mirror server. Outbox is routed here first; primary is fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mirror_server_url: Option<String>,
    /// If true, terminal boots directly into self-checkout mode (no cashier UI).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sco_mode: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalProduct {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub sku: String,
    pub barcode: Option<String>,
    pub description: Option<String>,
    pub category_id: Option<String>,
    pub price1: f64,
    pub price2: f64,
    pub price3: f64,
    pub price4: f64,
    pub price5: f64,
    pub cost_price: f64,
    pub vat_rate: f64,
    pub unit_type: String,
    pub pack_size: i32,
    pub stock_quantity: i32,
    pub active: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCategory {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub vat_rate: f64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalLayoutButton {
    pub position: i32,
    pub label: String,
    pub color: String,
    pub icon: Option<String>,
    pub button_type: String, // item | category | action | empty
    pub item_id: Option<String>,
    pub category_id: Option<String>,
    pub action_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderLine {
    pub id: String,
    pub order_id: String,
    pub product_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    pub description: String,
    pub sku: Option<String>,
    pub qty: f64,
    pub unit_price: f64,
    #[serde(default)]
    pub price_includes_vat: bool,
    pub override_price: Option<f64>,
    pub line_discount_pct: f64,
    pub line_discount_fixed: f64,
    #[serde(default)]
    pub line_surcharge_pct: f64,
    pub vat_rate: f64,
    pub line_total: f64,
    pub vat_amount: f64,
    pub note: Option<String>,
    pub voided: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub order_number: String,
    pub status: String, // active | held | completed | voided
    pub customer_id: Option<String>,
    pub cashier_id: String,
    pub cashier_name: String,
    pub price_level: i32,
    pub order_discount_pct: f64,
    pub order_discount_fixed: f64,
    #[serde(default)]
    pub surcharge_pct: f64,
    pub subtotal: f64,
    pub discount_amount: f64,
    pub vat_amount: f64,
    pub total: f64,
    pub note: Option<String>,
    pub payment_method: Option<String>,
    pub amount_tendered: Option<f64>,
    pub change_due: Option<f64>,
    pub payment_ref: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxItem {
    pub id: String,
    pub order_id: String,
    pub payload: String,
    pub status: String, // pending | syncing | synced | failed
    pub attempts: i32,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub message_type: String,
    pub payload: String,
    pub processed: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceOverride {
    pub product_id: String,
    pub override_price: f64,
    pub valid_until: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FallbackRule {
    pub id: String,
    pub rule_key: String,
    pub label: String,
    pub offline_behavior: String, // allow | block | block_with_message
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashierSession {
    pub cashier_id: String,
    pub cashier_name: String,
    pub role: String, // cashier | supervisor | manager
    pub pin_hash: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub online: bool,
    pub syncing: bool,
    pub last_catalog_sync: Option<String>,
    pub last_inbox_sync: Option<String>,
    pub outbox_pending: i32,
    pub outbox_failed: i32,
}

/// Persisted, per-run synchronization observability. Counts describe work
/// confirmed in the current run, never stock quantities or lifetime totals.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTelemetry {
    pub schema_version: i32,
    pub platform: String,
    pub build_version: String,
    pub device_id: String,
    #[serde(default)]
    #[serde(rename = "sequence")]
    pub report_sequence: i64,
    pub run_id: Option<String>,
    pub phase: String,
    pub syncing: bool,
    pub online: bool,
    pub server_reachable: Option<bool>,
    pub last_attempt_at: Option<String>,
    pub started_at: Option<String>,
    pub progress_at: Option<String>,
    pub last_server_contact_at: Option<String>,
    pub last_catalog_sync_at: Option<String>,
    pub last_transaction_sync_at: Option<String>,
    pub last_success_at: Option<String>,
    pub catalog_received: i64,
    pub catalog_committed: i64,
    pub catalog_pages: i64,
    pub transactions_confirmed: i64,
    pub audits_confirmed: i64,
    pub outbox_pending: i64,
    pub outbox_failed: i64,
    pub audit_pending: i64,
    pub audit_failed: i64,
    pub error: Option<String>,
    pub retry_at: Option<String>,
    // Native-only visibility for the existing inbox, which is not part of
    // transaction or stock-movement counts in the shared telemetry contract.
    pub inbox_pending: i64,
    pub inbox_received: i64,
}

impl Default for SyncTelemetry {
    fn default() -> Self {
        Self {
            schema_version: 1,
            platform: "native".to_string(),
            build_version: env!("CARGO_PKG_VERSION").to_string(),
            device_id: String::new(),
            report_sequence: 0,
            run_id: None,
            phase: "idle".to_string(),
            syncing: false,
            online: false,
            server_reachable: None,
            last_attempt_at: None,
            started_at: None,
            progress_at: None,
            last_server_contact_at: None,
            last_catalog_sync_at: None,
            last_transaction_sync_at: None,
            last_success_at: None,
            catalog_received: 0,
            catalog_committed: 0,
            catalog_pages: 0,
            transactions_confirmed: 0,
            audits_confirmed: 0,
            outbox_pending: 0,
            outbox_failed: 0,
            audit_pending: 0,
            audit_failed: 0,
            error: None,
            retry_at: None,
            inbox_pending: 0,
            inbox_received: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashierSeed {
    pub id: String,
    pub name: String,
    #[serde(rename = "pinHash")]
    pub pin_hash: String,  // SHA-256 hex hash; stored directly, no re-hashing
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResponse {
    pub terminal: RegisteredTerminal,
    pub location: RegisteredLocation,
    pub layout_buttons: Vec<LayoutButtonRaw>,
    pub inbox_items: Vec<serde_json::Value>,
    pub catalog: CatalogData,
    pub sync_config: Vec<serde_json::Value>,
    #[serde(default)]
    pub cashiers: Vec<CashierSeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredTerminal {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "locationId")]
    pub location_id: String,
    #[serde(rename = "priceLevel")]
    pub price_level: Option<i32>,
    #[serde(rename = "layoutSetId")]
    pub layout_set_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredLocation {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutButtonRaw {
    pub position: i32,
    pub label: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "buttonType")]
    pub button_type: Option<String>,
    #[serde(rename = "itemId")]
    pub item_id: Option<String>,
    #[serde(rename = "categoryId")]
    pub category_id: Option<String>,
    #[serde(rename = "actionCode")]
    pub action_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogData {
    pub items: Vec<serde_json::Value>,
    pub categories: Vec<serde_json::Value>,
    pub seasonal_offers: Option<Vec<serde_json::Value>>,
}
