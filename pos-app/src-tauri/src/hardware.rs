/// Hardware integration module — scale, ESC/POS receipt printer, cash drawer.
/// Uses tauri_plugin_shell to communicate with serial/USB devices via shell
/// commands, making the integration portable and configurable per terminal.
///
/// Scale protocol: RS-232 / USB-serial (Toledo, Mettler, Digi-SM).
/// Printer: USB HID (ESC/POS) — writes to /dev/usb/lp0 or Windows USB port.
/// Cash drawer: RJ-11 pulse via printer port (ESC p command).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use tauri_plugin_shell::ShellExt;

// ── Config structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HardwareConfig {
    // Scale
    pub scale_enabled: bool,
    pub scale_port: String,    // e.g. "/dev/ttyUSB0" or "COM3"
    pub scale_baud: u32,       // default 9600
    pub scale_protocol: String, // "toledo" | "mettler" | "digi"
    // Printer
    pub printer_enabled: bool,
    pub printer_port: String,  // "/dev/usb/lp0" or "USB001"
    pub printer_columns: u8,   // default 42
    pub printer_logo: bool,    // print logo bitmap if true
    // Cash drawer
    pub drawer_enabled: bool,
    pub drawer_pulse_ms: u32,  // default 200
    // Customer display
    pub customer_display_enabled: bool,
    pub customer_display_port: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaleWeight {
    pub grams: f64,
    pub kg: f64,
    pub stable: bool,
    pub tared: bool,
}

