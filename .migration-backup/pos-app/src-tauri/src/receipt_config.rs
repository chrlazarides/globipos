/// Configurable receipt layout (header/footer text and section toggles).
///
/// Historically the receipt content was hardcoded in the POS frontend
/// (terminal code as title, fixed "Thank you" footer, all sections always
/// printed). This module makes the receipt design admin-configurable per
/// terminal, stored in `schema_meta` under `receipt_config` — the same
/// pattern as `barcode_config` and `hardware_config`.
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptConfig {
    /// Large bold centered title at the top. Empty → falls back to the terminal code.
    pub header_title: String,
    /// Extra header lines under the title (address, phone, tax ID, ...).
    pub header_lines: Vec<String>,
    /// Footer lines at the bottom (thank-you message, return policy, ...).
    pub footer_lines: Vec<String>,
    pub show_terminal: bool,
    pub show_cashier: bool,
    pub show_order_number: bool,
    pub show_datetime: bool,
    pub show_subtotal: bool,
    pub show_vat: bool,
    pub show_payment_method: bool,
    pub show_tendered_change: bool,
    pub show_card_ref: bool,
}

impl Default for ReceiptConfig {
    fn default() -> Self {
        ReceiptConfig {
            header_title: String::new(),
            header_lines: vec![],
            footer_lines: vec!["Thank you for your purchase!".into()],
            show_terminal: true,
            show_cashier: true,
            show_order_number: true,
            show_datetime: true,
            show_subtotal: true,
            show_vat: true,
            show_payment_method: true,
            show_tendered_change: true,
            show_card_ref: true,
        }
    }
}

pub async fn load_receipt_config(pool: &SqlitePool) -> ReceiptConfig {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = 'receipt_config'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    row.and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub async fn save_receipt_config(pool: &SqlitePool, cfg: &ReceiptConfig) -> Result<(), String> {
    if cfg.header_lines.len() > 10 || cfg.footer_lines.len() > 10 {
        return Err("Too many header/footer lines (max 10 each)".into());
    }
    if cfg.header_title.len() > 64 {
        return Err("Header title too long (max 64 characters)".into());
    }
    for line in cfg.header_lines.iter().chain(cfg.footer_lines.iter()) {
        if line.len() > 128 {
            return Err("Header/footer lines must be at most 128 characters".into());
        }
    }
    let json = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('receipt_config', ?)")
        .bind(json)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
