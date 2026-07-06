use serde::{Deserialize, Serialize};
use tauri::{AppHandle, command};
use tauri_plugin_shell::ShellExt;
use crate::hardware::{HardwareConfig, write_temp_file, validate_port};

#[command]
pub async fn vfd_write(app: AppHandle, line1: String, line2: String, cfg: HardwareConfig) -> Result<(), String> {
    if !cfg.vfd_enabled || cfg.vfd_port.is_empty() {
        return Err("VFD not configured".into());
    }
    validate_port(&cfg.vfd_port)?;

    let baud = cfg.vfd_baud.max(300).min(115200).to_string();

    // Configure serial port: stty -F <port> <baud> raw -echo
    let _ = app.shell()
        .command("stty")
        .args(["-F", &cfg.vfd_port, &baud, "raw", "-echo"])
        .output().await;

    // ESC @ (initialize) + Line1 (clipped to 20) + \r\n + Line2 (clipped to 20)
    let mut data = Vec::new();
    data.extend_from_slice(b"\x1B\x40"); // ESC @ initialize
    
    let l1 = format!("{:20}", line1.chars().take(20).collect::<String>());
    let l2 = format!("{:20}", line2.chars().take(20).collect::<String>());
    
    data.extend_from_slice(l1.as_bytes());
    data.extend_from_slice(b"\r\n");
    data.extend_from_slice(l2.as_bytes());

    let tmp = write_temp_file(&data)?;
    let result = app.shell()
        .command("dd")
        .args(["if=".to_string() + tmp.as_str(), "of=".to_string() + &cfg.vfd_port])
        .output().await
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    result
}

#[command]
pub async fn vfd_clear(app: AppHandle, cfg: HardwareConfig) -> Result<(), String> {
    if !cfg.vfd_enabled || cfg.vfd_port.is_empty() {
        return Err("VFD not configured".into());
    }
    validate_port(&cfg.vfd_port)?;

    // ESC @ initialize clears the display on most protocols
    let data = b"\x1B\x40";
    let tmp = write_temp_file(data)?;
    let result = app.shell()
        .command("dd")
        .args(["if=".to_string() + tmp.as_str(), "of=".to_string() + &cfg.vfd_port])
        .output().await
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&tmp);
    result
}
