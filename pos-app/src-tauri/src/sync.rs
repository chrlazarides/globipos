use crate::db;
use crate::models::RegisterResponse;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use std::time::Duration;

const CATALOG_PAGE_MAX_ATTEMPTS: usize = 4;

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

    let url = format!(
        "{}/api/pos/terminals/register",
        server_url.trim_end_matches('/')
    );
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "terminalCode": terminal_code,
            "catalogSyncVersion": 1
        }))
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

    // Registration intentionally contains no products. Bootstrap through bounded pages.
    for cat in &data.catalog.categories {
        db::upsert_category(pool, cat)
            .await
            .map_err(|e| e.to_string())?;
    }
    let catalog_count = fetch_catalog_pages(pool, server_url, terminal_code, None).await?;

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
    .bind(catalog_count as i32)
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
    let total = fetch_catalog_pages(pool, server_url, terminal_code, since).await?;

    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('last_catalog_sync', datetime('now'))")
        .execute(pool).await.map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO sync_log (sync_type, status, message, items_synced) VALUES ('catalog','ok',?,?)")
        .bind(format!("Delta since {:?}", since))
        .bind(total as i32)
        .execute(pool).await.map_err(|e| e.to_string())?;

    Ok(total)
}

/// Fetches deterministic, bounded pages. The cursor is persisted after each page so a
/// failed request can safely restart without losing already-upserted rows.
async fn fetch_catalog_pages(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
    since: Option<&str>,
) -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let base = format!("{}/api/sync/catalog", server_url.trim_end_matches('/'));
    let scope = catalog_scope(server_url, terminal_code);
    let mut cursor: Option<String> = if since.is_none() {
        sqlx::query("SELECT value FROM schema_meta WHERE key = 'catalog_bootstrap_cursor'")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .and_then(|r| r.try_get::<String, _>("value").ok())
            .and_then(|value| decode_scoped_cursor(&value, &scope))
    } else {
        None
    };
    let mut total = 0usize;
    loop {
        let mut url = reqwest::Url::parse(&base).map_err(|e| e.to_string())?;
        url.query_pairs_mut().append_pair("limit", "250");
        if let Some(s) = since {
            url.query_pairs_mut().append_pair("since", s);
        }
        if let Some(c) = cursor.as_deref() {
            url.query_pairs_mut().append_pair("cursor", c);
        }
        let (body, content_type) = fetch_catalog_page(&client, &url, terminal_code).await?;
        let data = decode_catalog_body(&body, &content_type, url.as_str())?;
        let items = data["items"].as_array().cloned().unwrap_or_default();
        let cats = data["categories"].as_array().cloned().unwrap_or_default();
        db::upsert_catalog_page(pool, &items, &cats)
            .await
            .map_err(|e| e.to_string())?;
        total += items.len() + cats.len();
        if data["done"].as_bool().unwrap_or(true) {
            if since.is_none() {
                sqlx::query("DELETE FROM schema_meta WHERE key = 'catalog_bootstrap_cursor'")
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            break;
        }
        let next = data["nextCursor"]
            .as_str()
            .filter(|c| !c.is_empty())
            .ok_or_else(|| "Catalog sync response missing nextCursor".to_string())?;
        cursor = Some(next.to_string());
        if since.is_none() {
            sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('catalog_bootstrap_cursor', ?)")
                .bind(serde_json::json!({
                    "serverUrl": &scope.server_url,
                    "terminalCode": &scope.terminal_code,
                    "cursor": next
                }).to_string())
                .execute(pool).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(total)
}

/// Fetches a page with retries for interrupted connections. Catalog page writes are idempotent
/// and the cursor is only saved after the entire page is read and applied, so retrying a GET is
/// safe even if a proxy closes the body stream after returning HTTP 200.
async fn fetch_catalog_page(
    client: &reqwest::Client,
    url: &reqwest::Url,
    terminal_code: &str,
) -> Result<(Vec<u8>, String), String> {
    for attempt in 1..=CATALOG_PAGE_MAX_ATTEMPTS {
        let resp = match client
            .get(url.clone())
            .header("X-Terminal-Code", terminal_code)
            // reqwest is built without compression features. Prevent an intermediary from
            // returning compressed bytes that serde_json would otherwise try to parse.
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(error) if attempt < CATALOG_PAGE_MAX_ATTEMPTS => {
                wait_before_catalog_retry(attempt, url, &error.to_string()).await;
                continue;
            }
            Err(error) => {
                return Err(format!(
                    "Catalog sync network error from {} after {} attempts: {}",
                    url, CATALOG_PAGE_MAX_ATTEMPTS, error
                ));
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Catalog sync server error {}: {}", status, body));
        }

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("missing")
            .to_string();
        match resp.bytes().await {
            Ok(body) => return Ok((body.to_vec(), content_type)),
            Err(error) if attempt < CATALOG_PAGE_MAX_ATTEMPTS => {
                wait_before_catalog_retry(attempt, url, &error.to_string()).await;
            }
            Err(error) => {
                return Err(format!(
                    "Catalog sync response read error from {} after {} attempts: {}",
                    url, CATALOG_PAGE_MAX_ATTEMPTS, error
                ));
            }
        }
    }

    unreachable!("catalog page retry loop returns on every final attempt")
}

async fn wait_before_catalog_retry(attempt: usize, url: &reqwest::Url, error: &str) {
    let delay = catalog_retry_delay(attempt);
    eprintln!(
        "Catalog sync request to {} failed on attempt {}/{}: {}; retrying in {}s",
        url,
        attempt,
        CATALOG_PAGE_MAX_ATTEMPTS,
        error,
        delay.as_secs()
    );
    tokio::time::sleep(delay).await;
}

fn catalog_retry_delay(attempt: usize) -> Duration {
    Duration::from_secs(1_u64 << (attempt - 1))
}

fn decode_catalog_body(body: &[u8], content_type: &str, url: &str) -> Result<Value, String> {
    serde_json::from_slice(body).map_err(|error| {
        let preview = String::from_utf8_lossy(&body[..body.len().min(160)])
            .replace(['\r', '\n'], " ");
        format!(
            "Catalog sync parse error from {} (content-type {}, {} bytes): {}; body starts with: {}",
            url,
            content_type,
            body.len(),
            error,
            preview
        )
    })
}

struct CatalogScope {
    server_url: String,
    terminal_code: String,
}

fn catalog_scope(server_url: &str, terminal_code: &str) -> CatalogScope {
    CatalogScope {
        server_url: server_url.trim_end_matches('/').to_ascii_lowercase(),
        terminal_code: terminal_code.trim().to_ascii_uppercase(),
    }
}

fn decode_scoped_cursor(value: &str, scope: &CatalogScope) -> Option<String> {
    let saved: Value = serde_json::from_str(value).ok()?;
    if saved["serverUrl"].as_str() != Some(scope.server_url.as_str())
        || saved["terminalCode"].as_str() != Some(scope.terminal_code.as_str())
    {
        return None;
    }
    saved["cursor"]
        .as_str()
        .filter(|cursor| !cursor.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod cursor_tests {
    use super::*;

    #[test]
    fn cursor_scope_normalizes_and_rejects_other_terminal() {
        let scope = catalog_scope("HTTPS://POS.EXAMPLE///", " t01 ");
        let saved = serde_json::json!({
            "serverUrl": scope.server_url,
            "terminalCode": scope.terminal_code,
            "cursor": "opaque"
        });
        assert_eq!(
            decode_scoped_cursor(&saved.to_string(), &scope).as_deref(),
            Some("opaque")
        );
        let other = catalog_scope("https://pos.example", "t02");
        assert!(decode_scoped_cursor(&saved.to_string(), &other).is_none());
    }

    #[test]
    fn catalog_parse_error_includes_bounded_response_diagnostics() {
        let body = vec![b'<'; 300];
        let error = decode_catalog_body(&body, "text/html", "https://pos.example/api/sync/catalog")
            .expect_err("HTML must not parse as catalog JSON");

        assert!(error.contains("content-type text/html"));
        assert!(error.contains("300 bytes"));
        assert!(error.contains(&"<".repeat(160)));
        assert!(!error.contains(&"<".repeat(161)));
    }

    #[test]
    fn catalog_page_retries_back_off_and_stay_bounded() {
        assert_eq!(catalog_retry_delay(1), Duration::from_secs(1));
        assert_eq!(catalog_retry_delay(2), Duration::from_secs(2));
        assert_eq!(catalog_retry_delay(3), Duration::from_secs(4));
    }
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
    let url = if let Some(s) = since {
        format!("{}?since={}", base, s)
    } else {
        base
    };

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
        let server_id = item["id"].as_str().unwrap_or("").to_string();
        let message_type = item["messageType"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let payload = serde_json::to_string(item).unwrap_or_default();
        let local_id = uuid::Uuid::new_v4().to_string();

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
                let price = item["price"]
                    .as_f64()
                    .or_else(|| item["price"].as_str().and_then(|s| s.parse().ok()))
                    .unwrap_or(0.0);
                let valid_from = item["validFrom"].as_str().filter(|value| !value.is_empty());
                let valid_until = item["validUntil"]
                    .as_str()
                    .filter(|value| !value.is_empty());

                sqlx::query(
                    "INSERT OR REPLACE INTO price_overrides (product_id, override_price, valid_from, valid_until, reason) VALUES (?,?,?,?,'inbox')"
                )
                .bind(product_id)
                .bind(price)
                .bind(valid_from)
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
           ORDER BY created_at ASC LIMIT 20"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/sync/bills", server_url.trim_end_matches('/'));
    let mut synced = 0;

    for row in &rows {
        let outbox_id: String = row.try_get("id").unwrap_or_default();
        let payload_str: String = row.try_get("payload").unwrap_or_default();
        let attempts: i32 = row.try_get("attempts").unwrap_or(0);

        let payload: Value = serde_json::from_str(&payload_str).unwrap_or(Value::Null);

        sqlx::query("UPDATE pos_outbox SET status = 'syncing' WHERE id = ?")
            .bind(&outbox_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        match client
            .post(&url)
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
                schedule_retry(
                    pool,
                    &outbox_id,
                    attempts,
                    &format!("HTTP {}", resp.status()),
                )
                .await?;
            }
            Err(e) => {
                schedule_retry(pool, &outbox_id, attempts, &e.to_string()).await?;
            }
        }
    }

    Ok(synced)
}

// ── Audit-log push ────────────────────────────────────────────────────────────

pub async fn push_audit_logs(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
) -> Result<usize, String> {
    let rows = sqlx::query(
        r#"SELECT id, cashier_id, cashier_name, action, entity, entity_id, detail, created_at
           FROM audit_log WHERE pushed = 0 ORDER BY id ASC LIMIT 200"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Ok(0);
    }

    let entries: Vec<Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "localId":     r.try_get::<i64, _>("id").unwrap_or_default(),
                "cashierId":   r.try_get::<Option<String>, _>("cashier_id").unwrap_or(None),
                "cashierName": r.try_get::<Option<String>, _>("cashier_name").unwrap_or(None),
                "action":      r.try_get::<String, _>("action").unwrap_or_default(),
                "entity":      r.try_get::<Option<String>, _>("entity").unwrap_or(None),
                "entityId":    r.try_get::<Option<String>, _>("entity_id").unwrap_or(None),
                "detail":      r.try_get::<Option<String>, _>("detail").unwrap_or(None),
                "createdAt":   r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{}/api/pos/sync/audit-logs",
        server_url.trim_end_matches('/')
    );
    let resp = client
        .post(&url)
        .header("X-Terminal-Code", terminal_code)
        .json(&serde_json::json!({ "entries": entries }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let max_id: i64 = rows
        .iter()
        .map(|r| r.try_get::<i64, _>("id").unwrap_or(0))
        .max()
        .unwrap_or(0);
    sqlx::query("UPDATE audit_log SET pushed = 1 WHERE id <= ? AND pushed = 0")
        .bind(max_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.len())
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
