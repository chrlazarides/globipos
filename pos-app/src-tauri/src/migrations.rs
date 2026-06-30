use sqlx::{Row, SqlitePool};

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Bootstrap meta table first (survives repeated calls)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )
    .execute(pool)
    .await?;

    let row = sqlx::query("SELECT value FROM schema_meta WHERE key = 'schema_version'")
        .fetch_optional(pool)
        .await?;

    let current: i32 = row
        .and_then(|r| {
            let v: Option<String> = r.try_get("value").ok();
            v.and_then(|s| s.parse().ok())
        })
        .unwrap_or(0);

    if current < 1 {
        run_v1(pool).await?;
        set_version(pool, 1).await?;
    }
    if current < 2 {
        run_v2(pool).await?;
        set_version(pool, 2).await?;
    }
    if current < 3 {
        run_v3(pool).await?;
        set_version(pool, 3).await?;
    }

    Ok(())
}

async fn set_version(pool: &SqlitePool, v: i32) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)")
        .bind(v.to_string())
        .execute(pool)
        .await?;
    Ok(())
}

async fn run_v1(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let statements = vec![
        r#"CREATE TABLE IF NOT EXISTS local_products (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            sku TEXT NOT NULL,
            barcode TEXT,
            description TEXT,
            category_id TEXT,
            price1 REAL NOT NULL DEFAULT 0,
            price2 REAL NOT NULL DEFAULT 0,
            price3 REAL NOT NULL DEFAULT 0,
            price4 REAL NOT NULL DEFAULT 0,
            price5 REAL NOT NULL DEFAULT 0,
            cost_price REAL NOT NULL DEFAULT 0,
            vat_rate REAL NOT NULL DEFAULT 0,
            unit_type TEXT NOT NULL DEFAULT 'pc',
            pack_size INTEGER NOT NULL DEFAULT 1,
            stock_quantity INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT,
            synced_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_products_sku ON local_products(sku)",
        "CREATE INDEX IF NOT EXISTS idx_products_barcode ON local_products(barcode)",
        "CREATE INDEX IF NOT EXISTS idx_products_category ON local_products(category_id)",
        r#"CREATE TABLE IF NOT EXISTS local_categories (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            parent_id TEXT,
            vat_rate REAL NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            synced_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        r#"CREATE TABLE IF NOT EXISTS local_layout (
            position INTEGER PRIMARY KEY,
            label TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6b7280',
            icon TEXT,
            button_type TEXT NOT NULL DEFAULT 'item',
            item_id TEXT,
            category_id TEXT,
            action_code TEXT
        )"#,
        r#"CREATE TABLE IF NOT EXISTS pos_orders (
            id TEXT PRIMARY KEY,
            order_number TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'active',
            customer_id TEXT,
            cashier_id TEXT NOT NULL,
            cashier_name TEXT NOT NULL,
            price_level INTEGER NOT NULL DEFAULT 1,
            order_discount_pct REAL NOT NULL DEFAULT 0,
            order_discount_fixed REAL NOT NULL DEFAULT 0,
            subtotal REAL NOT NULL DEFAULT 0,
            discount_amount REAL NOT NULL DEFAULT 0,
            vat_amount REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            note TEXT,
            payment_method TEXT,
            amount_tendered REAL,
            change_due REAL,
            payment_ref TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        r#"CREATE TABLE IF NOT EXISTS pos_order_lines (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
            product_id TEXT,
            description TEXT NOT NULL,
            sku TEXT,
            qty REAL NOT NULL,
            unit_price REAL NOT NULL,
            override_price REAL,
            line_discount_pct REAL NOT NULL DEFAULT 0,
            line_discount_fixed REAL NOT NULL DEFAULT 0,
            vat_rate REAL NOT NULL DEFAULT 0,
            line_total REAL NOT NULL,
            vat_amount REAL NOT NULL DEFAULT 0,
            note TEXT,
            voided INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_order_lines_order ON pos_order_lines(order_id)",
        r#"CREATE TABLE IF NOT EXISTS pos_outbox (
            id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_outbox_status ON pos_outbox(status)",
        r#"CREATE TABLE IF NOT EXISTS pos_inbox (
            id TEXT PRIMARY KEY,
            server_id TEXT UNIQUE,
            message_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            processed INTEGER NOT NULL DEFAULT 0,
            processed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        r#"CREATE TABLE IF NOT EXISTS price_overrides (
            product_id TEXT NOT NULL,
            override_price REAL NOT NULL,
            valid_from TEXT,
            valid_until TEXT,
            reason TEXT NOT NULL DEFAULT 'inbox',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (product_id, valid_from)
        )"#,
        r#"CREATE TABLE IF NOT EXISTS pos_shifts (
            id TEXT PRIMARY KEY,
            cashier_id TEXT NOT NULL,
            cashier_name TEXT NOT NULL,
            opened_at TEXT NOT NULL DEFAULT (datetime('now')),
            closed_at TEXT,
            opening_float REAL NOT NULL DEFAULT 0,
            closing_cash REAL,
            total_cash_sales REAL NOT NULL DEFAULT 0,
            total_card_sales REAL NOT NULL DEFAULT 0,
            total_sales REAL NOT NULL DEFAULT 0,
            total_voids REAL NOT NULL DEFAULT 0,
            order_count INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'open'
        )"#,
        r#"CREATE TABLE IF NOT EXISTS cashiers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pin_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'cashier',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        r#"CREATE TABLE IF NOT EXISTS sync_fallback_config (
            rule_key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            offline_behavior TEXT NOT NULL DEFAULT 'block',
            description TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        r#"CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_type TEXT NOT NULL,
            status TEXT NOT NULL,
            message TEXT,
            items_synced INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        r#"CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cashier_id TEXT,
            cashier_name TEXT,
            action TEXT NOT NULL,
            entity TEXT,
            entity_id TEXT,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
    ];

    for sql in statements {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

async fn run_v3(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let statements = vec![
        // Extend pos_shifts with notes column
        "ALTER TABLE pos_shifts ADD COLUMN notes TEXT",
        // Extend local_products with Phase 3 fields
        "ALTER TABLE local_products ADD COLUMN age_restricted INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE local_products ADD COLUMN min_age INTEGER NOT NULL DEFAULT 18",
        "ALTER TABLE local_products ADD COLUMN deposit_amount REAL NOT NULL DEFAULT 0",
        "ALTER TABLE local_products ADD COLUMN weight_based INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE local_products ADD COLUMN plu_code TEXT",
        "ALTER TABLE local_products ADD COLUMN price_per_kg REAL",
        "ALTER TABLE local_products ADD COLUMN category_name TEXT",
        // Promotions cache (synced from server)
        r#"CREATE TABLE IF NOT EXISTS local_promotions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'buy_n_get_m',
            product_ids TEXT NOT NULL DEFAULT '[]',
            category_ids TEXT NOT NULL DEFAULT '[]',
            threshold_qty INTEGER NOT NULL DEFAULT 1,
            get_qty INTEGER NOT NULL DEFAULT 0,
            threshold_price REAL NOT NULL DEFAULT 0,
            bundle_price REAL NOT NULL DEFAULT 0,
            discount_pct REAL NOT NULL DEFAULT 0,
            discount_fixed REAL NOT NULL DEFAULT 0,
            coupon_code TEXT,
            priority INTEGER NOT NULL DEFAULT 0,
            stackable INTEGER NOT NULL DEFAULT 0,
            valid_from TEXT,
            valid_until TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            synced_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        // Container deposits cache
        r#"CREATE TABLE IF NOT EXISTS local_container_deposits (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            deposit_amount REAL NOT NULL,
            product_ids TEXT NOT NULL DEFAULT '[]',
            category_ids TEXT NOT NULL DEFAULT '[]',
            deposit_sku TEXT NOT NULL DEFAULT 'DEPOSIT',
            active INTEGER NOT NULL DEFAULT 1,
            synced_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        // Shift events (cash-in, cash-out, no-sale)
        r#"CREATE TABLE IF NOT EXISTS shift_events (
            id TEXT PRIMARY KEY,
            shift_id TEXT NOT NULL REFERENCES pos_shifts(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL DEFAULT 'cash_in',
            amount REAL NOT NULL DEFAULT 0,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_shift_events_shift ON shift_events(shift_id)",
        // Return / refund orders
        r#"CREATE TABLE IF NOT EXISTS pos_return_orders (
            id TEXT PRIMARY KEY,
            original_order_id TEXT,
            original_order_number TEXT,
            cashier_id TEXT NOT NULL,
            cashier_name TEXT NOT NULL,
            refund_method TEXT NOT NULL DEFAULT 'cash',
            refund_total REAL NOT NULL DEFAULT 0,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'completed',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            synced_at TEXT
        )"#,
        r#"CREATE TABLE IF NOT EXISTS pos_return_order_lines (
            id TEXT PRIMARY KEY,
            return_order_id TEXT NOT NULL REFERENCES pos_return_orders(id) ON DELETE CASCADE,
            original_order_id TEXT,
            original_line_id TEXT,
            product_id TEXT,
            description TEXT NOT NULL,
            qty REAL NOT NULL,
            unit_price REAL NOT NULL,
            line_total REAL NOT NULL,
            restocked INTEGER NOT NULL DEFAULT 1
        )"#,
        "CREATE INDEX IF NOT EXISTS idx_return_lines_return ON pos_return_order_lines(return_order_id)",
        // Additive column migrations — silently ignored on fresh DBs that already have it
        "ALTER TABLE pos_orders ADD COLUMN payment_ref TEXT",
    ];

    for sql in &statements {
        // Use try_execute to handle cases where the column already exists (ALTER TABLE)
        let _ = sqlx::query(sql).execute(pool).await;
    }
    Ok(())
}

