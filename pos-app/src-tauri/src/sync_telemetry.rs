use crate::models::SyncTelemetry;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

const TELEMETRY_KEY: &str = "sync_telemetry_v1";
const DEVICE_ID_KEY: &str = "sync_device_id";
const REPORT_SEQUENCE_KEY: &str = "sync_report_sequence";
static TELEMETRY_WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Serialize native telemetry read-modify-write operations across all command
/// and sync helpers in this process. Catalog page transactions hold this guard
/// from before beginning their SQLite transaction through commit.
pub async fn acquire_write_lock() -> tokio::sync::MutexGuard<'static, ()> {
    TELEMETRY_WRITE_LOCK.lock().await
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub async fn ensure_device_id(pool: &SqlitePool) -> Result<String, String> {
    let _write_guard = acquire_write_lock().await;
    ensure_device_id_unlocked(pool).await
}

async fn ensure_device_id_unlocked(pool: &SqlitePool) -> Result<String, String> {
    let generated = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT OR IGNORE INTO schema_meta (key, value) VALUES (?, ?)")
        .bind(DEVICE_ID_KEY)
        .bind(generated)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query_scalar("SELECT value FROM schema_meta WHERE key = ?")
        .bind(DEVICE_ID_KEY)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

pub async fn next_report_sequence(pool: &SqlitePool) -> Result<i64, String> {
    let _write_guard = acquire_write_lock().await;
    sqlx::query("INSERT OR IGNORE INTO schema_meta (key, value) VALUES (?, '0')")
        .bind(REPORT_SEQUENCE_KEY)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query_scalar::<_, i64>(
        "UPDATE schema_meta
         SET value = CAST(CASE
             WHEN CAST(value AS INTEGER) < 0 THEN 1
             ELSE CAST(value AS INTEGER) + 1
         END AS TEXT)
         WHERE key = ?
         RETURNING CAST(value AS INTEGER)",
    )
    .bind(REPORT_SEQUENCE_KEY)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

pub async fn load(pool: &SqlitePool) -> Result<SyncTelemetry, String> {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = ?")
        .bind(TELEMETRY_KEY)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut telemetry = row
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|value| serde_json::from_str::<SyncTelemetry>(&value).ok())
        .unwrap_or_default();

    if telemetry.last_catalog_sync_at.is_none() {
        telemetry.last_catalog_sync_at = sqlx::query(
            "SELECT value FROM schema_meta WHERE key = 'last_catalog_sync'",
        )
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .map(|value| normalize_sqlite_timestamp(&value));
    }
    telemetry.schema_version = 1;
    telemetry.platform = "native".to_string();
    telemetry.build_version = env!("CARGO_PKG_VERSION").to_string();
    telemetry.device_id = sqlx::query_scalar::<_, String>(
        "SELECT value FROM schema_meta WHERE key = ?",
    )
    .bind(DEVICE_ID_KEY)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Native sync device ID is not initialized".to_string())?;
    telemetry.report_sequence = sqlx::query_scalar::<_, String>(
        "SELECT value FROM schema_meta WHERE key = ?",
    )
    .bind(REPORT_SEQUENCE_KEY)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .and_then(|value| value.parse::<i64>().ok())
    .filter(|sequence| *sequence >= 0)
    .unwrap_or(0);
    refresh_counts(pool, &mut telemetry).await?;
    Ok(telemetry)
}

pub async fn save(pool: &SqlitePool, telemetry: &SyncTelemetry) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    save_unlocked(pool, telemetry).await
}

async fn save_unlocked(
    pool: &SqlitePool,
    telemetry: &SyncTelemetry,
) -> Result<(), String> {
    let mut snapshot = serde_json::to_value(telemetry).map_err(|e| e.to_string())?;
    if let Some(fields) = snapshot.as_object_mut() {
        // Sequence is separately durable and atomically incremented per report;
        // run snapshot writes must never roll it back.
        fields.remove("sequence");
    }
    let value = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)")
        .bind(TELEMETRY_KEY)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn begin(
    pool: &SqlitePool,
    phase: &str,
) -> Result<SyncTelemetry, String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = load(pool).await?;
    let now = now_iso();
    telemetry.run_id = Some(uuid::Uuid::new_v4().to_string());
    telemetry.phase = phase.to_string();
    telemetry.syncing = true;
    telemetry.last_attempt_at = Some(now.clone());
    telemetry.started_at = Some(now.clone());
    telemetry.progress_at = Some(now);
    telemetry.catalog_received = 0;
    telemetry.catalog_committed = 0;
    telemetry.catalog_pages = 0;
    telemetry.transactions_confirmed = 0;
    telemetry.audits_confirmed = 0;
    telemetry.inbox_received = 0;
    telemetry.error = None;
    telemetry.retry_at = None;
    telemetry.audit_failed = 0;
    save_unlocked(pool, &telemetry).await?;
    Ok(telemetry)
}

