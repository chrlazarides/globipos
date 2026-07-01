use crate::db;
use crate::models::RegisterResponse;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::time::Duration;

// ── Terminal registration ─────────────────────────────────────────────────────

pub async fn register_terminal(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
) -> Result<RegisterResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/pos/terminals/register", server_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "terminalCode": terminal_code }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Server error {}: {}", status, body));
    }

    let data: RegisterResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Seed catalog
    for item in &data.catalog.items {
        db::upsert_product(pool, item)
            .await
            .map_err(|e| e.to_string())?;
    }
    for cat in &data.catalog.categories {
        db::upsert_category(pool, cat)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Seed layout
    let btns: Vec<Value> = data
        .layout_buttons
        .iter()
        .map(|b| serde_json::to_value(b).unwrap_or(Value::Null))
        .collect();
    db::replace_layout(pool, &btns)
        .await
        .map_err(|e| e.to_string())?;

    // Seed cashiers synced from server (server sends SHA-256 hash, stored directly)
    for c in &data.cashiers {
        crate::auth::upsert_cashier_with_hash(pool, &c.id, &c.name, &c.pin_hash, &c.role)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Log
    sqlx::query(
        "INSERT INTO sync_log (sync_type, status, message, items_synced) VALUES ('register','ok','Initial registration',?)"
    )
    .bind(data.catalog.items.len() as i32)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(data)
}

// ── Catalog sync (delta) ─────────────────────────────────────────────────────

pub async fn sync_catalog(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
    since: Option<&str>,
) -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let base = format!("{}/api/sync/catalog", server_url.trim_end_matches('/'));
    let url = if let Some(s) = since { format!("{}?since={}", base, s) } else { base };

    let resp = client
        .get(&url)
        .header("X-Terminal-Code", terminal_code)
        .send()
        .await
        .map_err(|e| format!("Catalog sync error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Catalog sync server error: {}", resp.status()));
    }

    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let items = data["items"].as_array().cloned().unwrap_or_default();
    let cats  = data["categories"].as_array().cloned().unwrap_or_default();
    let total = items.len() + cats.len();

    for item in &items { db::upsert_product(pool, item).await.map_err(|e| e.to_string())?; }
    for cat  in &cats  { db::upsert_category(pool, cat).await.map_err(|e| e.to_string())?; }

    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('last_catalog_sync', datetime('now'))")
        .execute(pool).await.map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO sync_log (sync_type, status, message, items_synced) VALUES ('catalog','ok',?,?)")
        .bind(format!("Delta since {:?}", since))
        .bind(total as i32)
        .execute(pool).await.map_err(|e| e.to_string())?;

    Ok(total)
}

// ── Inbox sync ────────────────────────────────────────────────────────────────

pub async fn sync_inbox(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
    since: Option<&str>,
) -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let base = format!("{}/api/sync/inbox", server_url.trim_end_matches('/'));
    let url = if let Some(s) = since { format!("{}?since={}", base, s) } else { base };

    let resp = client
        .get(&url)
        .header("X-Terminal-Code", terminal_code)
        .send()
        .await
        .map_err(|e| format!("Inbox sync error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Inbox server error: {}", resp.status()));
    }

    let data: Value = resp.json().await.map_err(|e| e.to_string())?;
    let items = data["items"].as_array().cloned().unwrap_or_default();

    for item in &items {
        let server_id    = item["id"].as_str().unwrap_or("").to_string();
        let message_type = item["messageType"].as_str().unwrap_or("unknown").to_string();
        let payload      = serde_json::to_string(item).unwrap_or_default();
        let local_id     = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT OR IGNORE INTO pos_inbox (id, server_id, message_type, payload, processed) VALUES (?,?,?,?,0)"
        )
        .bind(&local_id)
        .bind(&server_id)
        .bind(&message_type)
        .bind(&payload)
        .execute(pool).await.map_err(|e| e.to_string())?;

        // Auto-process price_change messages
        if message_type == "price_change" {
            if let Some(product_id) = item["productId"].as_str() {
                let price = item["price"].as_f64()
                    .or_else(|| item["price"].as_str().and_then(|s| s.parse().ok()))
                    .unwrap_or(0.0);
                let valid_until = item["validUntil"].as_str().unwrap_or("").to_string();

                sqlx::query(
                    "INSERT OR REPLACE INTO price_overrides (product_id, override_price, valid_until, reason) VALUES (?,?,?,'inbox')"
                )
                .bind(product_id)
                .bind(price)
                .bind(valid_until)
                .execute(pool).await.map_err(|e| e.to_string())?;

                sqlx::query(
                    "UPDATE pos_inbox SET processed = 1, processed_at = datetime('now') WHERE id = ?"
                )
                .bind(&local_id)
                .execute(pool).await.map_err(|e| e.to_string())?;
            }
        }
    }

    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('last_inbox_sync', datetime('now'))")
        .execute(pool).await.map_err(|e| e.to_string())?;

    Ok(items.len())
}

// ── Outbox flush ──────────────────────────────────────────────────────────────

pub async fn flush_outbox(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
) -> Result<usize, String> {
    let rows = sqlx::query(
        r#"SELECT id, order_id, payload, attempts FROM pos_outbox
           WHERE status = 'pending'
             AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
           ORDER BY created_at ASC LIMIT 20"#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() { return Ok(0); }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/sync/bills", server_url.trim_end_matches('/'));
    let mut synced = 0;

    for row in &rows {
        let outbox_id: String  = row.try_get("id").unwrap_or_default();
        let payload_str: String = row.try_get("payload").unwrap_or_default();
        let attempts: i32       = row.try_get("attempts").unwrap_or(0);

        let payload: Value = serde_json::from_str(&payload_str).unwrap_or(Value::Null);

        sqlx::query("UPDATE pos_outbox SET status = 'syncing' WHERE id = ?")
            .bind(&outbox_id)
            .execute(pool).await.map_err(|e| e.to_string())?;

        match client.post(&url)
            .header("X-Terminal-Code", terminal_code)
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                sqlx::query(
                    "UPDATE pos_outbox SET status = 'synced', synced_at = datetime('now') WHERE id = ?"
                )
                .bind(&outbox_id)
                .execute(pool).await.map_err(|e| e.to_string())?;
                synced += 1;
            }
            Ok(resp) => {
                schedule_retry(pool, &outbox_id, attempts, &format!("HTTP {}", resp.status())).await?;
            }
            Err(e) => {
                schedule_retry(pool, &outbox_id, attempts, &e.to_string()).await?;
            }
        }
    }

    Ok(synced)
}

async fn schedule_retry(
    pool: &SqlitePool,
    outbox_id: &str,
    attempts: i32,
    error: &str,
) -> Result<(), String> {
    let backoff_secs = std::cmp::min(30 * (1i32 << attempts.min(4)), 480);
    sqlx::query(
        &format!(
            "UPDATE pos_outbox SET status='pending', attempts=attempts+1, next_attempt_at=datetime('now','+{} seconds'), last_error=? WHERE id=?",
            backoff_secs
        )
    )
    .bind(error)
    .bind(outbox_id)
    .execute(pool).await.map_err(|e| e.to_string())?;
    Ok(())
}
