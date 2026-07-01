use sha2::{Sha256, Digest};
use sqlx::{Row, SqlitePool};

use crate::models::CashierSession;

/// Hash a plaintext PIN using SHA-256. Returns lowercase hex string.
pub fn hash_pin(pin: &str) -> String {
    let result = Sha256::digest(pin.as_bytes());
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Validate a cashier PIN against the local DB.
pub async fn validate_pin(pool: &SqlitePool, pin: &str) -> Result<Option<CashierSession>, sqlx::Error> {
    let hash = hash_pin(pin);
    let row = sqlx::query(
        "SELECT id, name, role FROM cashiers WHERE pin_hash = ? AND active = 1"
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        let role: String = r.try_get("role").unwrap_or_default();
        CashierSession {
            cashier_id:   r.try_get("id").unwrap_or_default(),
            cashier_name: r.try_get("name").unwrap_or_default(),
            role: role.clone(),
            pin_hash: hash.clone(),
            permissions: default_permissions(&role),
        }
    }))
}

fn default_permissions(role: &str) -> Vec<String> {
    match role {
        "manager" => vec![
            "sell","void_order","void_line","price_override","discount",
            "hold","recall","refund","promo_code","open_drawer",
            "reports","manage_cashiers","end_shift",
        ],
        "supervisor" => vec![
            "sell","void_line","price_override","discount",
            "hold","recall","promo_code","open_drawer","end_shift",
        ],
        _ => vec!["sell","hold","recall"],
    }
    .iter().map(|s| s.to_string()).collect()
}

/// Create or update a cashier from a plaintext PIN (hashed locally before storage).
pub async fn upsert_cashier(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    pin: &str,
    role: &str,
) -> Result<(), sqlx::Error> {
    let hash = hash_pin(pin);
    upsert_cashier_with_hash(pool, id, name, &hash, role).await
}

/// Create or update a cashier from a pre-computed SHA-256 hex hash (from server sync).
/// Stores the hash directly without re-hashing.
pub async fn upsert_cashier_with_hash(
    pool: &SqlitePool,
    id: &str,
    name: &str,
    pin_hash: &str,
    role: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO cashiers (id, name, pin_hash, role, active)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, pin_hash=excluded.pin_hash, role=excluded.role"#
    )
    .bind(id)
    .bind(name)
    .bind(pin_hash)
    .bind(role)
    .execute(pool)
    .await?;
    Ok(())
}

/// Append an entry to the local audit log.
pub async fn audit(
    pool: &SqlitePool,
    cashier_id: Option<&str>,
    cashier_name: Option<&str>,
    action: &str,
    entity: Option<&str>,
    entity_id: Option<&str>,
    detail: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO audit_log (cashier_id, cashier_name, action, entity, entity_id, detail)
           VALUES (?, ?, ?, ?, ?, ?)"#
    )
    .bind(cashier_id)
    .bind(cashier_name)
    .bind(action)
    .bind(entity)
    .bind(entity_id)
    .bind(detail)
    .execute(pool)
    .await?;
    Ok(())
}
