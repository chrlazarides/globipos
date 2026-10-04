use serde_json::{Map, Value};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use sqlx::sqlite::SqliteRow;
use sqlx::Acquire;

/// Convert a SqliteRow into a serde_json::Value object.
/// Handles TEXT, INTEGER, REAL, BOOLEAN, and NULL types.
pub fn row_to_json(row: SqliteRow) -> Value {
    let mut map = Map::new();
    for col in row.columns() {
        let name = col.name().to_string();
        let ordinal = col.ordinal();

        // Check for null first
        let raw = row.try_get_raw(ordinal);
        let is_null = raw.map(|r| r.is_null()).unwrap_or(true);

        let json_val = if name == "payment_tenders" && !is_null {
            row.try_get::<String, _>(ordinal).ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .unwrap_or_else(|| serde_json::json!([]))
        } else if is_null {
            Value::Null
        } else {
            let type_name = col.type_info().name().to_uppercase();
            match type_name.as_str() {
                "INTEGER" | "INT" | "INT4" | "INT8" | "BIGINT" | "SMALLINT" | "TINYINT" => {
                    if let Ok(v) = row.try_get::<i64, _>(ordinal) {
                        Value::Number(v.into())
                    } else if let Ok(v) = row.try_get::<i32, _>(ordinal) {
                        Value::Number(v.into())
                    } else {
                        Value::Null
                    }
                }
                "REAL" | "FLOAT" | "DOUBLE" | "NUMERIC" | "DECIMAL" => {
                    if let Ok(v) = row.try_get::<f64, _>(ordinal) {
                        Value::Number(
                            serde_json::Number::from_f64(v).unwrap_or_else(|| 0.into()),
                        )
                    } else {
                        Value::Null
                    }
                }
                "BOOLEAN" | "BOOL" => {
                    if let Ok(v) = row.try_get::<bool, _>(ordinal) {
                        Value::Bool(v)
                    } else if let Ok(v) = row.try_get::<i64, _>(ordinal) {
                        Value::Bool(v != 0)
                    } else {
                        Value::Null
                    }
                }
                _ => {
                    // TEXT, BLOB, or unknown — treat as string
                    if let Ok(v) = row.try_get::<String, _>(ordinal) {
                        Value::String(v)
                    } else {
                        Value::Null
                    }
                }
            }
        };
        map.insert(name, json_val);
    }
    Value::Object(map)
}

