//! Unit tests for the GlobiPOS Terminal backend.
//!
//! Tests are grouped into two modules:
//! - `unit`   — pure functions, no I/O required
//! - `db`     — async tests that run against an in-memory SQLite database

// ── Pure / unit tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod unit {
    use crate::auth::hash_pin;
    use crate::models::*;

    // --- PIN hashing ---

    #[test]
    fn hash_pin_produces_64_char_hex() {
        let h = hash_pin("1234");
        assert_eq!(h.len(), 64, "SHA-256 hex should be 64 chars");
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()), "all chars should be hex digits");
    }

    #[test]
    fn hash_pin_is_deterministic() {
        assert_eq!(hash_pin("0000"), hash_pin("0000"));
        assert_eq!(hash_pin("super-secret"), hash_pin("super-secret"));
    }

    #[test]
    fn hash_pin_different_inputs_differ() {
        assert_ne!(hash_pin("1234"), hash_pin("4321"));
        assert_ne!(hash_pin(""), hash_pin("0"));
    }

    #[test]
    fn hash_pin_known_sha256_value() {
        // SHA-256("1234") is well-known and stable
        assert_eq!(
            hash_pin("1234"),
            "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"
        );
    }

    #[test]
    fn hash_pin_empty_string() {
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        let h = hash_pin("");
        assert_eq!(h.len(), 64);
        assert_eq!(&h[..4], "e3b0");
    }

    // --- TerminalConfig serde ---

    #[test]
    fn terminal_config_round_trips_through_json() {
        let cfg = TerminalConfig {
            server_url:        "https://globipos.example.com".to_string(),
            terminal_code:     "T001".to_string(),
            terminal_id:       "tid-abc".to_string(),
            terminal_name:     "Main Till".to_string(),
            location_id:       "loc-1".to_string(),
            location_name:     "Main Store".to_string(),
            price_level:       1,
            mirror_server_url: None,
            sco_mode:          None,
        };
        let json = serde_json::to_string(&cfg).expect("should serialise");
        let cfg2: TerminalConfig = serde_json::from_str(&json).expect("should deserialise");
        assert_eq!(cfg2.server_url, "https://globipos.example.com");
        assert_eq!(cfg2.terminal_code, "T001");
        assert_eq!(cfg2.price_level, 1);
        assert!(cfg2.mirror_server_url.is_none());
        assert!(cfg2.sco_mode.is_none());
    }

    #[test]
    fn terminal_config_omits_none_optional_fields_in_json() {
        let cfg = TerminalConfig {
            server_url:        "https://x.com".to_string(),
            terminal_code:     "T002".to_string(),
            terminal_id:       "t2".to_string(),
            terminal_name:     "T2".to_string(),
            location_id:       "l2".to_string(),
            location_name:     "L2".to_string(),
            price_level:       2,
            mirror_server_url: None,
            sco_mode:          None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        // skip_serializing_if = "Option::is_none" — these keys must be absent
        assert!(!json.contains("mirror_server_url"), "mirror_server_url should be omitted");
        assert!(!json.contains("sco_mode"), "sco_mode should be omitted");
    }

    #[test]
    fn terminal_config_includes_optional_fields_when_set() {
        let cfg = TerminalConfig {
            server_url:        "https://x.com".to_string(),
            terminal_code:     "T003".to_string(),
            terminal_id:       "t3".to_string(),
            terminal_name:     "T3".to_string(),
            location_id:       "l3".to_string(),
            location_name:     "L3".to_string(),
            price_level:       3,
            mirror_server_url: Some("https://mirror.example.com".to_string()),
            sco_mode:          Some(true),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("mirror_server_url"));
        assert!(json.contains("sco_mode"));
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["sco_mode"], true);
        assert_eq!(v["mirror_server_url"], "https://mirror.example.com");
    }

    // --- Order / OrderLine model ---

    #[test]
    fn order_line_vat_arithmetic() {
        // net = qty × price × (1 - discount_pct/100)
        // vat = net × vat_rate/100
        let qty = 3.0_f64;
        let unit_price = 10.0_f64;
        let discount_pct = 10.0_f64;
        let vat_rate = 19.0_f64;

        let net = qty * unit_price * (1.0 - discount_pct / 100.0);
        let vat = net * (vat_rate / 100.0);
        let total = net + vat;

        assert!((net   - 27.00).abs() < 0.001, "net should be 27.00");
        assert!((vat   -  5.13).abs() < 0.001, "vat should be 5.13");
        assert!((total - 32.13).abs() < 0.001, "total should be 32.13");
    }

    #[test]
    fn order_line_zero_vat() {
        let net = 100.0_f64;
        let vat = net * 0.0;
        assert_eq!(vat, 0.0);
        assert_eq!(net + vat, 100.0);
    }

    #[test]
    fn order_line_full_discount() {
        let net = 50.0_f64 * (1.0 - 100.0 / 100.0);
        assert_eq!(net, 0.0);
    }

    // --- OrderLine serde ---

    #[test]
    fn order_line_round_trips_through_json() {
        let line = OrderLine {
            id:                  "line-1".to_string(),
            order_id:            "order-1".to_string(),
            product_id:          Some("prod-a".to_string()),
            description:         "Bottle of Wine".to_string(),
            sku:                 Some("WIN-001".to_string()),
            qty:                 2.0,
            unit_price:          15.50,
            override_price:      None,
            line_discount_pct:   0.0,
            line_discount_fixed: 0.0,
            line_surcharge_pct:  0.0,
            vat_rate:            19.0,
            line_total:          31.00,
            vat_amount:          4.95,
            note:                None,
            voided:              false,
        };
        let json = serde_json::to_string(&line).unwrap();
        let line2: OrderLine = serde_json::from_str(&json).unwrap();
        assert_eq!(line2.description, "Bottle of Wine");
        assert!((line2.unit_price - 15.50).abs() < 0.001);
        assert!(!line2.voided);
    }

    // --- SyncStatus ---

    #[test]
    fn sync_status_defaults_are_sane() {
        let s = SyncStatus {
            online:            false,
            syncing:           false,
            last_catalog_sync: None,
            last_inbox_sync:   None,
            outbox_pending:    0,
            outbox_failed:     0,
        };
        assert!(!s.online);
        assert!(!s.syncing);
        assert_eq!(s.outbox_pending, 0);
        assert_eq!(s.outbox_failed, 0);
    }

    // --- CashierSession serde ---

    #[test]
    fn cashier_session_round_trips() {
        let s = CashierSession {
            cashier_id:   "csh-1".to_string(),
            cashier_name: "Alice".to_string(),
            role:         "manager".to_string(),
            pin_hash:     hash_pin("0000"),
            permissions:  vec!["sell".to_string(), "void_order".to_string()],
        };
        let json = serde_json::to_string(&s).unwrap();
        let s2: CashierSession = serde_json::from_str(&json).unwrap();
        assert_eq!(s2.cashier_name, "Alice");
        assert_eq!(s2.role, "manager");
        assert!(s2.permissions.contains(&"sell".to_string()));
    }

    // --- order_number format ---

    #[test]
    fn order_number_format_is_padded_6_digits() {
        // mirrors the logic in orders::next_order_number
        let prefix = "T001-";
        let count: i64 = 42;
        let num = format!("{}{:06}", prefix, count + 1);
        assert_eq!(num, "T001-000043");
    }

    #[test]
    fn order_number_first_ever() {
        let prefix = "POS-";
        let count: i64 = 0;
        let num = format!("{}{:06}", prefix, count + 1);
        assert_eq!(num, "POS-000001");
    }
}

