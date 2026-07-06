mod auth;
mod barcode_config;
mod db;
mod hardware;
mod vfd;
mod migrations;
mod models;
mod orders;
mod sync;
#[cfg(test)]
mod tests;

use barcode_config::BarcodeConfig;
use db::row_to_json;
use hardware::{HardwareConfig, PaymentConfig, ScaleWeight};
use models::*;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// ── Shared app state ──────────────────────────────────────────────────────────

pub struct AppState {
    pub db:          SqlitePool,
    pub config:      Mutex<Option<TerminalConfig>>,
    pub session:     Mutex<Option<CashierSession>>,
    pub sync_status: Mutex<SyncStatus>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn cfg_err() -> String { "Terminal not configured".to_string() }

fn store_config(app: &AppHandle, cfg: &TerminalConfig) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    store.set("terminal_config", serde_json::to_value(cfg).map_err(|e| e.to_string())?);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_cfg_from_store(app: &AppHandle) -> Result<Option<TerminalConfig>, String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("config.json").map_err(|e| e.to_string())?;
    match store.get("terminal_config") {
        Some(v) => serde_json::from_value(v.clone()).map(Some).map_err(|e| e.to_string()),
        None    => Ok(None),
    }
}

// ── Original Tauri commands ───────────────────────────────────────────────────

#[tauri::command]
async fn get_config(app: AppHandle, state: State<'_, AppState>) -> Result<Option<TerminalConfig>, String> {
    if let Some(cfg) = state.config.lock().unwrap().clone() {
        return Ok(Some(cfg));
    }
    let cfg = load_cfg_from_store(&app)?;
    if let Some(ref c) = cfg {
        *state.config.lock().unwrap() = Some(c.clone());
    }
    Ok(cfg)
}

#[tauri::command]
async fn register_terminal(
    app:           AppHandle,
    state:         State<'_, AppState>,
    server_url:    String,
    terminal_code: String,
) -> Result<TerminalConfig, String> {
    let resp = sync::register_terminal(&state.db, &server_url, &terminal_code).await?;

    let cfg = TerminalConfig {
        server_url:        server_url.clone(),
        terminal_code:     terminal_code.clone(),
        terminal_id:       resp.terminal.id.clone(),
        terminal_name:     resp.terminal.name.clone(),
        location_id:       resp.location.id.clone(),
        location_name:     resp.location.name.clone(),
        price_level:       resp.terminal.price_level.unwrap_or(1),
        mirror_server_url: None,
        sco_mode:          None,
    };

    store_config(&app, &cfg)?;
    *state.config.lock().unwrap() = Some(cfg.clone());
    Ok(cfg)
}