/// Upsert a single product from a server JSON payload
pub async fn upsert_product(pool: &sqlx::SqlitePool, p: &Value) -> Result<(), sqlx::Error> {
    let id        = uuid_from(p, "id");
    let server_id = str_val(p, "id");
    let active    = p["active"].as_bool().unwrap_or(true) as i32;

    sqlx::query(
        r#"INSERT INTO local_products
            (id, server_id, name, sku, barcode, description, category_id,
             price1, price2, price3, price4, price5, cost_price, vat_rate,
             unit_type, pack_size, stock_quantity, active, updated_at, image_url, synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(server_id) DO UPDATE SET
             name=excluded.name, sku=excluded.sku, barcode=excluded.barcode,
             description=excluded.description, category_id=excluded.category_id,
             price1=excluded.price1, price2=excluded.price2, price3=excluded.price3,
             price4=excluded.price4, price5=excluded.price5, cost_price=excluded.cost_price,
             vat_rate=excluded.vat_rate, unit_type=excluded.unit_type, pack_size=excluded.pack_size,
             stock_quantity=excluded.stock_quantity, active=excluded.active,
             updated_at=excluded.updated_at, image_url=excluded.image_url, synced_at=datetime('now')"#
    )
    .bind(&id)
    .bind(&server_id)
    .bind(str_val(p, "name"))
    .bind(str_val(p, "sku"))
    .bind(opt_str(p, "barcode"))
    .bind(opt_str(p, "description"))
    .bind(opt_str_key(p, "categoryId"))
    .bind(f64_val(p, "price1"))
    .bind(f64_val(p, "price2"))
    .bind(f64_val(p, "price3"))
    .bind(f64_val(p, "price4"))
    .bind(f64_val(p, "price5"))
    .bind(f64_val(p, "costPrice"))
    .bind(f64_val(p, "vatRate"))
    .bind(p["unitType"].as_str().unwrap_or("pc"))
    .bind(p["packSize"].as_i64().unwrap_or(1) as i32)
    .bind(p["stockQuantity"].as_i64().unwrap_or(0) as i32)
    .bind(active)
    .bind(opt_str_key(p, "updatedAt"))
    .bind(opt_str_key(p, "imageUrl"))
    .execute(pool)
    .await?;
    Ok(())
}

/// Upsert a category from server JSON
pub async fn upsert_category(pool: &sqlx::SqlitePool, c: &Value) -> Result<(), sqlx::Error> {
    let id        = uuid_from(c, "id");
    let server_id = str_val(c, "id");
    let active    = c["active"].as_bool().unwrap_or(true) as i32;

    sqlx::query(
        r#"INSERT INTO local_categories (id, server_id, name, description, parent_id, vat_rate, active)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(server_id) DO UPDATE SET
             name=excluded.name, description=excluded.description,
             parent_id=excluded.parent_id, vat_rate=excluded.vat_rate, active=excluded.active"#
    )
    .bind(&id)
    .bind(&server_id)
    .bind(str_val(c, "name"))
    .bind(opt_str(c, "description"))
    .bind(opt_str_key(c, "parentId"))
    .bind(f64_val(c, "vatRate"))
    .bind(active)
    .execute(pool)
    .await?;
    Ok(())
}

/// Upsert one downloaded catalog page atomically. Keeping the transaction here
/// avoids one SQLite commit per row while preserving the simple single-row APIs.
pub async fn upsert_catalog_page(
    pool: &sqlx::SqlitePool,
    products: &[Value],
    categories: &[Value],
    catalog_cursor: Option<Option<&str>>,
    last_catalog_sync: Option<Option<&str>>,
) -> Result<(), sqlx::Error> {
    upsert_catalog_page_with_filter(pool, products, categories, catalog_cursor, last_catalog_sync, None, false, false).await
}

pub async fn upsert_catalog_page_with_filter(
    pool: &sqlx::SqlitePool,
    products: &[Value],
    categories: &[Value],
    catalog_cursor: Option<Option<&str>>,
    last_catalog_sync: Option<Option<&str>>,
    filter: Option<&Value>,
    first_page: bool,
    done: bool,
) -> Result<(), sqlx::Error> {
    let _telemetry_guard = crate::sync_telemetry::acquire_write_lock().await;
    let mut tx = pool.begin().await?;
    if let Some(filter) = filter {
        let key = filter["key"].as_str().filter(|key| key.len() <= 100)
            .ok_or_else(|| sqlx::Error::Protocol("Invalid catalog filter key".into()))?;
        let enabled = filter["enabled"].as_bool()
            .ok_or_else(|| sqlx::Error::Protocol("Invalid catalog filter mode".into()))?;
        if enabled {
            // The snapshot ledger commits with each page and survives an interrupted download.
            sqlx::query("CREATE TABLE IF NOT EXISTS catalog_filter_products (server_id TEXT PRIMARY KEY)")
                .execute(&mut *tx).await?;
            if first_page {
                sqlx::query("DELETE FROM catalog_filter_products").execute(&mut *tx).await?;
            }
            for product in products {
                let id = product["id"].as_str().filter(|id| !id.is_empty())
                    .ok_or_else(|| sqlx::Error::Protocol("Catalog product ID required".into()))?;
                sqlx::query("INSERT OR IGNORE INTO catalog_filter_products (server_id) VALUES (?)")
                    .bind(id).execute(&mut *tx).await?;
            }
            if done {
                // Only cached products are removed, never orders, lines, stock ledgers or uploads.
                sqlx::query("DELETE FROM local_products WHERE server_id NOT IN (SELECT server_id FROM catalog_filter_products)")
                    .execute(&mut *tx).await?;
                sqlx::query("DELETE FROM catalog_filter_products").execute(&mut *tx).await?;
            }
        }
        if done {
            sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('catalog_filter_key', ?)")
                .bind(key).execute(&mut *tx).await?;
        }
    }
    for p in products {
        let id = uuid_from(p, "id");
        let server_id = str_val(p, "id");
        sqlx::query(
            r#"INSERT INTO local_products
                (id, server_id, name, sku, barcode, description, category_id,
                 price1, price2, price3, price4, price5, cost_price, vat_rate,
                 unit_type, pack_size, stock_quantity, active, updated_at, image_url, synced_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
               ON CONFLICT(server_id) DO UPDATE SET
                name=excluded.name, sku=excluded.sku, barcode=excluded.barcode,
                description=excluded.description, category_id=excluded.category_id,
                price1=excluded.price1, price2=excluded.price2, price3=excluded.price3,
                price4=excluded.price4, price5=excluded.price5, cost_price=excluded.cost_price,
                vat_rate=excluded.vat_rate, unit_type=excluded.unit_type, pack_size=excluded.pack_size,
                stock_quantity=excluded.stock_quantity, active=excluded.active,
                updated_at=excluded.updated_at, image_url=excluded.image_url, synced_at=datetime('now')"#
        )
        .bind(id).bind(server_id).bind(str_val(p, "name")).bind(str_val(p, "sku"))
        .bind(opt_str(p, "barcode")).bind(opt_str(p, "description")).bind(opt_str_key(p, "categoryId"))
        .bind(f64_val(p, "price1")).bind(f64_val(p, "price2")).bind(f64_val(p, "price3"))
        .bind(f64_val(p, "price4")).bind(f64_val(p, "price5")).bind(f64_val(p, "costPrice"))
        .bind(f64_val(p, "vatRate")).bind(p["unitType"].as_str().unwrap_or("pc"))
        .bind(p["packSize"].as_i64().unwrap_or(1) as i32).bind(p["stockQuantity"].as_i64().unwrap_or(0) as i32)
        .bind(p["active"].as_bool().unwrap_or(true) as i32).bind(opt_str_key(p, "updatedAt"))
        .bind(opt_str_key(p, "imageUrl"))
        .execute(&mut *tx).await?;
    }
    for c in categories {
        sqlx::query(
            r#"INSERT INTO local_categories (id, server_id, name, description, parent_id, vat_rate, active)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(server_id) DO UPDATE SET
                name=excluded.name, description=excluded.description,
                parent_id=excluded.parent_id, vat_rate=excluded.vat_rate, active=excluded.active"#
        )
        .bind(uuid_from(c, "id")).bind(str_val(c, "id")).bind(str_val(c, "name"))
        .bind(opt_str(c, "description")).bind(opt_str_key(c, "parentId"))
        .bind(f64_val(c, "vatRate")).bind(c["active"].as_bool().unwrap_or(true) as i32)
        .execute(&mut *tx).await?;
    }
    if let Some(cursor) = catalog_cursor {
        match cursor {
            Some(value) => {
                sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('catalog_sync_cursor', ?)")
                    .bind(value)
                    .execute(&mut *tx)
                    .await?;
            }
            None => {
                sqlx::query("DELETE FROM schema_meta WHERE key = 'catalog_sync_cursor'")
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    sqlx::query("DELETE FROM schema_meta WHERE key = 'catalog_bootstrap_cursor'")
        .execute(&mut *tx)
        .await?;
    if let Some(watermark) = last_catalog_sync {
        match watermark {
            Some(value) => {
                sqlx::query(
                    "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('last_catalog_sync', ?)",
                )
                .bind(value)
                .execute(&mut *tx)
                .await?;
            }
            None => {
                sqlx::query("DELETE FROM schema_meta WHERE key = 'last_catalog_sync'")
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    crate::sync_telemetry::record_catalog_page_committed(
        &mut tx,
        products.len() + categories.len(),
    )
    .await?;
    tx.commit().await
}

/// Replace all layout buttons atomically
pub async fn replace_layout(pool: &sqlx::SqlitePool, buttons: &[Value]) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM local_layout").execute(pool).await?;
    for btn in buttons {
        let btn_type = btn["buttonType"]
            .as_str()
            .unwrap_or("empty")
            .to_string();
        let color = btn["color"].as_str().unwrap_or("#6b7280").to_string();
        sqlx::query(
            r#"INSERT INTO local_layout (position, label, color, icon, button_type, item_id, category_id, action_code)
               VALUES (?,?,?,?,?,?,?,?)"#
        )
        .bind(btn["position"].as_i64().unwrap_or(0) as i32)
        .bind(str_val(btn, "label"))
        .bind(color)
        .bind(opt_str(btn, "icon"))
        .bind(btn_type)
        .bind(opt_str_key(btn, "itemId"))
        .bind(opt_str_key(btn, "categoryId"))
        .bind(opt_str_key(btn, "actionCode"))
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod catalog_page_tests {
    use super::*;
    #[tokio::test]
    async fn partial_catalog_prunes_only_after_a_complete_snapshot() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        crate::migrations::run_migrations(&pool).await.unwrap();
        let initial = vec![serde_json::json!({"id":"keep", "name":"Keep", "categoryId":"fruit"}),
            serde_json::json!({"id":"exclude", "name":"Exclude", "categoryId":"cleaning"}),
            serde_json::json!({"id":"moved", "name":"Moved", "categoryId":"fruit"})];
        upsert_catalog_page(&pool, &initial, &[], None, None).await.unwrap();
        sqlx::query("INSERT INTO pos_outbox (id, order_id, payload) VALUES ('saved', 'sale', '{}')")
            .execute(&pool).await.unwrap();
        let filter = serde_json::json!({"enabled":true, "key":"partial:test"});
        upsert_catalog_page_with_filter(&pool, &initial[..1], &[], None, None, Some(&filter), true, false).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM local_products").fetch_one(&pool).await.unwrap(), 3);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM schema_meta WHERE key = 'catalog_filter_key'").fetch_one(&pool).await.unwrap(), 0);
        upsert_catalog_page_with_filter(&pool, &[], &[], Some(None), Some(Some("2026-10-04T12:00:00Z")), Some(&filter), false, true).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT server_id FROM local_products").fetch_one(&pool).await.unwrap(), "keep");
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM pos_outbox").fetch_one(&pool).await.unwrap(), 1);
        let all = serde_json::json!({"enabled":false, "key":"all"});
        upsert_catalog_page_with_filter(&pool, &initial, &[], None, None, Some(&all), true, true).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM local_products").fetch_one(&pool).await.unwrap(), 3);
        assert_eq!(sqlx::query_scalar::<_, String>("SELECT value FROM schema_meta WHERE key = 'catalog_filter_key'").fetch_one(&pool).await.unwrap(), "all");
    }
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn final_catalog_page_commits_watermark_cursor_and_progress_together() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO schema_meta (key, value) VALUES
             ('catalog_sync_cursor', '{\"cursor\":\"next\"}'),
             ('catalog_bootstrap_cursor', '{\"cursor\":\"legacy\"}'),
             ('sync_telemetry_v1', ?)",
        )
        .bind(serde_json::to_string(&crate::models::SyncTelemetry::default()).unwrap())
        .execute(&pool)
        .await
        .unwrap();

        upsert_catalog_page(
            &pool,
            &[],
            &[],
            Some(None),
            Some(Some("2026-01-01T01:00:00Z")),
        )
        .await
        .unwrap();

        let watermark: String =
            sqlx::query_scalar("SELECT value FROM schema_meta WHERE key = 'last_catalog_sync'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let cursor_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schema_meta
             WHERE key IN ('catalog_sync_cursor', 'catalog_bootstrap_cursor')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let telemetry: String =
            sqlx::query_scalar("SELECT value FROM schema_meta WHERE key = 'sync_telemetry_v1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let telemetry: Value = serde_json::from_str(&telemetry).unwrap();

        assert_eq!(watermark, "2026-01-01T01:00:00Z");
        assert_eq!(cursor_count, 0);
        assert_eq!(telemetry["catalogPages"], 1);
        assert_eq!(telemetry["catalogCommitted"], 0);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn str_val(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").to_string()
}

pub fn opt_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v[key].as_str().filter(|s| !s.is_empty())
}

pub fn opt_str_key<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v[key].as_str().filter(|s| !s.is_empty())
}

pub fn f64_val(v: &Value, key: &str) -> f64 {
    v[key]
        .as_f64()
        .or_else(|| v[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

pub fn uuid_from(v: &Value, key: &str) -> String {
    v[key]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}