// ── Database / async tests ───────────────────────────────────────────────────

#[cfg(test)]
mod db {
    use sqlx::SqlitePool;
    use crate::auth;

    /// Boot a minimal in-memory SQLite DB with just the `cashiers` table.
    async fn setup() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("in-memory SQLite should open");

        sqlx::query(
            r#"CREATE TABLE cashiers (
                id       TEXT PRIMARY KEY,
                name     TEXT NOT NULL,
                pin_hash TEXT NOT NULL,
                role     TEXT NOT NULL DEFAULT 'cashier',
                active   INTEGER NOT NULL DEFAULT 1
            )"#,
        )
        .execute(&pool)
        .await
        .expect("cashiers table should create");

        pool
    }

    #[tokio::test]
    async fn upsert_and_validate_manager_pin() {
        let pool = setup().await;
        auth::upsert_cashier(&pool, "c-1", "Alice", "9999", "manager")
            .await
            .expect("upsert should succeed");

        let session = auth::validate_pin(&pool, "9999")
            .await
            .expect("validate_pin should not error");

        let s = session.expect("session should be Some for correct PIN");
        assert_eq!(s.cashier_name, "Alice");
        assert_eq!(s.role, "manager");
        assert!(s.permissions.contains(&"void_order".to_string()), "manager needs void_order");
        assert!(s.permissions.contains(&"reports".to_string()), "manager needs reports");
    }

    #[tokio::test]
    async fn wrong_pin_returns_none() {
        let pool = setup().await;
        auth::upsert_cashier(&pool, "c-2", "Bob", "1111", "cashier")
            .await
            .unwrap();

        let result = auth::validate_pin(&pool, "0000").await.unwrap();
        assert!(result.is_none(), "wrong PIN should return None");
    }

    #[tokio::test]
    async fn pre_hashed_cashier_validates_correctly() {
        let pool = setup().await;
        let hash = auth::hash_pin("7777");
        auth::upsert_cashier_with_hash(&pool, "c-3", "Charlie", &hash, "supervisor")
            .await
            .unwrap();

        let session = auth::validate_pin(&pool, "7777").await.unwrap();
        let s = session.expect("pre-hashed PIN should work");
        assert_eq!(s.role, "supervisor");
        assert!(s.permissions.contains(&"price_override".to_string()));
    }

    #[tokio::test]
    async fn upsert_updates_existing_cashier() {
        let pool = setup().await;
        auth::upsert_cashier(&pool, "c-4", "Dave", "1234", "cashier").await.unwrap();
        // Update name + role
        auth::upsert_cashier(&pool, "c-4", "David", "1234", "supervisor").await.unwrap();

        let session = auth::validate_pin(&pool, "1234").await.unwrap().unwrap();
        assert_eq!(session.cashier_name, "David");
        assert_eq!(session.role, "supervisor");
    }

    #[tokio::test]
    async fn inactive_cashier_cannot_log_in() {
        let pool = setup().await;
        auth::upsert_cashier(&pool, "c-5", "Eve", "5555", "cashier").await.unwrap();

        // Deactivate
        sqlx::query("UPDATE cashiers SET active = 0 WHERE id = ?")
            .bind("c-5")
            .execute(&pool)
            .await
            .unwrap();

        let session = auth::validate_pin(&pool, "5555").await.unwrap();
        assert!(session.is_none(), "inactive cashier should not authenticate");
    }

    #[tokio::test]
    async fn multiple_cashiers_resolve_to_correct_one() {
        let pool = setup().await;
        auth::upsert_cashier(&pool, "c-10", "Cashier A", "1111", "cashier").await.unwrap();
        auth::upsert_cashier(&pool, "c-11", "Cashier B", "2222", "supervisor").await.unwrap();
        auth::upsert_cashier(&pool, "c-12", "Cashier C", "3333", "manager").await.unwrap();

        let a = auth::validate_pin(&pool, "1111").await.unwrap().unwrap();
        let b = auth::validate_pin(&pool, "2222").await.unwrap().unwrap();
        let c = auth::validate_pin(&pool, "3333").await.unwrap().unwrap();

        assert_eq!(a.cashier_name, "Cashier A");
        assert_eq!(b.role, "supervisor");
        assert_eq!(c.role, "manager");
    }
}
