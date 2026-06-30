/// Hardware integration module — scale, ESC/POS receipt printer, cash drawer.
///
/// Uses tauri_plugin_shell to communicate with serial/USB devices. All device
/// port paths are validated against a strict allowlist before any use to
/// prevent command injection. ESC/POS bytes are written via temporary files
/// and `dd` — no shell string interpolation of data or paths.
///
/// Scale:  RS-232/USB-serial (Toledo, Mettler, Digi-SM protocols).
/// Printer: USB HID (ESC/POS) — /dev/usb/lp0 or Windows USB port.
/// Drawer:  RJ-11 pulse via printer port (ESC p command).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use tauri_plugin_shell::ShellExt;

// ── Config ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HardwareConfig {
    // Scale
    pub scale_enabled:            bool,
    pub scale_port:               String,   // "/dev/ttyUSB0" | "COM3"
    pub scale_baud:               u32,      // default 9600
    pub scale_protocol:           String,   // "toledo" | "mettler" | "digi"
    // Printer
    pub printer_enabled:          bool,
    pub printer_port:             String,   // "/dev/usb/lp0" | "USB001"
    pub printer_columns:          u8,       // default 42
    pub printer_logo:             bool,
    // Cash drawer
    pub drawer_enabled:           bool,
    pub drawer_pulse_ms:          u32,      // default 200
    // Customer display
    pub customer_display_enabled: bool,
    pub customer_display_port:    String,
    // Payment provider (see also schema_meta 'payment_config' for credentials)
    pub payment_provider:         String,   // "mock" | "jcc" | "viva" | "worldpay"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleWeight {
    pub grams:  f64,
    pub kg:     f64,
    pub stable: bool,
    pub tared:  bool,
}

impl Default for ScaleWeight {
    fn default() -> Self { ScaleWeight { grams: 0.0, kg: 0.0, stable: false, tared: false } }
}

// ── Port safety guard ─────────────────────────────────────────────────────────

/// Validates a device port path against a strict allowlist.
/// Rejects any string containing shell metacharacters, whitespace, or path traversal.
/// Allowed: /dev/ttyXxx, /dev/usb/lpN, /dev/lpN, COMn, USBnnn.
fn validate_port(port: &str) -> Result<(), String> {
    if port.is_empty() { return Ok(()); }

    // Reject shell metacharacters, whitespace, quotes, and path traversal
    for ch in port.chars() {
        if ch.is_ascii_control() || " \t\n;|&`$><'\"\\*?[]{}()!".contains(ch) {
            return Err(format!("Unsafe character '{}' in device port path", ch));
        }
    }
    if port.contains("..") {
        return Err("Path traversal (..) not allowed in device port path".into());
    }

    // Must match a known device pattern
    let linux_ok   = port.starts_with("/dev/tty") || port.starts_with("/dev/usb/lp") || port.starts_with("/dev/lp");
    let windows_ok = port.starts_with("COM") || port.starts_with("USB");

    if !linux_ok && !windows_ok {
        return Err(format!(
            "Unrecognized port '{}'. Expected /dev/tty*, /dev/usb/lp*, COMn, or USBnnn.", port
        ));
    }
    Ok(())
}

// ── DB helpers ────────────────────────────────────────────────────────────────

