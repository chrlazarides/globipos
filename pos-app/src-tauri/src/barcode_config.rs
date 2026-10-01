/// Configurable weight/price/PLU barcode structure (PC25-family scale barcodes).
///
/// Retail scales and manufacturer weight labels print EAN-13 barcodes that embed
/// a weight, a price, or nothing beyond the PLU directly inside the digits, so the
/// POS can ring up a variable-weight item without a live scale connection.
///
/// Historically the POS hardcoded the classic "digit-2 flag" scheme:
///   0 = PLU-only, 1-4 = weight (grams), 5-9 = price (cents).
/// Some manufacturers and printers do not follow that convention — e.g. Pittas
/// (and other Cyprus/Greece manufacturers) print weight-embedded PLUs under the
/// "28"/"29" prefix family, which the classic scheme would mis-classify as price.
///
/// This module makes the full prefix → meaning mapping admin-configurable so the
/// system can be adapted to whatever barcode structure a manufacturer or scale
/// vendor actually uses, without a code change.
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BarcodeRuleKind {
    #[serde(rename = "weight")]
    Weight,
    #[serde(rename = "price")]
    Price,
    #[serde(rename = "plu")]
    Plu,
}

/// One barcode-prefix rule. Prefix length may vary; the remaining digits are
/// split into a PLU segment and a value segment, followed by a single EAN-13
/// check digit. Total barcode length = prefix.len() + plu_digits + value_digits + 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BarcodeRule {
    pub id:          String,
    pub label:       String,        // e.g. "Pittas weight PLU (28xxx)"
    pub prefix:      String,        // e.g. "28" — literal leading digits to match
    pub kind:        BarcodeRuleKind,
    pub plu_digits:  u8,            // digits after the prefix used as PLU lookup code (BBBAA)
    pub value_digits: u8,           // digits after the PLU used as the embedded value (XXXXX)
    /// Divides the raw integer value to produce the real-world unit:
    ///   weight → grams / divisor = kg (divisor 1000)
    ///   price  → cents  / divisor = currency (divisor 100)
    pub value_divisor: f64,
    pub check_digit: bool,          // whether to validate an EAN-13 check digit at the end
    pub enabled:     bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BarcodeConfig {
    pub enabled: bool,
    pub rules:   Vec<BarcodeRule>,
}

impl Default for BarcodeConfig {
    fn default() -> Self {
        BarcodeConfig {
            enabled: true,
            rules: vec![
                // Scale price label: "20 CCCCC PPPPP Z" — code (5 digits) + price (5 digits,
                // minor units e.g. 00150 = £1.50) + EAN-13 check digit.
                BarcodeRule {
                    id: "price-20".into(),
                    label: "Scale price label (20xxx)".into(),
                    prefix: "20".into(),
                    kind: BarcodeRuleKind::Price,
                    plu_digits: 5,
                    value_digits: 5,
                    value_divisor: 100.0,
                    check_digit: true,
                    enabled: true,
                },
                BarcodeRule {
                    id: "weight-21-24".into(),
                    label: "Scale weight (21-24xxx)".into(),
                    prefix: "21".into(),
                    kind: BarcodeRuleKind::Weight,
                    plu_digits: 5,
                    value_digits: 5,
                    value_divisor: 1000.0,
                    check_digit: true,
                    enabled: true,
                },
                BarcodeRule {
                    id: "price-25-27".into(),
                    label: "Scale price (25-27xxx)".into(),
                    prefix: "25".into(),
                    kind: BarcodeRuleKind::Price,
                    plu_digits: 5,
                    value_digits: 5,
                    value_divisor: 100.0,
                    check_digit: true,
                    enabled: true,
                },
                // Manufacturer weight-embedded PLU (e.g. Pittas): "28 BBBAA XXXXX Z"
                BarcodeRule {
                    id: "weight-28".into(),
                    label: "Manufacturer weight PLU (28xxx)".into(),
                    prefix: "28".into(),
                    kind: BarcodeRuleKind::Weight,
                    plu_digits: 5,
                    value_digits: 5,
                    value_divisor: 1000.0,
                    check_digit: true,
                    enabled: true,
                },
                BarcodeRule {
                    id: "weight-29".into(),
                    label: "Manufacturer weight PLU (29xxx)".into(),
                    prefix: "29".into(),
                    kind: BarcodeRuleKind::Weight,
                    plu_digits: 5,
                    value_digits: 5,
                    value_divisor: 1000.0,
                    check_digit: true,
                    enabled: true,
                },
            ],
        }
    }
}

pub async fn load_barcode_config(pool: &SqlitePool) -> BarcodeConfig {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = 'barcode_config'")
        .fetch_optional(pool).await.ok().flatten();
    row.and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub async fn save_barcode_config(pool: &SqlitePool, cfg: &BarcodeConfig) -> Result<(), String> {
    for rule in &cfg.rules {
        if rule.prefix.is_empty() || !rule.prefix.chars().all(|c| c.is_ascii_digit()) {
            return Err(format!("Rule '{}': prefix must be non-empty digits", rule.label));
        }
        if rule.plu_digits == 0 || rule.value_digits == 0 {
            return Err(format!("Rule '{}': plu_digits and value_digits must be > 0", rule.label));
        }
        let total_len = rule.prefix.len() as u8 + rule.plu_digits + rule.value_digits + if rule.check_digit { 1 } else { 0 };
        if total_len != 13 {
            return Err(format!(
                "Rule '{}': total barcode length must be 13 digits (prefix {} + PLU {} + value {} + check {} = {})",
                rule.label, rule.prefix.len(), rule.plu_digits, rule.value_digits, if rule.check_digit { 1 } else { 0 }, total_len
            ));
        }
    }
    // Reject duplicate/overlapping prefixes (one barcode must map to exactly one rule)
    for i in 0..cfg.rules.len() {
        for j in (i + 1)..cfg.rules.len() {
            let a = &cfg.rules[i].prefix;
            let b = &cfg.rules[j].prefix;
            if cfg.rules[i].enabled && cfg.rules[j].enabled && (a.starts_with(b.as_str()) || b.starts_with(a.as_str())) {
                return Err(format!("Prefixes '{}' and '{}' overlap — each barcode must match exactly one rule", a, b));
            }
        }
    }

    let json = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('barcode_config', ?)")
        .bind(json)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