#[tauri::command]
async fn validate_pin(state: State<'_, AppState>, pin: String) -> Result<Option<CashierSession>, String> {
    auth::validate_pin(&state.db, &pin)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn upsert_cashier(
    state: State<'_, AppState>,
    id: String, name: String, pin: String, role: String,
) -> Result<(), String> {
    auth::upsert_cashier(&state.db, &id, &name, &pin, &role)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_products(
    state: State<'_, AppState>,
    category_id: Option<String>,
    search: Option<String>,
) -> Result<Vec<Value>, String> {
    let rows = if let Some(q) = &search {
        let like = format!("%{}%", q);
        sqlx::query(
            r#"SELECT p.*, po.override_price as timed_price
               FROM local_products p
               LEFT JOIN price_overrides po ON po.product_id = p.server_id
                   AND (po.valid_until IS NULL OR po.valid_until > datetime('now'))
               WHERE p.active = 1 AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)
               ORDER BY p.name LIMIT 50"#
        )
        .bind(&like).bind(&like).bind(&like)
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
    } else if let Some(cat) = &category_id {
        sqlx::query(
            r#"SELECT p.*, po.override_price as timed_price
               FROM local_products p
               LEFT JOIN price_overrides po ON po.product_id = p.server_id
                   AND (po.valid_until IS NULL OR po.valid_until > datetime('now'))
               WHERE p.active = 1 AND p.category_id = ?
               ORDER BY p.name"#
        )
        .bind(cat)
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query(
            r#"SELECT p.*, po.override_price as timed_price
               FROM local_products p
               LEFT JOIN price_overrides po ON po.product_id = p.server_id
                   AND (po.valid_until IS NULL OR po.valid_until > datetime('now'))
               WHERE p.active = 1 ORDER BY p.name"#
        )
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
    };

    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn get_product_by_barcode(
    state: State<'_, AppState>,
    barcode: String,
) -> Result<Option<Value>, String> {
    let row = sqlx::query(
        r#"SELECT p.*, po.override_price as timed_price
           FROM local_products p
           LEFT JOIN price_overrides po ON po.product_id = p.server_id
               AND (po.valid_until IS NULL OR po.valid_until > datetime('now'))
           WHERE p.active = 1 AND (p.barcode = ? OR p.sku = ?)
           LIMIT 1"#
    )
    .bind(&barcode).bind(&barcode)
    .fetch_optional(&state.db)
    .await.map_err(|e| e.to_string())?;

    Ok(row.map(row_to_json))
}

#[tauri::command]
async fn get_layout(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query("SELECT * FROM local_layout ORDER BY position")
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn get_categories(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query("SELECT * FROM local_categories WHERE active = 1 ORDER BY name")
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn save_order(
    state: State<'_, AppState>,
    order: Order,
    lines: Vec<OrderLine>,
) -> Result<(), String> {
    let (terminal_id, location_id) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.terminal_id.clone(), c.location_id.clone())
    };
    orders::save_order(&state.db, &order, &lines, &terminal_id, &location_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_held_orders(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        "SELECT * FROM pos_orders WHERE status = 'held' ORDER BY created_at DESC"
    )
    .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn get_order_lines(state: State<'_, AppState>, order_id: String) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        "SELECT * FROM pos_order_lines WHERE order_id = ? ORDER BY sort_order"
    )
    .bind(&order_id)
    .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn next_order_number(state: State<'_, AppState>, prefix: String) -> Result<String, String> {
    orders::next_order_number(&state.db, &prefix)
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_catalog(state: State<'_, AppState>) -> Result<usize, String> {
    let (server_url, terminal_code) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone())
    };

    let since = sqlx::query("SELECT value FROM schema_meta WHERE key = 'last_catalog_sync'")
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    {
        let mut s = state.sync_status.lock().unwrap();
        s.syncing = true;
    }

    let result = sync::sync_catalog(&state.db, &server_url, &terminal_code, since.as_deref()).await;

    {
        let mut s = state.sync_status.lock().unwrap();
        s.syncing = false;
        s.online  = result.is_ok();
        if result.is_ok() {
            s.last_catalog_sync = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    result
}

#[tauri::command]
async fn sync_inbox(state: State<'_, AppState>) -> Result<usize, String> {
    let (server_url, terminal_code) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone())
    };

    let since = sqlx::query("SELECT value FROM schema_meta WHERE key = 'last_inbox_sync'")
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    sync::sync_inbox(&state.db, &server_url, &terminal_code, since.as_deref()).await
}

#[tauri::command]
async fn flush_outbox(state: State<'_, AppState>) -> Result<usize, String> {
    let (server_url, terminal_code) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone())
    };

    let result = sync::flush_outbox(&state.db, &server_url, &terminal_code).await?;
    update_outbox_counts(&*state).await?;
    Ok(result)
}

/// Mirror-first outbox flush.
///
/// Tries to flush pending outbox items to `mirror_url` first (a local relay server
/// for low-latency resilience). If the mirror is unreachable or returns an error,
/// falls back to the configured primary `server_url` automatically.
///
/// Items successfully synced by the mirror are marked as `synced` and will NOT be
/// retried against the primary, preventing double-delivery.
#[tauri::command]
async fn flush_outbox_mirror(
    state:      State<'_, AppState>,
    mirror_url: String,
) -> Result<usize, String> {
    let (primary_url, terminal_code) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone())
    };

    // Attempt mirror first; if it fails (network error, non-200, etc.) fall back
    // to the primary. Any items marked synced by the mirror step are excluded from
    // the fallback because flush_outbox only processes `status='pending'` rows.
    let result = match sync::flush_outbox(&state.db, &mirror_url, &terminal_code).await {
        Ok(n) => Ok(n),
        Err(_) => {
            // Mirror unreachable — use primary as fallback
            sync::flush_outbox(&state.db, &primary_url, &terminal_code).await
        }
    }?;

    update_outbox_counts(&*state).await?;
    Ok(result)
}

/// Helper: refresh the in-memory outbox_pending / outbox_failed counters.
async fn update_outbox_counts(state: &AppState) -> Result<(), String> {
    let pending: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='pending'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    let failed: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='failed'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    let mut s = state.sync_status.lock().unwrap();
    s.outbox_pending = pending as i32;
    s.outbox_failed  = failed  as i32;
    Ok(())
}

#[tauri::command]
async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let pending: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='pending'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    let failed: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='failed'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);

    let mut s = state.sync_status.lock().unwrap();
    s.outbox_pending = pending as i32;
    s.outbox_failed  = failed  as i32;
    Ok(s.clone())
}

