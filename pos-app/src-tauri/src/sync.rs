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
    crate::auth::replace_synced_cashiers(pool, &data.cashiers).await?;

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

pub async fn sync_cashiers(
    pool: &SqlitePool, server_url: &str, terminal_code: &str,
) -> Result<usize, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{}/api/pos/sync/cashiers", server_url.trim_end_matches('/')))
        .header("X-Terminal-Code", terminal_code)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send().await.map_err(|e| format!("Cashier refresh network error: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Cashier refresh rejected (HTTP {})", response.status().as_u16()));
    }
    let cashiers: Vec<crate::models::CashierSeed> = response.json().await
        .map_err(|_| "Invalid cashier response; cached PINs were not changed".to_string())?;
    crate::auth::replace_synced_cashiers(pool, &cashiers).await?;
    Ok(cashiers.len())
}

pub async fn sync_catalog(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
    since: Option<&str>,
) -> Result<usize, String> {
    let total = fetch_catalog_pages(pool, server_url, terminal_code, since).await?;

    sqlx::query("INSERT INTO sync_log (sync_type, status, message, items_synced) VALUES ('catalog','ok',?,?)")
        .bind(format!("Catalog sync from watermark {:?}", since))
        .bind(total as i32)
        .execute(pool).await.map_err(|e| e.to_string())?;

    Ok(total)
}

/// Fetches deterministic, bounded pages. A resumable cursor is saved only with
/// the server's first-page watermark; the final page commits that watermark as
/// the next delta boundary in the same transaction as its catalog rows.
async fn fetch_catalog_pages(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
    since: Option<&str>,
) -> Result<usize, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(120)).build()
        .map_err(|e| e.to_string())?;
    let base = format!("{}/api/sync/catalog", server_url.trim_end_matches('/'));
    let scope = catalog_scope(server_url, terminal_code);
    let _read_guard = crate::sync_telemetry::acquire_write_lock().await;
    let saved_cursor = sqlx::query(
        "SELECT key, value FROM schema_meta
         WHERE key IN ('catalog_sync_cursor', 'catalog_bootstrap_cursor')
         ORDER BY CASE key WHEN 'catalog_sync_cursor' THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .and_then(|row| {
        Some((
            row.try_get::<String, _>("key").ok()?,
            row.try_get::<String, _>("value").ok()?,
        ))
    });
    drop(_read_guard);

    let (mut effective_since, mut cursor, mut watermark) = match saved_cursor {
        Some((key, value)) => match decode_catalog_checkpoint(&value, &scope, since) {
            Some((saved_since, saved_cursor, saved_watermark))
                if key == "catalog_sync_cursor" =>
            {
                (saved_since, Some(saved_cursor), Some(saved_watermark))
            }
            _ => {
                clear_catalog_cursor_state(pool).await?;
                (None, None, None)
            }
        },
        None => (since.map(str::to_owned), None, None),
    };
    let mut total = 0usize;
    loop {
        let mut url = reqwest::Url::parse(&base).map_err(|e| e.to_string())?;
        url.query_pairs_mut().append_pair("limit", "250");
        if let Some(s) = effective_since.as_deref() { url.query_pairs_mut().append_pair("since", s); }
        if let Some(c) = cursor.as_deref() { url.query_pairs_mut().append_pair("cursor", c); }
        let response = client
            .get(url.clone())
            .header("X-Terminal-Code", terminal_code)
            // reqwest is built without compression features. Prevent an intermediary from
            // returning compressed bytes that serde_json would otherwise try to parse.
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send().await;
        let resp = match response {
            Ok(resp) => {
                let _ = crate::sync_telemetry::set_server_reachable(pool, true).await;
                resp
            }
            Err(e) => {
                let _ = crate::sync_telemetry::set_server_reachable(pool, false).await;
                return Err(format!("Catalog sync network error: {}", e));
            }
        };
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Catalog sync server error {}: {}", status, body));
        }
        let content_type = resp.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("missing")
            .to_string();
        let body = resp.bytes().await
            .map_err(|e| format!("Catalog sync response read error from {}: {}", url, e))?;
        let data = decode_catalog_body(&body, &content_type, url.as_str())?;
        if cursor.is_none() && watermark.is_none() {
            watermark = data["serverWatermark"]
                .as_str()
                .and_then(parse_server_watermark);
            if effective_since.is_some() && watermark.is_none() {
                // A legacy server cannot provide a safe delta boundary. Discard
                // the delta response and restart as a full sync; never use the
                // local completion time as a substitute.
                clear_catalog_cursor_state(pool).await?;
                effective_since = None;
                cursor = None;
                total = 0;
                continue;
            }
        }
        let items = data["items"].as_array().cloned().unwrap_or_default();
        let cats = data["categories"].as_array().cloned().unwrap_or_default();
        let done = data["done"].as_bool().unwrap_or(true);
        let next = if done {
            None
        } else {
            Some(
                data["nextCursor"]
                    .as_str()
                    .filter(|c| !c.is_empty())
                    .ok_or_else(|| "Catalog sync response missing nextCursor".to_string())?
                    .to_string(),
            )
        };
        let next_checkpoint = match (next.as_deref(), watermark.as_deref()) {
            (Some(next_cursor), Some(server_watermark)) => Some(
                serde_json::json!({
                    "serverUrl": &scope.server_url,
                    "terminalCode": &scope.terminal_code,
                    "since": effective_since.as_deref(),
                    "cursor": next_cursor,
                    "serverWatermark": server_watermark
                })
                .to_string(),
            ),
            _ => None,
        };
        let cursor_update = if done {
            Some(None)
        } else {
            Some(next_checkpoint.as_deref())
        };
        let watermark_update = if done {
            Some(watermark.as_deref())
        } else {
            None
        };
        crate::sync_telemetry::record_catalog_received(pool, items.len() + cats.len())
            .await?;
        crate::sync_telemetry::set_phase(pool, "catalog-save").await?;
        db::upsert_catalog_page(
            pool,
            &items,
            &cats,
            cursor_update,
            watermark_update,
        )
            .await
            .map_err(|e| e.to_string())?;
        total += items.len() + cats.len();
        if done {
            break;
        }
        cursor = next;
        crate::sync_telemetry::set_phase(pool, "catalog-download").await?;
    }
    Ok(total)
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