pub async fn load_hardware_config(pool: &SqlitePool) -> HardwareConfig {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = 'hardware_config'")
        .fetch_optional(pool).await.ok().flatten();
    row.and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub async fn save_hardware_config(pool: &SqlitePool, cfg: &HardwareConfig) -> Result<(), String> {
    validate_port(&cfg.scale_port)?;
    validate_port(&cfg.printer_port)?;
    validate_port(&cfg.customer_display_port)?;

    let json = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('hardware_config', ?)")
        .bind(json)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Scale ─────────────────────────────────────────────────────────────────────

/// Read the current weight from the scale.
/// Uses separate process args — no sh -c interpolation of the port path or baud.
pub async fn scale_read(app: &tauri::AppHandle, cfg: &HardwareConfig) -> Result<ScaleWeight, String> {
    if !cfg.scale_enabled || cfg.scale_port.is_empty() {
        return Err("Scale not configured".into());
    }
    validate_port(&cfg.scale_port)?;

    let baud = cfg.scale_baud.max(300).min(115200).to_string();

    // Configure serial port: stty -F <port> <baud> raw -echo
    let _ = app.shell()
        .command("stty")
        .args(["-F", &cfg.scale_port, &baud, "raw", "-echo"])
        .output().await;

    // Read up to 20 bytes: head -c 20 <port>
    let output = app.shell()
        .command("head")
        .args(["-c", "20", &cfg.scale_port])
        .output().await
        .map_err(|e| e.to_string())?;

    let raw = String::from_utf8_lossy(&output.stdout);
    if raw.trim().is_empty() {
        return Err("No response from scale".into());
    }
    parse_scale_response(&raw, &cfg.scale_protocol)
}

/// Send tare command (T\r\n) to the scale using a temp file to avoid interpolation.
pub async fn scale_tare(app: &tauri::AppHandle, cfg: &HardwareConfig) -> Result<(), String> {
    if !cfg.scale_enabled || cfg.scale_port.is_empty() {
        return Err("Scale not configured".into());
    }
    validate_port(&cfg.scale_port)?;

    // Write T\r\n bytes to a temp file, then copy to device with dd
    let tmp = write_temp_file(b"T\r\n")?;
    let result = app.shell()
        .command("dd")
        .args(["if=".to_string() + tmp.as_str(), "of=".to_string() + &cfg.scale_port, "bs=3".to_string(), "count=1".to_string()])
        .output().await
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    result
}

// ── Printer ───────────────────────────────────────────────────────────────────

/// Print a receipt by writing ESC/POS bytes through a temp file → dd → device.
/// No shell string interpolation of either the port path or the byte data.
pub async fn print_receipt(
    app:   &tauri::AppHandle,
    cfg:   &HardwareConfig,
    lines: &[Value],
    cols:  u8,
) -> Result<(), String> {
    if !cfg.printer_enabled || cfg.printer_port.is_empty() {
        return Err("Printer not configured".into());
    }
    validate_port(&cfg.printer_port)?;

    let esc_bytes = build_escpos_bytes(lines, cols);
    let tmp = write_temp_file(&esc_bytes)?;
    let result = app.shell()
        .command("dd")
        .args(["if=".to_string() + tmp.as_str(), "of=".to_string() + &cfg.printer_port])
        .output().await
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    result
}

/// Open the cash drawer by pulsing RJ-11 via the printer port.
pub async fn open_cash_drawer(app: &tauri::AppHandle, cfg: &HardwareConfig) -> Result<(), String> {
    if !cfg.drawer_enabled || cfg.printer_port.is_empty() {
        return Err("Cash drawer not configured".into());
    }
    validate_port(&cfg.printer_port)?;

    let on_time = (cfg.drawer_pulse_ms / 2).clamp(1, 255) as u8;
    // ESC p 0 <on_time> <off_time>
    let bytes = vec![0x1B_u8, 0x70, 0x00, on_time, on_time];
    let tmp = write_temp_file(&bytes)?;
    let result = app.shell()
        .command("dd")
        .args(["if=".to_string() + tmp.as_str(), "of=".to_string() + &cfg.printer_port])
        .output().await
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    result
}

/// Check if the printer port is writable — uses `test -w` with the path as a separate arg.
pub async fn check_printer_status(app: &tauri::AppHandle, cfg: &HardwareConfig) -> bool {
    if !cfg.printer_enabled || cfg.printer_port.is_empty() { return false; }
    if validate_port(&cfg.printer_port).is_err() { return false; }
    match app.shell().command("test").args(["-w", &cfg.printer_port]).output().await {
        Ok(out) => out.status.success(),
        Err(_)  => false,
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Write bytes to a uniquely-named temp file; returns the path.
fn write_temp_file(data: &[u8]) -> Result<String, String> {
    use std::io::Write;
    let path = format!("/tmp/globipos_hw_{}.bin", uuid::Uuid::new_v4().simple());
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(data).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Build ESC/POS byte sequence from JSON line descriptors.
fn build_escpos_bytes(lines: &[Value], cols: u8) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    b.extend_from_slice(b"\x1B\x40");    // ESC @ initialize
    b.extend_from_slice(b"\x1B\x74\x00"); // CP437 code page

    for line in lines {
        let text       = line.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let align      = line.get("align").and_then(|v| v.as_str()).unwrap_or("left");
        let bold       = line.get("bold").and_then(|v| v.as_bool()).unwrap_or(false);
        let is_divider = line.get("divider").and_then(|v| v.as_bool()).unwrap_or(false);
        let big        = line.get("size").and_then(|v| v.as_str()).unwrap_or("normal") == "big";

        b.extend_from_slice(match align { "center" => b"\x1B\x61\x01", "right" => b"\x1B\x61\x02", _ => b"\x1B\x61\x00" });
        b.extend_from_slice(if bold { b"\x1B\x45\x01" } else { b"\x1B\x45\x00" });
        b.extend_from_slice(if big  { b"\x1D\x21\x11" } else { b"\x1D\x21\x00" });

        if is_divider {
            b.extend_from_slice("-".repeat(cols as usize).as_bytes());
        } else {
            // Sanitize to printable ASCII — non-printable chars become '?'
            let safe: String = text.chars()
                .map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '?' })
                .collect();
            b.extend_from_slice(safe.as_bytes());
        }
        b.push(b'\n');
    }

    b.extend_from_slice(b"\n\n\n");         // paper feed
    b.extend_from_slice(b"\x1D\x56\x41\x00"); // partial cut
    b
}

// ── Scale protocol parsers ────────────────────────────────────────────────────

fn parse_scale_response(raw: &str, protocol: &str) -> Result<ScaleWeight, String> {
    let s = raw.trim();
    if s.is_empty() || s == "ERR" { return Err("No response from scale".into()); }
    match protocol { "digi" => parse_digi(s), "mettler" => parse_mettler(s), _ => parse_toledo(s) }
}

fn parse_toledo(s: &str) -> Result<ScaleWeight, String> {
    let stable = s.contains("ST");
    let tared  = s.contains(",NT,");
    let grams: f64 = s.chars().filter(|c| c.is_ascii_digit() || *c == '.').collect::<String>()
        .parse().map_err(|_| format!("Cannot parse Toledo: {}", s))?;
    Ok(ScaleWeight { grams, kg: grams / 1000.0, stable, tared })
}

fn parse_mettler(s: &str) -> Result<ScaleWeight, String> {
    let stable = s.starts_with("S S") || s.starts_with("S D");
    let grams: f64 = s.split_whitespace()
        .find_map(|tok| tok.parse::<f64>().ok())
        .map(|v| if s.contains("kg") { v * 1000.0 } else { v })
        .ok_or_else(|| format!("Cannot parse Mettler: {}", s))?;
    Ok(ScaleWeight { grams, kg: grams / 1000.0, stable, tared: false })
}

fn parse_digi(s: &str) -> Result<ScaleWeight, String> {
    let stable = !s.contains('U');
    let grams: f64 = s.chars().filter(|c| c.is_ascii_digit()).collect::<String>()
        .parse::<f64>().map_err(|_| format!("Cannot parse Digi: {}", s))?;
    Ok(ScaleWeight { grams, kg: grams / 1000.0, stable, tared: false })
}

// ── Card provider architecture ────────────────────────────────────────────────

/// Payment result returned by all provider adapters.
#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentResult {
    pub approved:  bool,
    pub reference: String,
    pub amount:    f64,
    pub currency:  String,
    pub error:     Option<String>,
    pub provider:  String,
}

/// Payment configuration (from schema_meta 'payment_config').
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaymentConfig {
    pub provider:    String,   // "mock" | "jcc" | "viva" | "worldpay"
    pub endpoint:    String,
    pub merchant_id: String,
    pub api_key:     String,
    // JCC-specific
    pub jcc_pos_id:  Option<String>,
    pub jcc_store_id: Option<String>,
    // Viva-specific
    pub viva_source_code: Option<String>,
    pub viva_client_id:   Option<String>,
    pub viva_client_secret: Option<String>,
    // Worldpay-specific
    pub worldpay_entity: Option<String>,
}

/// Route a card payment request to the appropriate provider adapter.
/// Returns Err only for infrastructure failures (can't build HTTP client etc).
/// Gateway declines are returned as Ok(PaymentResult { approved: false, ... }).
pub async fn process_payment(
    cfg:      &PaymentConfig,
    amount:   f64,
    currency: &str,
) -> Result<PaymentResult, String> {
    match cfg.provider.as_str() {
        "jcc"      => pay_jcc(cfg, amount, currency).await,
        "viva"     => pay_viva(cfg, amount, currency).await,
        "worldpay" => pay_worldpay(cfg, amount, currency).await,
        _          => Ok(mock_approve(amount, currency)), // "mock" or unconfigured
    }
}

fn mock_approve(amount: f64, currency: &str) -> PaymentResult {
    PaymentResult {
        approved:  true,
        reference: format!("MOCK-{}", &uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
        amount,
        currency:  currency.to_uppercase(),
        error:     None,
        provider:  "mock".into(),
    }
}

// ── JCC adapter (Cyprus payment gateway) ─────────────────────────────────────
//
// JCC uses a terminal-driven TCP/REST hybrid. For software integrations the
// REST endpoint accepts a SaleRequest and long-polls until the physical terminal
// confirms. The flow is:
//   POST /api/v1/transactions/sale  →  202 Accepted + { transaction_id }
//   GET  /api/v1/transactions/{id}  (poll every 2s, up to 60s)
// Reference: JCC Smart Business Solution API v2 (2023).

async fn pay_jcc(cfg: &PaymentConfig, amount: f64, currency: &str) -> Result<PaymentResult, String> {
    if cfg.endpoint.is_empty() || cfg.merchant_id.is_empty() {
        return Err("JCC: endpoint and merchant_id are required".into());
    }

    let client = http_client(60)?;
    let pos_id   = cfg.jcc_pos_id.as_deref().unwrap_or("01");
    let store_id = cfg.jcc_store_id.as_deref().unwrap_or("01");
    let cents    = (amount * 100.0).round() as i64;

    // Step 1: initiate sale
    let sale_url = format!("{}/api/v1/transactions/sale", cfg.endpoint.trim_end_matches('/'));
    let body = serde_json::json!({
        "merchantId": cfg.merchant_id,
        "storeId":    store_id,
        "posId":      pos_id,
        "amount":     cents,
        "currency":   currency.to_uppercase(),
        "transactionType": "SALE",
    });

    let resp = client.post(&sale_url)
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .json(&body)
        .send().await
        .map_err(|e| format!("JCC initiate error: {}", e))?;

    if !resp.status().is_success() && resp.status().as_u16() != 202 {
        let err = extract_error(resp).await;
        return Ok(PaymentResult { approved: false, reference: String::new(), amount, currency: currency.into(), error: Some(err), provider: "jcc".into() });
    }

    let init_body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let txn_id = init_body.get("transactionId").or_else(|| init_body.get("transaction_id"))
        .and_then(|v| v.as_str()).unwrap_or("").to_string();

    if txn_id.is_empty() {
        return Ok(PaymentResult { approved: false, reference: String::new(), amount, currency: currency.into(), error: Some("JCC: no transactionId in response".into()), provider: "jcc".into() });
    }

    // Step 2: poll for result (up to 60s, 2s intervals)
    let status_url = format!("{}/api/v1/transactions/{}", cfg.endpoint.trim_end_matches('/'), txn_id);
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let poll = client.get(&status_url)
            .header("Authorization", format!("Bearer {}", cfg.api_key))
            .send().await;
        match poll {
            Ok(r) if r.status().is_success() => {
                let body: Value = r.json().await.unwrap_or_default();
                let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("");
                match status {
                    "APPROVED" | "00" => {
                        let reference = body.get("authCode").or_else(|| body.get("auth_code")).or_else(|| body.get("reference"))
                            .and_then(|v| v.as_str()).unwrap_or(&txn_id).to_string();
                        return Ok(PaymentResult { approved: true, reference, amount, currency: currency.into(), error: None, provider: "jcc".into() });
                    }
                    "DECLINED" | "REFUSED" => {
                        let msg = body.get("responseText").and_then(|v| v.as_str()).unwrap_or("Declined").to_string();
                        return Ok(PaymentResult { approved: false, reference: txn_id, amount, currency: currency.into(), error: Some(msg), provider: "jcc".into() });
                    }
                    "PENDING" | "IN_PROGRESS" => { /* continue polling */ }
                    _ => { /* unknown status — keep polling */ }
                }
            }
            _ => { /* network error — keep polling */ }
        }
    }

    Ok(PaymentResult { approved: false, reference: txn_id, amount, currency: currency.into(), error: Some("JCC: timeout waiting for terminal".into()), provider: "jcc".into() })
}

// ── Viva Wallet adapter ───────────────────────────────────────────────────────
//
// Viva Smart Checkout (ISV/Native) flow:
//   POST /api/orders/token  →  { orderCode }
//   Redirect/deeplink to terminal with orderCode
//   GET  /api/transactions/{orderCode}  →  completion webhook
// Reference: Viva API documentation v3.

async fn pay_viva(cfg: &PaymentConfig, amount: f64, currency: &str) -> Result<PaymentResult, String> {
    if cfg.endpoint.is_empty() || cfg.merchant_id.is_empty() {
        return Err("Viva: endpoint and merchant_id are required".into());
    }

    let client = http_client(60)?;
    let source  = cfg.viva_source_code.as_deref().unwrap_or("0000");
    let cents   = (amount * 100.0).round() as i64;

    // Step 1: create order token
    let token_url = format!("{}/api/orders/token", cfg.endpoint.trim_end_matches('/'));
    let body = serde_json::json!({
        "amount":     cents,
        "customerTrns": "POS Sale",
        "currency":   currency_code(currency),
        "sourceCode": source,
        "merchantTrns": format!("ORDER-{}", uuid::Uuid::new_v4().simple()),
    });

    let resp = client.post(&token_url)
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .json(&body)
        .send().await
        .map_err(|e| format!("Viva order error: {}", e))?;

    if !resp.status().is_success() {
        let err = extract_error(resp).await;
        return Ok(PaymentResult { approved: false, reference: String::new(), amount, currency: currency.into(), error: Some(err), provider: "viva".into() });
    }

    let order: Value = resp.json().await.map_err(|e| e.to_string())?;
    let order_code = order.get("OrderCode").or_else(|| order.get("orderCode"))
        .and_then(|v| v.as_str()).unwrap_or("").to_string();

    if order_code.is_empty() {
        return Ok(PaymentResult { approved: false, reference: String::new(), amount, currency: currency.into(), error: Some("Viva: no OrderCode in response".into()), provider: "viva".into() });
    }

    // Step 2: poll for payment completion (up to 90s for customer card interaction)
    let txn_url = format!("{}/api/transactions/{}", cfg.endpoint.trim_end_matches('/'), order_code);
    for _ in 0..45 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let poll = client.get(&txn_url)
            .header("Authorization", format!("Bearer {}", cfg.api_key))
            .send().await;
        match poll {
            Ok(r) if r.status().is_success() => {
                let body: Value = r.json().await.unwrap_or_default();
                let transactions = body.get("Transactions").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                if let Some(txn) = transactions.first() {
                    let status_id = txn.get("StatusId").and_then(|v| v.as_str()).unwrap_or("");
                    match status_id {
                        "F" | "C" => { // F=Captured, C=Completed
                            let reference = txn.get("TransactionId").and_then(|v| v.as_str()).unwrap_or(&order_code).to_string();
                            return Ok(PaymentResult { approved: true, reference, amount, currency: currency.into(), error: None, provider: "viva".into() });
                        }
                        "X" | "E" => { // X=Cancelled, E=Error
                            let msg = txn.get("Comments").and_then(|v| v.as_str()).unwrap_or("Declined").to_string();
                            return Ok(PaymentResult { approved: false, reference: order_code, amount, currency: currency.into(), error: Some(msg), provider: "viva".into() });
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    Ok(PaymentResult { approved: false, reference: order_code, amount, currency: currency.into(), error: Some("Viva: timeout waiting for card interaction".into()), provider: "viva".into() })
}

// ── Worldpay adapter ──────────────────────────────────────────────────────────
//
// Worldpay Total (REST) flow — single synchronous authorize call.
// Reference: Worldpay Total REST API v1 (2024).

async fn pay_worldpay(cfg: &PaymentConfig, amount: f64, currency: &str) -> Result<PaymentResult, String> {
    if cfg.endpoint.is_empty() || cfg.merchant_id.is_empty() {
        return Err("Worldpay: endpoint and merchant_id are required".into());
    }

    let client = http_client(30)?;
    let entity  = cfg.worldpay_entity.as_deref().unwrap_or("001");
    let cents   = (amount * 100.0).round() as i64;

    let body = serde_json::json!({
        "transactionType": "SALE",
        "merchantId":      cfg.merchant_id,
        "entityId":        entity,
        "amount":          cents,
        "currencyCode":    currency_code(currency),
        "orderId":         format!("POS-{}", uuid::Uuid::new_v4().simple()),
    });

    let resp = client.post(&cfg.endpoint)
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .json(&body)
        .send().await
        .map_err(|e| format!("Worldpay error: {}", e))?;

    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or_default();

    let approved = body.get("transactionStatus").and_then(|v| v.as_str())
        .map(|s| s == "APPROVED" || s == "00")
        .or_else(|| body.get("approved").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    let reference = body.get("gatewayOrderId")
        .or_else(|| body.get("transactionId"))
        .or_else(|| body.get("orderId"))
        .and_then(|v| v.as_str())
        .unwrap_or("N/A")
        .to_string();

    if !status.is_success() || !approved {
        let msg = body.get("message").or_else(|| body.get("description"))
            .and_then(|v| v.as_str())
            .unwrap_or("Declined").to_string();
        return Ok(PaymentResult { approved: false, reference, amount, currency: currency.into(), error: Some(msg), provider: "worldpay".into() });
    }

    Ok(PaymentResult { approved: true, reference, amount, currency: currency.into(), error: None, provider: "worldpay".into() })
}

// ── Shared helpers ────────────────────────────────────────────────────────────

fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

fn currency_code(currency: &str) -> u16 {
    // ISO 4217 numeric codes for common currencies
    match currency.to_uppercase().as_str() {
        "EUR" => 978,
        "GBP" => 826,
        "USD" => 840,
        "CZK" => 203,
        _     => 978, // default EUR
    }
}

async fn extract_error(resp: reqwest::Response) -> String {
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or_default();
    body.get("message").or_else(|| body.get("error")).or_else(|| body.get("description"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("HTTP {}", status))
}

// ── Public receipt builder ────────────────────────────────────────────────────

/// Format a sale into printable receipt lines (ESC/POS JSON structure).
pub fn build_receipt_lines(
    store_name:      &str,
    store_address:   &str,
    terminal:        &str,
    cashier:         &str,
    order_number:    &str,
    date:            &str,
    items:           &[(String, f64, f64)],
    subtotal:        f64,
    vat:             f64,
    total:           f64,
    payment_method:  &str,
    amount_tendered: f64,
    change_due:      f64,
    loyalty_points:  Option<i32>,
    footer:          &str,
    cols:            u8,
) -> Vec<Value> {
    let mut lines = Vec::<Value>::new();
    let p = |v: Value, l: &mut Vec<Value>| l.push(v);

    p(serde_json::json!({"text": store_name, "align":"center","bold":true,"size":"big"}), &mut lines);
    p(serde_json::json!({"text": store_address, "align":"center"}), &mut lines);
    p(serde_json::json!({"divider":true}), &mut lines);
    p(serde_json::json!({"text": format!("Terminal: {}  Cashier: {}", terminal, cashier)}), &mut lines);
    p(serde_json::json!({"text": format!("Order: {}  {}", order_number, date)}), &mut lines);
    p(serde_json::json!({"divider":true}), &mut lines);

    for (desc, qty, total_line) in items {
        let col_w     = cols as usize;
        let price_str = format!("{:>7.2}", total_line);
        let qty_str   = format!("{:.1}", qty);
        let max_desc  = col_w.saturating_sub(price_str.len() + qty_str.len() + 2);
        let trunc     = if desc.len() > max_desc { &desc[..max_desc] } else { desc.as_str() };
        p(serde_json::json!({"text": format!("{} x{} {}", trunc, qty_str, price_str)}), &mut lines);
    }

    p(serde_json::json!({"divider":true}), &mut lines);
    p(serde_json::json!({"text": format!("Subtotal          {:>8.2}", subtotal)}), &mut lines);
    p(serde_json::json!({"text": format!("VAT               {:>8.2}", vat)}), &mut lines);
    p(serde_json::json!({"text": format!("TOTAL             {:>8.2}", total), "bold":true,"size":"big","align":"right"}), &mut lines);
    p(serde_json::json!({"divider":true}), &mut lines);
    p(serde_json::json!({"text": format!("Payment: {}", payment_method.to_uppercase())}), &mut lines);
    if amount_tendered > 0.0 {
        p(serde_json::json!({"text": format!("Tendered          {:>8.2}", amount_tendered)}), &mut lines);
        p(serde_json::json!({"text": format!("Change            {:>8.2}", change_due)}), &mut lines);
    }
    if let Some(pts) = loyalty_points {
        p(serde_json::json!({"text": format!("Points earned: +{}", pts),"align":"center"}), &mut lines);
    }
    p(serde_json::json!({"divider":true}), &mut lines);
    p(serde_json::json!({"text": footer, "align":"center"}), &mut lines);
    p(serde_json::json!({"text": "Thank you for shopping with us!", "align":"center"}), &mut lines);

    lines
}