#[tauri::command]
async fn get_fallback_rules(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query("SELECT * FROM sync_fallback_config ORDER BY rule_key")
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn update_fallback_rule(
    state: State<'_, AppState>,
    rule_key: String,
    offline_behavior: String,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE sync_fallback_config SET offline_behavior=?, updated_at=datetime('now') WHERE rule_key=?"
    )
    .bind(&offline_behavior)
    .bind(&rule_key)
    .execute(&state.db).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_customer_live(
    state: State<'_, AppState>,
    customer_id: String,
) -> Result<Option<Value>, String> {
    let (server_url, terminal_code) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone())
    };

    let fb_row = sqlx::query(
        "SELECT offline_behavior FROM sync_fallback_config WHERE rule_key='customer_lookup'"
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let fallback = fb_row
        .and_then(|r| r.try_get::<String, _>("offline_behavior").ok())
        .unwrap_or_else(|| "allow".into());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/customers/{}", server_url.trim_end_matches('/'), customer_id);

    match client.get(&url).header("X-Terminal-Code", &terminal_code).send().await {
        Ok(resp) if resp.status().is_success() => {
            let v: Value = resp.json().await.unwrap_or(Value::Null);
            Ok(Some(v))
        }
        Ok(_) => Ok(None),
        Err(_) => match fallback.as_str() {
            "block"              => Err("Customer lookup unavailable offline".into()),
            "block_with_message" => Err("Customer lookup requires server. Proceed without customer?".into()),
            _                    => Ok(None),
        },
    }
}

#[tauri::command]
async fn get_active_price_overrides(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        "SELECT * FROM price_overrides WHERE valid_until IS NULL OR valid_until > datetime('now')"
    )
    .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn get_inbox_notifications(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        r#"SELECT * FROM pos_inbox WHERE processed = 0
           AND message_type IN ('manager_message','layout_update','alert')
           ORDER BY created_at DESC LIMIT 20"#
    )
    .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn mark_inbox_processed(state: State<'_, AppState>, id: String) -> Result<(), String> {
    sqlx::query(
        "UPDATE pos_inbox SET processed=1, processed_at=datetime('now') WHERE id=?"
    )
    .bind(&id)
    .execute(&state.db).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn write_audit(
    state: State<'_, AppState>,
    cashier_id:   Option<String>,
    cashier_name: Option<String>,
    action:       String,
    entity:       Option<String>,
    entity_id:    Option<String>,
    detail:       Option<String>,
) -> Result<(), String> {
    auth::audit(
        &state.db,
        cashier_id.as_deref(),
        cashier_name.as_deref(),
        &action,
        entity.as_deref(),
        entity_id.as_deref(),
        detail.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_outbox_counts(state: State<'_, AppState>) -> Result<Value, String> {
    let pending: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='pending'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    let failed: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='failed'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    let synced: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='synced'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    Ok(serde_json::json!({ "pending": pending, "failed": failed, "synced": synced }))
}

#[tauri::command]
async fn send_heartbeat(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    let (server_url, terminal_code, terminal_id) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone(), c.terminal_id.clone())
    };

    // Refresh outbox counters so the reported queue size is current.
    let _ = update_outbox_counts(&*state).await;
    let (outbox_pending, outbox_failed) = {
        let s = state.sync_status.lock().unwrap();
        (s.outbox_pending, s.outbox_failed)
    };

    // Cashier / shift context.
    let cashier_name = {
        let s = state.session.lock().unwrap();
        s.as_ref().map(|c| c.cashier_name.clone())
    };
    let shift_open: bool = sqlx::query("SELECT COUNT(*) as c FROM pos_shifts WHERE status = 'open'")
        .fetch_one(&state.db).await
        .ok()
        .and_then(|r| r.try_get::<i64, _>("c").ok())
        .map(|c| c > 0)
        .unwrap_or(false);

    // Load hardware + payment config and build the peripheral health snapshot.
    let hw_cfg = hardware::load_hardware_config(&state.db).await;
    let payment_cfg: PaymentConfig = sqlx::query("SELECT value FROM schema_meta WHERE key = 'payment_config'")
        .fetch_optional(&state.db).await.ok().flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let peripheral_status = hardware::build_peripheral_status(
        &app, &hw_cfg, &payment_cfg, cashier_name, shift_open,
    ).await;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{}/api/pos/terminals/{}/heartbeat",
        server_url.trim_end_matches('/'),
        terminal_id
    );

    let online = match client
        .post(&url)
        .header("X-Terminal-Code", &terminal_code)
        .json(&serde_json::json!({
            "status": "online",
            "outboxQueueSize": (outbox_pending + outbox_failed),
            "peripheralStatus": peripheral_status,
        }))
        .send().await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_)   => false,
    };

    state.sync_status.lock().unwrap().online = online;

    Ok(serde_json::json!({
        "online": online,
        "peripheral_status": peripheral_status,
    }))
}

// ── Phase 3: Shift management ─────────────────────────────────────────────────