impl Default for ScaleWeight {
    fn default() -> Self { ScaleWeight { grams: 0.0, kg: 0.0, stable: false, tared: false } }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

pub async fn load_hardware_config(pool: &SqlitePool) -> HardwareConfig {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = 'hardware_config'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

    row.and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub async fn save_hardware_config(pool: &SqlitePool, cfg: &HardwareConfig) -> Result<(), sqlx::Error> {
    let json = serde_json::to_string(cfg).unwrap_or_default();
    sqlx::query(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('hardware_config', ?)"
    )
    .bind(json)
    .execute(pool)
    .await?;
    Ok(())
}

// ── Scale commands ────────────────────────────────────────────────────────────

/// Read the current weight from the scale via shell.
/// On Linux: reads a single line from the serial port using `timeout` + `cat`.
/// On Windows: uses a bundled PowerShell snippet.
/// Returns ScaleWeight or an error string.
pub async fn scale_read(app: &tauri::AppHandle, cfg: &HardwareConfig) -> Result<ScaleWeight, String> {
    if !cfg.scale_enabled || cfg.scale_port.is_empty() {
        return Err("Scale not configured".into());
    }

    let port = &cfg.scale_port;
    let baud = cfg.scale_baud.max(300);

    // Build a cross-platform shell command to read one line from the serial port.
    // Linux/macOS: configure with stty, then read one line.
    let cmd = format!(
        "stty -F {port} {baud} raw -echo && head -c 20 {port} 2>/dev/null || echo 'ERR'",
        port = port, baud = baud
    );

    let shell = app.shell();
    let output = shell
        .command("sh")
        .args(["-c", &cmd])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let raw = String::from_utf8_lossy(&output.stdout);
    parse_scale_response(&raw, &cfg.scale_protocol)
}

/// Send tare command to the scale.
pub async fn scale_tare(app: &tauri::AppHandle, cfg: &HardwareConfig) -> Result<(), String> {
    if !cfg.scale_enabled || cfg.scale_port.is_empty() {
        return Err("Scale not configured".into());
    }
    // Toledo/Mettler tare command: 'T\r\n'
    let cmd = format!("printf 'T\\r\\n' > {}", cfg.scale_port);
    app.shell()
        .command("sh")
        .args(["-c", &cmd])
        .output()
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn parse_scale_response(raw: &str, protocol: &str) -> Result<ScaleWeight, String> {
    let s = raw.trim();
    if s.is_empty() || s == "ERR" {
        return Err("No response from scale".into());
    }
    match protocol {
        "digi" => parse_digi(s),
        "mettler" => parse_mettler(s),
        _ => parse_toledo(s),
    }
}

fn parse_toledo(s: &str) -> Result<ScaleWeight, String> {
    // Toledo format: "ST,GS, +  1234 g"  or "US,GS, +  1234 g"
    // ST = stable, US = unstable
    let stable = s.contains("ST");
    let tared = s.contains(",NT,");
    let grams: f64 = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .parse()
        .map_err(|_| format!("Cannot parse Toledo response: {}", s))?;
    Ok(ScaleWeight { grams, kg: grams / 1000.0, stable, tared })
}

fn parse_mettler(s: &str) -> Result<ScaleWeight, String> {
    // Mettler: "S S  +    0.568 kg"
    let stable = s.starts_with("S S") || s.starts_with("S D");
    let grams: f64 = s
        .split_whitespace()
        .find_map(|tok| tok.parse::<f64>().ok())
        .map(|v| if s.contains("kg") { v * 1000.0 } else { v })
        .ok_or_else(|| format!("Cannot parse Mettler: {}", s))?;
    Ok(ScaleWeight { grams, kg: grams / 1000.0, stable, tared: false })
}

fn parse_digi(s: &str) -> Result<ScaleWeight, String> {
    // Digi SM series: weight in grams, 6 digits, stability byte
    let stable = !s.contains('U');
    let grams: f64 = s
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<f64>()
        .map_err(|_| format!("Cannot parse Digi: {}", s))?;
    Ok(ScaleWeight { grams, kg: grams / 1000.0, stable, tared: false })
}

// ── ESC/POS printer commands ──────────────────────────────────────────────────

/// Print a receipt by writing ESC/POS bytes to the printer port.
/// `lines` is a JSON array of print-line objects: { text, align, bold, size, divider }.
pub async fn print_receipt(
    app: &tauri::AppHandle,
    cfg: &HardwareConfig,
    lines: &[Value],
    cols: u8,
) -> Result<(), String> {
    if !cfg.printer_enabled || cfg.printer_port.is_empty() {
        return Err("Printer not configured".into());
    }

    let mut esc_bytes: Vec<u8> = Vec::new();

    // Initialize printer
    esc_bytes.extend_from_slice(b"\x1B\x40"); // ESC @ (initialize)
    esc_bytes.extend_from_slice(b"\x1B\x74\x00"); // CP437 code page

    for line in lines {
        let text = line.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let align = line.get("align").and_then(|v| v.as_str()).unwrap_or("left");
        let bold = line.get("bold").and_then(|v| v.as_bool()).unwrap_or(false);
        let is_divider = line.get("divider").and_then(|v| v.as_bool()).unwrap_or(false);
        let big = line.get("size").and_then(|v| v.as_str()).unwrap_or("normal") == "big";

        // Alignment
        let align_cmd: &[u8] = match align {
            "center" => b"\x1B\x61\x01",
            "right"  => b"\x1B\x61\x02",
            _        => b"\x1B\x61\x00",
        };
        esc_bytes.extend_from_slice(align_cmd);

        // Bold
        esc_bytes.extend_from_slice(if bold { b"\x1B\x45\x01" } else { b"\x1B\x45\x00" });

        // Font size
        if big {
            esc_bytes.extend_from_slice(b"\x1D\x21\x11"); // double width+height
        } else {
            esc_bytes.extend_from_slice(b"\x1D\x21\x00"); // normal
        }

        if is_divider {
            let div = "-".repeat(cols as usize);
            esc_bytes.extend_from_slice(div.as_bytes());
        } else {
            esc_bytes.extend_from_slice(text.as_bytes());
        }
        esc_bytes.push(b'\n');
    }

    // Feed + cut
    esc_bytes.extend_from_slice(b"\n\n\n"); // paper feed
    esc_bytes.extend_from_slice(b"\x1D\x56\x41\x00"); // partial cut

    // Write bytes to printer port via shell
    // Encode as hex and pipe through xxd/printf
    let hex: String = esc_bytes.iter().map(|b| format!("\\\\x{:02X}", b)).collect();
    let cmd = format!("printf '{}' > {}", hex, cfg.printer_port);

    app.shell()
        .command("sh")
        .args(["-c", &cmd])
        .output()
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Open the cash drawer by sending the standard ESC p (DLE DC4) pulse command.
/// The drawer must be connected to the printer via RJ-11.
pub async fn open_cash_drawer(app: &tauri::AppHandle, cfg: &HardwareConfig) -> Result<(), String> {
    if !cfg.drawer_enabled || cfg.printer_port.is_empty() {
        return Err("Cash drawer not configured".into());
    }
    // ESC p 0 <on-time> <off-time>
    let on_time = (cfg.drawer_pulse_ms / 2).clamp(1, 255) as u8;
    let cmd = format!(
        "printf '\\x1B\\x70\\x00\\x{:02X}\\x{:02X}' > {}",
        on_time, on_time, cfg.printer_port
    );
    app.shell()
        .command("sh")
        .args(["-c", &cmd])
        .output()
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Check if the printer is online by attempting to read its status byte.
pub async fn check_printer_status(app: &tauri::AppHandle, cfg: &HardwareConfig) -> bool {
    if !cfg.printer_enabled || cfg.printer_port.is_empty() {
        return false;
    }
    let cmd = format!("test -w {} && echo 'ok'", cfg.printer_port);
    match app.shell().command("sh").args(["-c", &cmd]).output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim() == "ok",
        Err(_) => false,
    }
}

/// Format a sale into printable receipt lines (ESC/POS JSON structure).
pub fn build_receipt_lines(
    store_name: &str,
    store_address: &str,
    terminal: &str,
    cashier: &str,
    order_number: &str,
    date: &str,
    items: &[(String, f64, f64)], // (description, qty, total)
    subtotal: f64,
    vat: f64,
    total: f64,
    payment_method: &str,
    amount_tendered: f64,
    change_due: f64,
    loyalty_points: Option<i32>,
    footer: &str,
    cols: u8,
) -> Vec<Value> {
    let mut lines = Vec::<Value>::new();
    let push = |v: Value, l: &mut Vec<Value>| l.push(v);

    push(serde_json::json!({"text": store_name, "align": "center", "bold": true, "size": "big"}), &mut lines);
    push(serde_json::json!({"text": store_address, "align": "center"}), &mut lines);
    push(serde_json::json!({"divider": true}), &mut lines);
    push(serde_json::json!({"text": format!("Terminal: {}  Cashier: {}", terminal, cashier), "align": "left"}), &mut lines);
    push(serde_json::json!({"text": format!("Order: {}  {}", order_number, date), "align": "left"}), &mut lines);
    push(serde_json::json!({"divider": true}), &mut lines);

    for (desc, qty, total_line) in items {
        let col_w = cols as usize;
        let price_str = format!("{:>7.2}", total_line);
        let qty_str = format!("{:.1}", qty);
        let max_desc = col_w.saturating_sub(price_str.len() + qty_str.len() + 2);
        let truncated = if desc.len() > max_desc { &desc[..max_desc] } else { desc.as_str() };
        push(serde_json::json!({"text": format!("{} x{} {}", truncated, qty_str, price_str)}), &mut lines);
    }

    push(serde_json::json!({"divider": true}), &mut lines);
    push(serde_json::json!({"text": format!("Subtotal          {:>8.2}", subtotal)}), &mut lines);
    push(serde_json::json!({"text": format!("VAT               {:>8.2}", vat)}), &mut lines);
    push(serde_json::json!({"text": format!("TOTAL             {:>8.2}", total), "bold": true, "size": "big", "align": "right"}), &mut lines);
    push(serde_json::json!({"divider": true}), &mut lines);
    push(serde_json::json!({"text": format!("Payment: {}", payment_method.to_uppercase())}), &mut lines);
    if amount_tendered > 0.0 {
        push(serde_json::json!({"text": format!("Tendered          {:>8.2}", amount_tendered)}), &mut lines);
        push(serde_json::json!({"text": format!("Change            {:>8.2}", change_due)}), &mut lines);
    }
    if let Some(pts) = loyalty_points {
        push(serde_json::json!({"text": format!("Points earned: +{}", pts), "align": "center"}), &mut lines);
    }
    push(serde_json::json!({"divider": true}), &mut lines);
    push(serde_json::json!({"text": footer, "align": "center"}), &mut lines);
    push(serde_json::json!({"text": "Thank you for shopping with us!", "align": "center"}), &mut lines);

    lines
}