fn decode_catalog_checkpoint(
    value: &str,
    scope: &CatalogScope,
    requested_since: Option<&str>,
) -> Option<(Option<String>, String, String)> {
    let saved: Value = serde_json::from_str(value).ok()?;
    if saved["serverUrl"].as_str() != Some(scope.server_url.as_str())
        || saved["terminalCode"].as_str() != Some(scope.terminal_code.as_str())
    {
        return None;
    }
    let since = saved["since"].as_str().map(str::to_owned);
    // A checkpoint with no `since` is an in-progress full sync and remains
    // resumable even if an older completed watermark is still stored locally.
    if since.is_some() && since.as_deref() != requested_since {
        return None;
    }
    let cursor = saved["cursor"]
        .as_str()
        .filter(|cursor| !cursor.is_empty())?
        .to_string();
    let watermark = parse_server_watermark(saved["serverWatermark"].as_str()?)?;
    Some((since, cursor, watermark))
}

fn parse_server_watermark(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.to_rfc3339())
}

async fn clear_catalog_cursor_state(pool: &SqlitePool) -> Result<(), String> {
    let _write_guard = crate::sync_telemetry::acquire_write_lock().await;
    sqlx::query(
        "DELETE FROM schema_meta
         WHERE key IN ('catalog_sync_cursor', 'catalog_bootstrap_cursor')",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod cursor_tests {
    use super::*;

    #[test]
    fn cursor_scope_normalizes_and_rejects_other_terminal() {
        let scope = catalog_scope("HTTPS://POS.EXAMPLE///", " t01 ");
        let saved = serde_json::json!({
            "serverUrl": &scope.server_url,
            "terminalCode": &scope.terminal_code,
            "since": "2026-01-01T00:00:00Z",
            "cursor": "opaque",
            "serverWatermark": "2026-01-01T01:00:00Z"
        });
        let decoded = decode_catalog_checkpoint(
            &saved.to_string(),
            &scope,
            Some("2026-01-01T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(decoded.1, "opaque");
        let other = catalog_scope("https://pos.example", "t02");
        assert!(decode_catalog_checkpoint(
            &saved.to_string(),
            &other,
            Some("2026-01-01T00:00:00Z")
        )
        .is_none());
        assert!(decode_catalog_checkpoint(&saved.to_string(), &scope, None).is_none());
        let full_sync = serde_json::json!({
            "serverUrl": &scope.server_url,
            "terminalCode": &scope.terminal_code,
            "since": null,
            "cursor": "full-resume",
            "serverWatermark": "2026-01-01T01:00:00Z"
        });
        assert!(decode_catalog_checkpoint(
            &full_sync.to_string(),
            &scope,
            Some("older-local-watermark")
        )
        .is_some());
    }

    #[test]
    fn server_watermark_must_be_trustworthy_rfc3339() {
        assert!(parse_server_watermark("2026-01-01T01:00:00Z").is_some());
        assert!(parse_server_watermark("not-a-watermark").is_none());
    }

    #[test]
    fn legacy_cursor_without_watermark_cannot_resume() {
        let scope = catalog_scope("https://pos.example", "t01");
        let legacy = serde_json::json!({
            "serverUrl": &scope.server_url,
            "terminalCode": &scope.terminal_code,
            "cursor": "old"
        });
        assert!(decode_catalog_checkpoint(&legacy.to_string(), &scope, None).is_none());
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
    fn bill_ack_requires_matching_order_number_and_ok_status() {
        let accepted = serde_json::json!({
            "results": [
                {"orderNumber": "OTHER-1", "status": "ok"},
                {"orderNumber": "POS-000001", "status": "ok"}
            ]
        });
        assert!(bill_acknowledged(&accepted, "POS-000001"));
        assert!(!bill_acknowledged(&accepted, "POS-000002"));
    }

    #[test]
    fn bill_ack_rejects_error_malformed_and_missing_results() {
        let rejected = serde_json::json!({
            "results": [{"orderNumber": "POS-000001", "status": "error"}]
        });
        assert!(!bill_acknowledged(&rejected, "POS-000001"));
        assert!(!bill_acknowledged(&serde_json::json!({"results": {}}), "POS-000001"));
        assert!(!bill_acknowledged(&serde_json::json!({}), "POS-000001"));
        let ambiguous = serde_json::json!({
            "results": [
                {"orderNumber": "POS-000001", "status": "ok"},
                {"orderNumber": "POS-000001", "status": "error"}
            ]
        });
        assert!(!bill_acknowledged(&ambiguous, "POS-000001"));
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
    let url = if let Some(s) = since { format!("{}?since={}", base, s) } else { base };

    let response = client
        .get(&url)
        .header("X-Terminal-Code", terminal_code)
        .send()
        .await;
    let resp = match response {
        Ok(resp) => {
            let _ = crate::sync_telemetry::set_server_reachable(pool, true).await;
            resp
        }
        Err(e) => {
            let _ = crate::sync_telemetry::set_server_reachable(pool, false).await;
            return Err(format!("Inbox sync error: {}", e));
        }
    };

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
                let valid_from = item["validFrom"].as_str().filter(|value| !value.is_empty());
                let valid_until = item["validUntil"].as_str().filter(|value| !value.is_empty());

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

    crate::sync_telemetry::record_inbox_received(pool, items.len()).await?;
    Ok(items.len())
}

// ── Outbox flush ──────────────────────────────────────────────────────────────

pub async fn flush_outbox(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
) -> Result<usize, String> {
    crate::migrations::recover_abandoned_outbox(pool)
        .await
        .map_err(|e| e.to_string())?;
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
        let lease_id = uuid::Uuid::new_v4().to_string();
        // Claim each immutable bill atomically. A second process can select the
        // same pending row, but only one can transition it to syncing.
        let claimed = sqlx::query(
            "UPDATE pos_outbox
             SET status = 'syncing',
                 sync_lease_until = datetime('now', '+2 minutes'),
                 sync_lease_id = ?
             WHERE id = ? AND status = 'pending'
               AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))",
        )
            .bind(&lease_id)
            .bind(&outbox_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        if claimed.rows_affected() != 1 {
            continue;
        }

        let payload: Value = match serde_json::from_str(&payload_str) {
            Ok(payload) => payload,
            Err(_) => {
                schedule_retry(
                    pool,
                    &outbox_id,
                    &lease_id,
                    attempts,
                    "INVALID_OUTBOX_PAYLOAD",
                )
                .await?;
                continue;
            }
        };
        let expected_order_number = match payload["orderNumber"].as_str() {
            Some(order_number) if !order_number.is_empty() => order_number.to_string(),
            _ => {
                schedule_retry(
                    pool,
                    &outbox_id,
                    &lease_id,
                    attempts,
                    "MISSING_ORDER_NUMBER",
                )
                .await?;
                continue;
            }
        };

        match client.post(&url)
            .header("X-Terminal-Code", terminal_code)
            .json(&serde_json::json!({ "bills": [payload] }))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let _ = crate::sync_telemetry::set_server_reachable(pool, true).await;
                let acknowledgement = resp.json::<Value>().await;
                match acknowledgement {
                    Ok(body) if bill_acknowledged(&body, &expected_order_number) => {
                        let updated = sqlx::query(
                            "UPDATE pos_outbox
                             SET status = 'synced', synced_at = datetime('now'),
                                 next_attempt_at = NULL, last_error = NULL,
                                 sync_lease_until = NULL, sync_lease_id = NULL
                             WHERE id = ? AND status = 'syncing' AND sync_lease_id = ?",
                        )
                        .bind(&outbox_id)
                        .bind(&lease_id)
                        .execute(pool)
                        .await
                        .map_err(|e| e.to_string())?;
                        if updated.rows_affected() == 1 {
                            synced += 1;
                            crate::sync_telemetry::record_transactions_confirmed(pool, 1).await?;
                        }
                    }
                    Ok(_) => {
                        schedule_retry(
                            pool,
                            &outbox_id,
                            &lease_id,
                            attempts,
                            "BILL_ACK_MISSING_OR_REJECTED",
                        )
                        .await?;
                    }
                    Err(_) => {
                        schedule_retry(pool, &outbox_id, &lease_id, attempts, "INVALID_BILL_ACK").await?;
                    }
                }
            }
            Ok(resp) => {
                let _ = crate::sync_telemetry::set_server_reachable(pool, true).await;
                schedule_retry(pool, &outbox_id, &lease_id, attempts, &format!("HTTP {}", resp.status())).await?;
            }
            Err(e) => {
                let _ = crate::sync_telemetry::set_server_reachable(pool, false).await;
                schedule_retry(pool, &outbox_id, &lease_id, attempts, &e.to_string()).await?;
            }
        }
    }

    Ok(synced)
}

fn bill_acknowledged(response: &Value, expected_order_number: &str) -> bool {
    response["results"]
        .as_array()
        .map(|results| {
            let mut matching = results
                .iter()
                .filter(|result| result["orderNumber"].as_str() == Some(expected_order_number));
            match matching.next() {
                Some(result) if result["status"].as_str() == Some("ok") => {
                    matching.next().is_none()
                }
                _ => false,
            }
        })
        .unwrap_or(false)
}

// ── Audit-log push ────────────────────────────────────────────────────────────

pub async fn push_audit_logs(
    pool: &SqlitePool,
    server_url: &str,
    terminal_code: &str,
) -> Result<usize, String> {
    let rows = sqlx::query(
        r#"SELECT id, cashier_id, cashier_name, action, entity, entity_id, detail, created_at
           FROM audit_log WHERE pushed = 0 ORDER BY id ASC LIMIT 200"#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    if rows.is_empty() { return Ok(0); }

    let entries: Vec<Value> = rows.iter().map(|r| {
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
    }).collect();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/pos/sync/audit-logs", server_url.trim_end_matches('/'));
    let response = client.post(&url)
        .header("X-Terminal-Code", terminal_code)
        .json(&serde_json::json!({ "entries": entries }))
        .send()
        .await;
    let resp = match response {
        Ok(resp) => {
            let _ = crate::sync_telemetry::set_server_reachable(pool, true).await;
            resp
        }
        Err(e) => {
            let _ = crate::sync_telemetry::set_server_reachable(pool, false).await;
            return Err(e.to_string());
        }
    };

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let max_id: i64 = rows.iter().map(|r| r.try_get::<i64, _>("id").unwrap_or(0)).max().unwrap_or(0);
    sqlx::query("UPDATE audit_log SET pushed = 1 WHERE id <= ? AND pushed = 0")
        .bind(max_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    crate::sync_telemetry::record_audits_confirmed(pool, rows.len()).await?;
    Ok(rows.len())
}

async fn schedule_retry(
    pool: &SqlitePool,
    outbox_id: &str,
    lease_id: &str,
    attempts: i32,
    error: &str,
) -> Result<(), String> {
    let backoff_secs = std::cmp::min(30 * (1i32 << attempts.min(4)), 480);
    sqlx::query(
        &format!(
        "UPDATE pos_outbox
         SET status='pending', attempts=attempts+1,
             next_attempt_at=datetime('now','+{} seconds'), last_error=?,
             sync_lease_until=NULL, sync_lease_id=NULL
         WHERE id=? AND status='syncing' AND sync_lease_id=?",
            backoff_secs
        )
    )
    .bind(error)
    .bind(outbox_id)
    .bind(lease_id)
    .execute(pool).await.map_err(|e| e.to_string())?;
    Ok(())
}