#[tauri::command]
async fn open_shift(
    state:        State<'_, AppState>,
    cashier_id:   String,
    cashier_name: String,
    opening_float: f64,
) -> Result<Value, String> {
    let shift_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO pos_shifts
           (id, cashier_id, cashier_name, opening_float, status, opened_at)
           VALUES (?, ?, ?, ?, 'open', datetime('now'))"#
    )
    .bind(&shift_id)
    .bind(&cashier_id)
    .bind(&cashier_name)
    .bind(opening_float)
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT * FROM pos_shifts WHERE id = ?")
        .bind(&shift_id)
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?;
    Ok(row_to_json(row))
}

#[tauri::command]
async fn get_current_shift(state: State<'_, AppState>) -> Result<Option<Value>, String> {
    let row = sqlx::query(
        "SELECT * FROM pos_shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1"
    )
    .fetch_optional(&state.db).await.map_err(|e| e.to_string())?;
    Ok(row.map(row_to_json))
}

#[tauri::command]
async fn record_shift_event(
    state:      State<'_, AppState>,
    shift_id:   String,
    event_type: String,
    amount:     f64,
    note:       Option<String>,
) -> Result<(), String> {
    let event_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO shift_events (id, shift_id, event_type, amount, note) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&event_id)
    .bind(&shift_id)
    .bind(&event_type)
    .bind(amount)
    .bind(note.as_deref())
    .execute(&state.db).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn update_shift_totals(
    state:          State<'_, AppState>,
    shift_id:       String,
    total:          f64,
    payment_method: String,
) -> Result<(), String> {
    let is_cash = payment_method.to_lowercase().contains("cash");
    if is_cash {
        sqlx::query(
            r#"UPDATE pos_shifts SET
               total_cash_sales = total_cash_sales + ?,
               total_sales = total_sales + ?,
               order_count = order_count + 1
               WHERE id = ?"#
        )
        .bind(total).bind(total).bind(&shift_id)
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    } else {
        sqlx::query(
            r#"UPDATE pos_shifts SET
               total_card_sales = total_card_sales + ?,
               total_sales = total_sales + ?,
               order_count = order_count + 1
               WHERE id = ?"#
        )
        .bind(total).bind(total).bind(&shift_id)
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_shift_summary(
    state:    State<'_, AppState>,
    shift_id: String,
) -> Result<Value, String> {
    let shift_row = sqlx::query("SELECT * FROM pos_shifts WHERE id = ?")
        .bind(&shift_id)
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?
        .ok_or("Shift not found")?;

    let events: Vec<Value> = sqlx::query("SELECT * FROM shift_events WHERE shift_id = ? ORDER BY created_at")
        .bind(&shift_id)
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
        .into_iter().map(row_to_json).collect();

    let shift = row_to_json(shift_row);

    // Compute expected cash
    let opening_float = shift.get("opening_float").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let cash_sales = shift.get("total_cash_sales").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let total_sales = shift.get("total_sales").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let card_sales = shift.get("total_card_sales").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let order_count = shift.get("order_count").and_then(|v| v.as_i64()).unwrap_or(0);

    let cash_in: f64 = events.iter()
        .filter(|e| e.get("event_type").and_then(|v| v.as_str()) == Some("cash_in"))
        .filter_map(|e| e.get("amount").and_then(|v| v.as_f64()))
        .sum();
    let cash_out: f64 = events.iter()
        .filter(|e| e.get("event_type").and_then(|v| v.as_str()) == Some("cash_out"))
        .filter_map(|e| e.get("amount").and_then(|v| v.as_f64()))
        .sum();

    let expected_cash = opening_float + cash_sales + cash_in - cash_out;
    let avg_basket = if order_count > 0 { total_sales / order_count as f64 } else { 0.0 };
    let top_payment = if cash_sales >= card_sales { "cash" } else { "card" };

    Ok(serde_json::json!({
        "shift": shift,
        "events": events,
        "expected_cash": expected_cash,
        "transaction_count": order_count,
        "avg_basket": avg_basket,
        "top_payment": top_payment,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    }))
}

#[tauri::command]
async fn close_shift(
    state:        State<'_, AppState>,
    shift_id:     String,
    closing_cash: f64,   // -1 = blind close
    notes:        Option<String>,
) -> Result<Value, String> {
    let summary = get_shift_summary(state.clone(), shift_id.clone()).await?;

    let expected_cash = summary.get("expected_cash").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let effective_closing = if closing_cash < 0.0 { expected_cash } else { closing_cash };
    let variance = effective_closing - expected_cash;

    sqlx::query(
        r#"UPDATE pos_shifts SET
           status = 'closed',
           closed_at = datetime('now'),
           closing_cash = ?,
           notes = ?
           WHERE id = ?"#
    )
    .bind(effective_closing)
    .bind(notes.as_deref())
    .bind(&shift_id)
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    // Queue Z-report for server sync
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "type": "shift_close",
        "shift_id": shift_id,
        "closing_cash": effective_closing,
        "variance": variance,
    });
    sqlx::query(
        "INSERT INTO pos_outbox (id, order_id, payload, status) VALUES (?, ?, ?, 'pending')"
    )
    .bind(&outbox_id)
    .bind(&shift_id)
    .bind(payload.to_string())
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "shift": summary.get("shift"),
        "events": summary.get("events"),
        "expected_cash": expected_cash,
        "closing_cash": effective_closing,
        "variance": variance,
        "is_balanced": variance.abs() < 0.50,
        "transaction_count": summary.get("transaction_count"),
        "avg_basket": summary.get("avg_basket"),
        "top_payment": summary.get("top_payment"),
        "generated_at": chrono::Utc::now().to_rfc3339(),
    }))
}