async fn run_v2(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let defaults = vec![
        ("customer_lookup",      "Customer lookup offline",          "allow",              "Allow sale to proceed without customer record when server unreachable"),
        ("loyalty_earn",         "Loyalty points earn offline",      "allow",              "Allow loyalty points to be earned offline; sync later"),
        ("loyalty_redeem",       "Loyalty points redeem offline",    "block_with_message", "Block loyalty redemption when server unreachable"),
        ("credit_check",         "Credit limit check offline",       "allow",              "Allow sale when credit check cannot be performed"),
        ("price_level_override", "Price level override offline",     "allow",              "Allow price level changes without server validation"),
        ("promo_code",           "Promo code validation offline",    "block",              "Block promo codes when server unreachable"),
        ("void_order",           "Void order requires manager",      "allow",              "Allow manager PIN void without server confirmation"),
        ("refund",               "Refund without server",            "block_with_message", "Block refunds when server unreachable"),
    ];

    for (key, label, behavior, desc) in defaults {
        sqlx::query(
            "INSERT OR IGNORE INTO sync_fallback_config (rule_key, label, offline_behavior, description) VALUES (?, ?, ?, ?)"
        )
        .bind(key)
        .bind(label)
        .bind(behavior)
        .bind(desc)
        .execute(pool)
        .await?;
    }
    Ok(())
}
