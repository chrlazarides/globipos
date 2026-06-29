use serde_json::{Map, Value};
use sqlx::{Column, Row, TypeInfo, ValueRef};
use sqlx::sqlite::SqliteRow;

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

        let json_val = if is_null {
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
             unit_type, pack_size, stock_quantity, active, updated_at, synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(server_id) DO UPDATE SET
             name=excluded.name, sku=excluded.sku, barcode=excluded.barcode,
             description=excluded.description, category_id=excluded.category_id,
             price1=excluded.price1, price2=excluded.price2, price3=excluded.price3,
             price4=excluded.price4, price5=excluded.price5, cost_price=excluded.cost_price,
             vat_rate=excluded.vat_rate, unit_type=excluded.unit_type, pack_size=excluded.pack_size,
             stock_quantity=excluded.stock_quantity, active=excluded.active,
             updated_at=excluded.updated_at, synced_at=datetime('now')"#
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