// ── Phase 3: Promotions ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_promotions(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        r#"SELECT * FROM local_promotions
           WHERE active = 1
             AND (valid_until IS NULL OR valid_until > datetime('now'))
           ORDER BY priority DESC, name"#
    )
    .fetch_all(&state.db).await.map_err(|e| e.to_string())?;

    let result: Vec<Value> = rows.into_iter().map(|row| {
        let mut v = row_to_json(row);
        // Parse JSON arrays from TEXT columns
        if let Some(obj) = v.as_object_mut() {
            for key in &["product_ids", "category_ids"] {
                if let Some(raw) = obj.get(*key).and_then(|x| x.as_str()) {
                    if let Ok(arr) = serde_json::from_str::<Value>(raw) {
                        obj.insert(key.to_string(), arr);
                    }
                }
            }
        }
        v
    }).collect();

    Ok(result)
}

#[tauri::command]
async fn validate_coupon(
    state: State<'_, AppState>,
    code:  String,
) -> Result<Value, String> {
    // First check local SQLite cache
    let row = sqlx::query(
        r#"SELECT * FROM local_promotions
           WHERE type = 'coupon'
             AND active = 1
             AND lower(coupon_code) = lower(?)
             AND (valid_until IS NULL OR valid_until > datetime('now'))
           LIMIT 1"#
    )
    .bind(&code)
    .fetch_optional(&state.db).await.map_err(|e| e.to_string())?;

    if let Some(r) = row {
        return Ok(serde_json::json!({ "valid": true, "promo": row_to_json(r), "message": "Coupon applied" }));
    }

    // Fall back to server if terminal is configured and online
    let (srv, tc) = {
        let cfg = state.config.lock().unwrap();
        match cfg.as_ref() {
            Some(c) => (c.server_url.clone(), c.terminal_code.clone()),
            None    => return Ok(serde_json::json!({ "valid": false, "message": "Offline — coupon not found" })),
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/pos/validate-coupon", srv.trim_end_matches('/'));
    match client
        .post(&url)
        .header("X-Terminal-Code", &tc)
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            resp.json::<Value>().await.map_err(|e| e.to_string())
        }
        _ => Ok(serde_json::json!({ "valid": false, "message": "Invalid or expired coupon" })),
    }
}

// ── Phase 3: Container deposits & produce ─────────────────────────────────────

#[tauri::command]
async fn get_container_deposits(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query("SELECT * FROM local_container_deposits WHERE active = 1")
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

#[tauri::command]
async fn get_produce_items(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query(
        r#"SELECT * FROM local_products
           WHERE active = 1 AND (weight_based = 1 OR plu_code IS NOT NULL)
           ORDER BY name"#
    )
    .fetch_all(&state.db).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(row_to_json).collect())
}

// ── Phase 3: Returns ──────────────────────────────────────────────────────────

