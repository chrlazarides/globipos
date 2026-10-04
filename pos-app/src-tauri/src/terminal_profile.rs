use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

pub fn profile_key(server_url: &str, terminal_code: &str) -> String {
    let binding = format!("{}\n{}", server_url.trim().trim_end_matches('/'), terminal_code.trim().to_uppercase());
    format!("{:x}", Sha256::digest(binding.as_bytes()))
}

pub fn valid_filename(filename: &str) -> bool {
    filename == "globipos.db" || filename.strip_prefix("terminal-")
        .and_then(|s| s.strip_suffix(".db"))
        .map(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or(false)
}

pub async fn ensure_switch_ready(pool: &SqlitePool) -> Result<(), String> {
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pos_outbox WHERE status != 'synced'")
        .fetch_one(pool).await.map_err(|e| e.to_string())?;
    let audits: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE synced = 0")
        .fetch_one(pool).await.map_err(|e| e.to_string())?;
    let open: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pos_orders WHERE status NOT IN ('completed','voided','refunded','cancelled')"
    ).fetch_one(pool).await.map_err(|e| e.to_string())?;
    if pending > 0 || audits > 0 || open > 0 {
        return Err(format!(
            "Cannot switch yet: {} unsynced sales, {} unsynced audit records, {} open/held orders. \
             Sign in to the current terminal, finish or void open orders and use Sync now before switching.",
            pending, audits, open
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_are_stable_and_separate_between_servers_and_terminals() {
        assert_eq!(profile_key("https://shop.invalid/", " pos1 "), profile_key("https://shop.invalid", "POS1"));
        assert_ne!(profile_key("https://shop.invalid", "POS1"), profile_key("https://shop.invalid", "POS2"));
        assert_ne!(profile_key("https://shop.invalid", "POS1"), profile_key("https://other.invalid", "POS1"));
        assert!(valid_filename(&format!("terminal-{}.db", profile_key("https://shop.invalid", "POS1"))));
        assert!(valid_filename("globipos.db"));
        assert!(!valid_filename("../globipos.db"));
        assert!(!valid_filename("terminal-not-a-hash.db"));
    }
    #[tokio::test]
    async fn switching_blocks_every_pending_state_without_deleting_records() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for sql in [
            "CREATE TABLE pos_outbox (status TEXT)",
            "CREATE TABLE audit_log (synced INTEGER)",
            "CREATE TABLE pos_orders (status TEXT)",
        ] { sqlx::query(sql).execute(&pool).await.unwrap(); }
        ensure_switch_ready(&pool).await.unwrap();
        for status in ["pending", "syncing", "failed"] {
            sqlx::query("INSERT INTO pos_outbox VALUES (?)").bind(status).execute(&pool).await.unwrap();
            assert!(ensure_switch_ready(&pool).await.is_err());
            sqlx::query("UPDATE pos_outbox SET status='synced'").execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO audit_log VALUES (0)").execute(&pool).await.unwrap();
        assert!(ensure_switch_ready(&pool).await.is_err());
        sqlx::query("UPDATE audit_log SET synced=1").execute(&pool).await.unwrap();
        for status in ["active", "held"] {
            sqlx::query("INSERT INTO pos_orders VALUES (?)").bind(status).execute(&pool).await.unwrap();
            assert!(ensure_switch_ready(&pool).await.is_err());
            sqlx::query("UPDATE pos_orders SET status='completed'").execute(&pool).await.unwrap();
        }
        ensure_switch_ready(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pos_outbox").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 3, "switch readiness never erases the old terminal's records");
    }
}