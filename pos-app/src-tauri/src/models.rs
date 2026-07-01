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
    pub description: String,
    pub sku: Option<String>,
    pub qty: f64,
    pub unit_price: f64,
    pub override_price: Option<f64>,
    pub line_discount_pct: f64,
    pub line_discount_fixed: f64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashierSeed {
    pub id: String,
    pub name: String,
    pub pin: String,  // plaintext; hashed locally by the terminal
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