#[tauri::command]
async fn get_order_by_number(
    state:        State<'_, AppState>,
    order_number: String,
) -> Result<Option<Value>, String> {
    let order_row = sqlx::query(
        "SELECT * FROM pos_orders WHERE order_number = ? LIMIT 1"
    )
    .bind(&order_number)
    .fetch_optional(&state.db).await.map_err(|e| e.to_string())?;

    if let Some(row) = order_row {
        let order = row_to_json(row);
        let order_id = order.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let lines: Vec<Value> = sqlx::query(
            "SELECT * FROM pos_order_lines WHERE order_id = ? ORDER BY sort_order"
        )
        .bind(&order_id)
        .fetch_all(&state.db).await.map_err(|e| e.to_string())?
        .into_iter().map(row_to_json).collect();

        let mut result = order;
        result.as_object_mut().unwrap().insert("lines".to_string(), serde_json::json!(lines));
        Ok(Some(result))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn save_return_order(
    state:        State<'_, AppState>,
    return_order: Value,
    lines:        Vec<Value>,
) -> Result<(), String> {
    let id = return_order.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();

    sqlx::query(
        r#"INSERT INTO pos_return_orders
           (id, original_order_id, original_order_number, cashier_id, cashier_name,
            refund_method, refund_total, notes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#
    )
    .bind(&id)
    .bind(return_order.get("original_order_id").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(return_order.get("original_order_number").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(return_order.get("cashier_id").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(return_order.get("cashier_name").and_then(|v| v.as_str()).unwrap_or(""))
    .bind(return_order.get("refund_method").and_then(|v| v.as_str()).unwrap_or("cash"))
    .bind(return_order.get("refund_total").and_then(|v| v.as_f64()).unwrap_or(0.0))
    .bind(return_order.get("notes").and_then(|v| v.as_str()))
    .bind(return_order.get("status").and_then(|v| v.as_str()).unwrap_or("completed"))
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    for line in &lines {
        let line_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO pos_return_order_lines
               (id, return_order_id, original_order_id, original_line_id, product_id,
                description, qty, unit_price, line_total, restocked)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#
        )
        .bind(&line_id)
        .bind(&id)
        .bind(line.get("original_order_id").and_then(|v| v.as_str()).unwrap_or(""))
        .bind(line.get("original_line_id").and_then(|v| v.as_str()).unwrap_or(""))
        .bind(line.get("product_id").and_then(|v| v.as_str()))
        .bind(line.get("description").and_then(|v| v.as_str()).unwrap_or(""))
        .bind(line.get("qty").and_then(|v| v.as_f64()).unwrap_or(0.0))
        .bind(line.get("unit_price").and_then(|v| v.as_f64()).unwrap_or(0.0))
        .bind(line.get("line_total").and_then(|v| v.as_f64()).unwrap_or(0.0))
        .bind(line.get("restocked").and_then(|v| v.as_bool()).unwrap_or(true))
        .execute(&state.db).await.map_err(|e| e.to_string())?;
    }

    // Queue for server sync
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({ "type": "return_order", "return_order": return_order, "lines": lines });
    sqlx::query(
        "INSERT INTO pos_outbox (id, order_id, payload, status) VALUES (?, ?, ?, 'pending')"
    )
    .bind(&outbox_id)
    .bind(&id)
    .bind(payload.to_string())
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    Ok(())
}

// ── Credit notes (store credit) ───────────────────────────────────────────────

#[tauri::command]
async fn issue_credit_note(
    state:       State<'_, AppState>,
    order_id:    Option<String>,
    order_number: Option<String>,
    customer_id: Option<String>,
    amount:      f64,
    reason:      Option<String>,
    cashier_id:  String,
    cashier_name: String,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    // Short human-readable redemption code, e.g. CN-A1B2C3
    let code = format!("CN-{}", &id.to_uppercase().replace('-', "")[0..6]);

    sqlx::query(
        r#"INSERT INTO pos_credit_notes
           (id, code, order_id, order_number, customer_id, amount, remaining, reason, cashier_id, cashier_name, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')"#
    )
    .bind(&id)
    .bind(&code)
    .bind(&order_id)
    .bind(&order_number)
    .bind(&customer_id)
    .bind(amount)
    .bind(amount)
    .bind(&reason)
    .bind(&cashier_id)
    .bind(&cashier_name)
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT * FROM pos_credit_notes WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?;
    let note_json = row_to_json(row);

    // Queue for server sync
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({ "type": "credit_note_issued", "credit_note": note_json.clone() });
    sqlx::query("INSERT INTO pos_outbox (id, order_id, payload, status) VALUES (?, ?, ?, 'pending')")
        .bind(&outbox_id)
        .bind(&id)
        .bind(payload.to_string())
        .execute(&state.db).await.map_err(|e| e.to_string())?;

    Ok(note_json)
}

#[tauri::command]
async fn find_credit_note(
    state: State<'_, AppState>,
    code:  String,
) -> Result<Option<Value>, String> {
    let row = sqlx::query("SELECT * FROM pos_credit_notes WHERE code = ? COLLATE NOCASE")
        .bind(code.trim())
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?;
    Ok(row.map(row_to_json))
}

#[tauri::command]
async fn redeem_credit_note(
    state:  State<'_, AppState>,
    id:     String,
    amount: f64,
) -> Result<Value, String> {
    let row = sqlx::query("SELECT * FROM pos_credit_notes WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?
        .ok_or_else(|| "Credit note not found".to_string())?;

    let existing = row_to_json(row);
    let remaining = existing.get("remaining").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let status = existing.get("status").and_then(|v| v.as_str()).unwrap_or("open");

    if status != "open" {
        return Err("Credit note is not open for redemption".to_string());
    }
    if amount <= 0.0 || amount > remaining + 0.001 {
        return Err("Redemption amount exceeds remaining balance".to_string());
    }

    let new_remaining = (remaining - amount).max(0.0);
    let new_status = if new_remaining <= 0.001 { "redeemed" } else { "open" };

    sqlx::query(
        "UPDATE pos_credit_notes SET remaining = ?, status = ?, redeemed_at = CASE WHEN ? = 'redeemed' THEN datetime('now') ELSE redeemed_at END WHERE id = ?"
    )
    .bind(new_remaining)
    .bind(new_status)
    .bind(new_status)
    .bind(&id)
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    let updated = sqlx::query("SELECT * FROM pos_credit_notes WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?;

    Ok(row_to_json(updated))
}

// ── Gift vouchers ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn issue_gift_voucher(
    state:        State<'_, AppState>,
    amount:       f64,
    cashier_id:   String,
    cashier_name: String,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    // Short human-readable redemption code, e.g. GV-A1B2C3
    let code = format!("GV-{}", &id.to_uppercase().replace('-', "")[0..6]);

    sqlx::query(
        r#"INSERT INTO pos_gift_vouchers
           (id, code, amount, remaining, cashier_id, cashier_name, status)
           VALUES (?, ?, ?, ?, ?, ?, 'open')"#
    )
    .bind(&id)
    .bind(&code)
    .bind(amount)
    .bind(amount)
    .bind(&cashier_id)
    .bind(&cashier_name)
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT * FROM pos_gift_vouchers WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?;
    let voucher_json = row_to_json(row);

    // Queue for server sync
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({ "type": "gift_voucher_issued", "gift_voucher": voucher_json.clone() });
    sqlx::query("INSERT INTO pos_outbox (id, order_id, payload, status) VALUES (?, ?, ?, 'pending')")
        .bind(&outbox_id)
        .bind(&id)
        .bind(payload.to_string())
        .execute(&state.db).await.map_err(|e| e.to_string())?;

    Ok(voucher_json)
}

#[tauri::command]
async fn find_gift_voucher(
    state: State<'_, AppState>,
    code:  String,
) -> Result<Option<Value>, String> {
    let row = sqlx::query("SELECT * FROM pos_gift_vouchers WHERE code = ? COLLATE NOCASE")
        .bind(code.trim())
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?;
    Ok(row.map(row_to_json))
}

#[tauri::command]
async fn redeem_gift_voucher(
    state:  State<'_, AppState>,
    id:     String,
    amount: f64,
) -> Result<Value, String> {
    let row = sqlx::query("SELECT * FROM pos_gift_vouchers WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?
        .ok_or_else(|| "Gift voucher not found".to_string())?;

    let existing = row_to_json(row);
    let remaining = existing.get("remaining").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let status = existing.get("status").and_then(|v| v.as_str()).unwrap_or("open");

    if status != "open" {
        return Err("Gift voucher is not open for redemption".to_string());
    }
    if amount <= 0.0 || amount > remaining + 0.001 {
        return Err("Redemption amount exceeds remaining balance".to_string());
    }

    let new_remaining = (remaining - amount).max(0.0);
    let new_status = if new_remaining <= 0.001 { "redeemed" } else { "open" };

    sqlx::query(
        "UPDATE pos_gift_vouchers SET remaining = ?, status = ?, redeemed_at = CASE WHEN ? = 'redeemed' THEN datetime('now') ELSE redeemed_at END WHERE id = ?"
    )
    .bind(new_remaining)
    .bind(new_status)
    .bind(new_status)
    .bind(&id)
    .execute(&state.db).await.map_err(|e| e.to_string())?;

    let updated = sqlx::query("SELECT * FROM pos_gift_vouchers WHERE id = ?")
        .bind(&id)
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?;

    Ok(row_to_json(updated))
}

// ── Phase 3: Hardware commands ────────────────────────────────────────────────

#[tauri::command]
async fn get_hardware_config(state: State<'_, AppState>) -> Result<HardwareConfig, String> {
    Ok(hardware::load_hardware_config(&state.db).await)
}

#[tauri::command]
async fn save_hardware_config(
    state:  State<'_, AppState>,
    config: HardwareConfig,
) -> Result<(), String> {
    hardware::save_hardware_config(&state.db, &config).await
}

// ── Barcode structure configuration (weight/price/PLU scale barcodes) ─────────

#[tauri::command]
async fn get_barcode_config(state: State<'_, AppState>) -> Result<BarcodeConfig, String> {
    Ok(barcode_config::load_barcode_config(&state.db).await)
}

#[tauri::command]
async fn save_barcode_config(
    state:  State<'_, AppState>,
    config: BarcodeConfig,
) -> Result<(), String> {
    barcode_config::save_barcode_config(&state.db, &config).await
}

#[tauri::command]
async fn scale_read_weight(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> Result<ScaleWeight, String> {
    let cfg = hardware::load_hardware_config(&state.db).await;
    hardware::scale_read(&app, &cfg).await
}

#[tauri::command]
async fn scale_tare(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cfg = hardware::load_hardware_config(&state.db).await;
    hardware::scale_tare(&app, &cfg).await
}

#[tauri::command]
async fn print_receipt(
    app:   AppHandle,
    state: State<'_, AppState>,
    lines: Vec<Value>,
) -> Result<(), String> {
    let cfg = hardware::load_hardware_config(&state.db).await;
    let cols = cfg.printer_columns.max(32);
    hardware::print_receipt(&app, &cfg, &lines, cols).await
}

#[tauri::command]
async fn open_cash_drawer(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cfg = hardware::load_hardware_config(&state.db).await;
    hardware::open_cash_drawer(&app, &cfg).await
}

#[tauri::command]
async fn check_printer_status(
    app:   AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let cfg = hardware::load_hardware_config(&state.db).await;
    Ok(hardware::check_printer_status(&app, &cfg).await)
}

/// Card payment — routes to JCC, Viva, Worldpay, or mock based on 'payment_config'
/// stored in schema_meta. Returns { approved, reference, amount, currency, error? }.
///
/// `auto_confirm=true` forces mock approval regardless of provider (used in demo/test mode).
/// On any infrastructure failure the command returns Ok with approved=false (fail-closed).
#[tauri::command]
async fn process_card_payment(
    state:        State<'_, AppState>,
    amount:       f64,
    currency:     String,
    auto_confirm: Option<bool>,
) -> Result<Value, String> {
    // Load payment config from schema_meta; default to mock if absent
    let cfg_row = sqlx::query("SELECT value FROM schema_meta WHERE key = 'payment_config'")
        .fetch_optional(&state.db).await.map_err(|e| e.to_string())?;

    let payment_cfg: PaymentConfig = cfg_row
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    // Forced mock approval (demo / test terminals)
    if payment_cfg.provider == "mock" || auto_confirm == Some(true) {
        let result = hardware::PaymentResult {
            approved:  true,
            reference: format!("MOCK-{}", &uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
            amount,
            currency:  currency.clone(),
            error:     None,
            provider:  "mock".into(),
        };
        return Ok(serde_json::to_value(&result).unwrap_or_default());
    }

    // Route to provider adapter — infrastructure failures are fail-closed (approved=false)
    let result = hardware::process_payment(&payment_cfg, amount, &currency).await
        .unwrap_or_else(|e| hardware::PaymentResult {
            approved:  false,
            reference: String::new(),
            amount,
            currency:  currency.clone(),
            error:     Some(e),
            provider:  payment_cfg.provider.clone(),
        });

    Ok(serde_json::to_value(&result).unwrap_or_default())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let pool: SqlitePool = tauri::async_runtime::block_on(async {
                let db_url = "sqlite:globipos.db";
                let pool = SqlitePool::connect(db_url).await?;
                migrations::run_migrations(&pool).await?;
                Ok::<SqlitePool, sqlx::Error>(pool)
            })
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            app.manage(AppState {
                db: pool,
                config: Mutex::new(None),
                session: Mutex::new(None),
                sync_status: Mutex::new(SyncStatus {
                    online: false,
                    syncing: false,
                    last_catalog_sync: None,
                    last_inbox_sync: None,
                    outbox_pending: 0,
                    outbox_failed: 0,
                }),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── Phase 1 & 2 commands ─────────────────────────────────────────
            get_config,
            register_terminal,
            validate_pin,
            upsert_cashier,
            get_products,
            get_product_by_barcode,
            get_layout,
            get_categories,
            save_order,
            get_held_orders,
            get_order_lines,
            next_order_number,
            sync_catalog,
            sync_inbox,
            flush_outbox,
            flush_outbox_mirror,
            get_sync_status,
            get_fallback_rules,
            update_fallback_rule,
            get_customer_live,
            get_active_price_overrides,
            get_inbox_notifications,
            mark_inbox_processed,
            write_audit,
            get_outbox_counts,
            send_heartbeat,
            // ── Phase 3: Shift management ────────────────────────────────────
            open_shift,
            get_current_shift,
            record_shift_event,
            update_shift_totals,
            get_shift_summary,
            close_shift,
            // ── Phase 3: Promotions ──────────────────────────────────────────
            get_promotions,
            validate_coupon,
            // ── Phase 3: Produce & deposits ──────────────────────────────────
            get_produce_items,
            get_container_deposits,
            // ── Phase 3: Returns ─────────────────────────────────────────────
            get_order_by_number,
            save_return_order,
            // ── Credit notes ─────────────────────────────────────────────────
            issue_credit_note,
            find_credit_note,
            redeem_credit_note,
            // ── Gift vouchers ────────────────────────────────────────────────
            issue_gift_voucher,
            find_gift_voucher,
            redeem_gift_voucher,
            // ── Phase 3: Hardware ────────────────────────────────────────────
            get_hardware_config,
            save_hardware_config,
            get_barcode_config,
            save_barcode_config,
            scale_read_weight,
            scale_tare,
            print_receipt,
            open_cash_drawer,
            check_printer_status,
            process_card_payment,
            // ── VFD ──────────────────────────────────────────────────────────
            vfd::vfd_write,
            vfd::vfd_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
