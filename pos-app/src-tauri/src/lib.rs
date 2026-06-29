mod auth;
mod db;
mod migrations;
mod models;
mod orders;
mod sync;

use db::row_to_json;
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

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_config(app: AppHandle, state: State<'_, AppState>) -> Result<Option<TerminalConfig>, String> {
    // Check in-memory state first
    if let Some(cfg) = state.config.lock().unwrap().clone() {
        return Ok(Some(cfg));
    }
    // Fall back to persisted store
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
        server_url:    server_url.clone(),
        terminal_code: terminal_code.clone(),
        terminal_id:   resp.terminal.id.clone(),
        terminal_name: resp.terminal.name.clone(),
        location_id:   resp.location.id.clone(),
        location_name: resp.location.name.clone(),
        price_level:   resp.terminal.price_level.unwrap_or(1),
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

    let pending: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='pending'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);
    let failed: i64 = sqlx::query("SELECT COUNT(*) as c FROM pos_outbox WHERE status='failed'")
        .fetch_one(&state.db).await.map_err(|e| e.to_string())?
        .try_get("c").unwrap_or(0);

    {
        let mut s = state.sync_status.lock().unwrap();
        s.outbox_pending = pending as i32;
        s.outbox_failed  = failed  as i32;
    }

    Ok(result)
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
    // Acquire config values without holding the lock across an await point
    let (server_url, terminal_code) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone())
    };

    // Fallback rule query runs after lock is released
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
async fn send_heartbeat(state: State<'_, AppState>) -> Result<bool, String> {
    let (server_url, terminal_code, terminal_id) = {
        let cfg = state.config.lock().unwrap();
        let c = cfg.as_ref().ok_or_else(cfg_err)?;
        (c.server_url.clone(), c.terminal_code.clone(), c.terminal_id.clone())
    };

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
        .json(&serde_json::json!({ "status": "online" }))
        .send().await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_)   => false,
    };

    state.sync_status.lock().unwrap().online = online;
    Ok(online)
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