pub async fn set_phase(pool: &SqlitePool, phase: &str) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.phase = phase.to_string();
    telemetry.progress_at = Some(now_iso());
    save_unlocked(pool, &telemetry).await
}

pub async fn record_catalog_received(pool: &SqlitePool, count: usize) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.catalog_received += count as i64;
    telemetry.progress_at = Some(now_iso());
    save_unlocked(pool, &telemetry).await
}

pub async fn record_inbox_received(pool: &SqlitePool, count: usize) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.inbox_received += count as i64;
    telemetry.inbox_pending = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pos_inbox WHERE processed = 0",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    telemetry.progress_at = Some(now_iso());
    save_unlocked(pool, &telemetry).await
}

pub async fn record_transactions_confirmed(
    pool: &SqlitePool,
    count: usize,
) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.transactions_confirmed += count as i64;
    if count > 0 {
        telemetry.last_transaction_sync_at = Some(now_iso());
    }
    telemetry.progress_at = Some(now_iso());
    save_unlocked(pool, &telemetry).await
}

pub async fn record_audits_confirmed(pool: &SqlitePool, count: usize) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.audits_confirmed += count as i64;
    telemetry.audit_failed = 0;
    telemetry.progress_at = Some(now_iso());
    save_unlocked(pool, &telemetry).await
}

pub async fn record_audit_failure(pool: &SqlitePool) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.audit_failed = telemetry.audit_pending;
    telemetry.error = Some("AUDIT_SYNC_FAILED".to_string());
    telemetry.progress_at = Some(now_iso());
    save_unlocked(pool, &telemetry).await
}

pub async fn finish(
    pool: &SqlitePool,
    phase: &str,
    error_code: Option<&str>,
    catalog_succeeded: bool,
) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    let now = now_iso();
    telemetry.syncing = false;
    telemetry.phase = phase.to_string();
    telemetry.progress_at = Some(now.clone());
    telemetry.error = error_code.map(str::to_string);
    if catalog_succeeded {
        telemetry.last_catalog_sync_at = Some(now.clone());
    }
    refresh_counts(pool, &mut telemetry).await?;
    if phase == "complete" && error_code.is_none() {
        if telemetry.outbox_failed > 0 {
            telemetry.phase = "partial".to_string();
            telemetry.error = Some("OUTBOX_RETRY_SCHEDULED".to_string());
        } else if telemetry.audit_failed > 0 {
            telemetry.phase = "partial".to_string();
            telemetry.error = Some("AUDIT_SYNC_FAILED".to_string());
        }
    }
    if telemetry.phase == "complete" {
        telemetry.last_success_at = Some(now);
    }
    save_unlocked(pool, &telemetry).await
}

pub async fn set_network_status(pool: &SqlitePool, online: bool) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.online = online;
    save_unlocked(pool, &telemetry).await
}

pub async fn set_server_reachable(pool: &SqlitePool, reachable: bool) -> Result<(), String> {
    let _write_guard = acquire_write_lock().await;
    let mut telemetry = read_stored(pool).await?;
    telemetry.server_reachable = Some(reachable);
    if reachable {
        telemetry.last_server_contact_at = Some(now_iso());
    }
    telemetry.progress_at.get_or_insert_with(now_iso);
    save_unlocked(pool, &telemetry).await
}

/// Called inside the catalog page transaction while the caller owns
/// `acquire_write_lock`, so cursor and committed progress are serialized and
/// durable in the same SQLite commit.
pub async fn record_catalog_page_committed(
    tx: &mut Transaction<'_, Sqlite>,
    committed: usize,
) -> Result<(), sqlx::Error> {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = ?")
        .bind(TELEMETRY_KEY)
        .fetch_optional(&mut **tx)
        .await?;
    let mut telemetry = row
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|value| serde_json::from_str::<SyncTelemetry>(&value).ok())
        .unwrap_or_default();
    telemetry.catalog_committed += committed as i64;
    telemetry.catalog_pages += 1;
    telemetry.progress_at = Some(now_iso());
    let mut snapshot = serde_json::to_value(&telemetry)
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    if let Some(fields) = snapshot.as_object_mut() {
        fields.remove("sequence");
    }
    let value = serde_json::to_string(&snapshot)
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)")
        .bind(TELEMETRY_KEY)
        .bind(value)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn read_stored(pool: &SqlitePool) -> Result<SyncTelemetry, String> {
    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = ?")
        .bind(TELEMETRY_KEY)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .and_then(|value| serde_json::from_str::<SyncTelemetry>(&value).ok())
        .unwrap_or_default())
}

async fn refresh_counts(
    pool: &SqlitePool,
    telemetry: &mut SyncTelemetry,
) -> Result<(), String> {
    telemetry.outbox_pending = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pos_outbox WHERE status = 'syncing' OR (status = 'pending' AND last_error IS NULL)",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    telemetry.outbox_failed =
        sqlx::query_scalar("SELECT COUNT(*) FROM pos_outbox WHERE status = 'failed' OR (status = 'pending' AND last_error IS NOT NULL)")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    telemetry.audit_pending =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE pushed = 0")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    telemetry.inbox_pending =
        sqlx::query_scalar("SELECT COUNT(*) FROM pos_inbox WHERE processed = 0")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    telemetry.retry_at = sqlx::query_scalar::<_, Option<String>>(
        "SELECT MIN(next_attempt_at) FROM pos_outbox WHERE status = 'pending' AND next_attempt_at IS NOT NULL",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .map(|value: String| normalize_sqlite_timestamp(&value));
    if telemetry.audit_pending == 0 {
        telemetry.audit_failed = 0;
    }
    Ok(())
}

fn normalize_sqlite_timestamp(value: &str) -> String {
    if value.ends_with('Z') || value.contains('+') {
        value.to_string()
    } else if value.contains('T') {
        format!("{value}Z")
    } else {
        format!("{}Z", value.replace(' ', "T"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn retry_timestamp_handles_empty_and_pending_outbox() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE pos_outbox (
                status TEXT, last_error TEXT, next_attempt_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE audit_log (pushed INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE pos_inbox (processed INTEGER)")
            .execute(&pool)
            .await
            .unwrap();

        let mut telemetry = SyncTelemetry::default();
        refresh_counts(&pool, &mut telemetry).await.unwrap();
        assert_eq!(telemetry.retry_at, None);
        sqlx::query(
            "INSERT INTO pos_outbox (status, next_attempt_at) VALUES
                ('pending', NULL),
                ('failed', '2026-04-14 09:00:00'),
                ('pending', '2026-04-14 12:00:00'),
                ('pending', '2026-04-14 11:30:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        refresh_counts(&pool, &mut telemetry).await.unwrap();
        assert_eq!(
            telemetry.retry_at.as_deref(),
            Some("2026-04-14T11:30:00Z")
        );
        sqlx::query("UPDATE pos_outbox SET status = 'synced' WHERE status = 'pending'")
            .execute(&pool)
            .await
            .unwrap();
        refresh_counts(&pool, &mut telemetry).await.unwrap();
        assert_eq!(telemetry.retry_at, None);
    }

    #[test]
    fn sqlite_utc_timestamps_are_iso8601() {
        assert_eq!(
            normalize_sqlite_timestamp("2026-04-14 11:30:00"),
            "2026-04-14T11:30:00Z"
        );
    }

    #[test]
    fn telemetry_defaults_match_version_one_native_shape() {
        let telemetry = SyncTelemetry::default();
        let value = serde_json::to_value(telemetry).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["platform"], "native");
        assert_eq!(value["buildVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["phase"], "idle");
        assert_eq!(value["syncing"], false);
        assert_eq!(value["serverReachable"], serde_json::Value::Null);
        assert_eq!(value["catalogCommitted"], 0);
        assert_eq!(value["sequence"], 0);
    }

    #[tokio::test]
    async fn device_identity_and_report_sequence_survive_snapshot_writes() {
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
            "CREATE TABLE pos_outbox (
                status TEXT, last_error TEXT, next_attempt_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE audit_log (pushed INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE pos_inbox (processed INTEGER)")
            .execute(&pool)
            .await
            .unwrap();

        let device_id = ensure_device_id(&pool).await.unwrap();
        let first = next_report_sequence(&pool).await.unwrap();
        let mut snapshot = load(&pool).await.unwrap();
        snapshot.run_id = Some("run-1".to_string());
        save(&pool, &snapshot).await.unwrap();
        let second = next_report_sequence(&pool).await.unwrap();
        let restored = load(&pool).await.unwrap();

        assert!(!device_id.is_empty());
        assert_eq!(ensure_device_id(&pool).await.unwrap(), device_id);
        assert_eq!(first, 1);
        assert_eq!(second, 2);
        assert_eq!(restored.report_sequence, 2);
        assert_eq!(restored.device_id, device_id);
    }

    #[tokio::test]
    async fn concurrent_catalog_writers_preserve_received_and_committed_counts() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        save(&pool, &SyncTelemetry::default()).await.unwrap();

        let mut tasks = Vec::new();
        for _ in 0..40 {
            let pool = pool.clone();
            tasks.push(tokio::spawn(async move {
                record_catalog_received(&pool, 1).await.unwrap();
            }));
        }
        for _ in 0..40 {
            let pool = pool.clone();
            tasks.push(tokio::spawn(async move {
                let _write_guard = acquire_write_lock().await;
                let mut tx = pool.begin().await.unwrap();
                record_catalog_page_committed(&mut tx, 1).await.unwrap();
                tx.commit().await.unwrap();
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }

        let telemetry = read_stored(&pool).await.unwrap();
        assert_eq!(telemetry.catalog_received, 40);
        assert_eq!(telemetry.catalog_committed, 40);
        assert!(telemetry.catalog_committed <= telemetry.catalog_received);
    }
}