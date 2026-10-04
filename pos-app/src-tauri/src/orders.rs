use crate::models::{Order, OrderLine};
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

/// Persist an order and its lines; enqueue completed orders in the outbox.
pub async fn save_order(
    pool: &SqlitePool,
    order: &Order,
    lines: &[OrderLine],
    terminal_id: &str,
    location_id: &str,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let incoming_payload = build_outbox_payload(order, lines, terminal_id, location_id);
    if let Some(previous) = sqlx::query("SELECT status FROM pos_orders WHERE id = ?")
        .bind(&order.id).fetch_optional(&mut *tx).await? {
        if previous.get::<String, _>("status") == "completed" {
            let saved = sqlx::query("SELECT payload FROM pos_outbox WHERE order_id = ?")
                .bind(&order.id).fetch_optional(&mut *tx).await?;
            let matches = saved.and_then(|row| serde_json::from_str::<serde_json::Value>(&row.get::<String, _>("payload")).ok())
                .map_or(false, |payload| payload == incoming_payload);
            if !matches { return Err(sqlx::Error::Protocol("A completed sale cannot be overwritten with different payment data".into())); }
            tx.commit().await?;
            return Ok(());
        }
    }
    let allocation = if order.status == "completed" {
        Some(crate::payment_tenders::allocation(order)?)
    } else { None };
    // Upsert the order row
    sqlx::query(
        r#"INSERT OR REPLACE INTO pos_orders
            (id, order_number, status, customer_id, cashier_id, cashier_name,
             price_level, order_discount_pct, order_discount_fixed,
             subtotal, discount_amount, vat_amount, total,
             note, payment_method, amount_tendered, change_due, payment_ref, surcharge_pct, payment_tenders, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))"#
    )
    .bind(&order.id)
    .bind(&order.order_number)
    .bind(&order.status)
    .bind(&order.customer_id)
    .bind(&order.cashier_id)
    .bind(&order.cashier_name)
    .bind(order.price_level)
    .bind(order.order_discount_pct)
    .bind(order.order_discount_fixed)
    .bind(order.subtotal)
    .bind(order.discount_amount)
    .bind(order.vat_amount)
    .bind(order.total)
    .bind(&order.note)
    .bind(&order.payment_method)
    .bind(order.amount_tendered)
    .bind(order.change_due)
    .bind(&order.payment_ref)
    .bind(order.surcharge_pct)
    .bind(serde_json::to_string(&order.payment_tenders).map_err(|e| sqlx::Error::Protocol(e.to_string()))?)
    .execute(&mut *tx)
    .await?;

    // Delete existing lines (in case of update)
    sqlx::query("DELETE FROM pos_order_lines WHERE order_id = ?")
        .bind(&order.id)
        .execute(&mut *tx)
        .await?;

    // Insert lines
    for (i, line) in lines.iter().enumerate() {
        let voided = line.voided as i32;
        sqlx::query(
            r#"INSERT INTO pos_order_lines
                (id, order_id, product_id, description, sku, qty, unit_price, override_price,
                 line_discount_pct, line_discount_fixed, line_surcharge_pct, vat_rate, line_total, vat_amount,
                 note, voided, sort_order, price_includes_vat, category_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"#
        )
        .bind(&line.id)
        .bind(&order.id)
        .bind(&line.product_id)
        .bind(&line.description)
        .bind(&line.sku)
        .bind(line.qty)
        .bind(line.unit_price)
        .bind(line.override_price)
        .bind(line.line_discount_pct)
        .bind(line.line_discount_fixed)
        .bind(line.line_surcharge_pct)
        .bind(line.vat_rate)
        .bind(line.line_total)
        .bind(line.vat_amount)
        .bind(&line.note)
        .bind(voided)
        .bind(i as i32)
        .bind(line.price_includes_vat)
        .bind(&line.category_id)
        .execute(&mut *tx)
        .await?;
    }

    // Enqueue completed orders in outbox for sync
    if order.status == "completed" {
        let payload = incoming_payload;
        let outbox_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO pos_outbox (id, order_id, payload, status, attempts) VALUES (?,?,?,'pending',0)"
        )
        .bind(outbox_id)
        .bind(&order.id)
        .bind(serde_json::to_string(&payload).unwrap_or_default())
        .execute(&mut *tx)
        .await?;
        for tender in &order.payment_tenders {
            let table = match tender["method"].as_str() {
                Some("voucher") => "pos_gift_vouchers",
                Some("credit_note") => "pos_credit_notes",
                _ => continue,
            };
            let amount = tender["amount"].as_f64().unwrap_or(0.0);
            let id = tender["settleId"].as_str().unwrap_or("");
            let redeemed = sqlx::query(&format!(
                "UPDATE {table} SET remaining = round(remaining - ?, 2),
                 status = CASE WHEN round(remaining - ?, 2) <= 0 THEN 'redeemed' ELSE 'open' END,
                 redeemed_at = CASE WHEN round(remaining - ?, 2) <= 0 THEN datetime('now') ELSE redeemed_at END
                 WHERE id = ? AND status = 'open' AND remaining + 0.001 >= ?"
            )).bind(amount).bind(amount).bind(amount).bind(id).bind(amount)
                .execute(&mut *tx).await?;
            if redeemed.rows_affected() != 1 {
                return Err(sqlx::Error::Protocol("Voucher or credit note balance changed. Sale was not saved; verify any approved card payment.".into()));
            }
        }
        if let Some((cash, card)) = allocation {
            if let Some(shift) = sqlx::query("SELECT id FROM pos_shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1")
                .fetch_optional(&mut *tx).await? {
                let shift_id: String = shift.get("id");
                let recorded = sqlx::query("INSERT OR IGNORE INTO pos_order_shift_receipts (order_id, shift_id) VALUES (?, ?)")
                    .bind(&order.id).bind(&shift_id).execute(&mut *tx).await?;
                if recorded.rows_affected() == 1 {
                    sqlx::query("UPDATE pos_shifts SET total_cash_sales = total_cash_sales + ?,
                        total_card_sales = total_card_sales + ?, total_sales = total_sales + ?,
                        order_count = order_count + 1 WHERE id = ?")
                        .bind(cash).bind(card).bind(order.total).bind(&shift_id).execute(&mut *tx).await?;
                }
            }
        }
    }

    tx.commit().await?;
    Ok(())
}

fn build_outbox_payload(
    order: &Order,
    lines: &[OrderLine],
    terminal_id: &str,
    location_id: &str,
) -> serde_json::Value {
    let line_values: Vec<serde_json::Value> = lines
        .iter()
        .map(|l| serde_json::json!({
            "itemId":        l.product_id,
            "categoryId":    l.category_id,
            "description":   l.description,
            "sku":           l.sku,
            "quantity":      l.qty,
            "unitPrice":     l.override_price.unwrap_or(l.unit_price),
            "priceIncludesVat": l.price_includes_vat,
            "discountPercent": l.line_discount_pct,
            "discountFixed": l.line_discount_fixed,
            "surchargePercent": l.line_surcharge_pct,
            "vatRate":       l.vat_rate,
            "total":         l.line_total,
            "vatAmount":     l.vat_amount,
            "voided":        l.voided,
            "note":          l.note,
        }))
        .collect();

    serde_json::json!({
        "pricingMode":   "native-net-v1",
        "terminalId":    terminal_id,
        "locationId":    location_id,
        "orderNumber":   order.order_number,
        "customerId":    order.customer_id,
        "cashierId":     order.cashier_id,
        "cashierName":   order.cashier_name,
        "subtotal":      order.subtotal,
        "discountAmount":order.discount_amount,
        "orderDiscountPercent": order.order_discount_pct,
        "orderDiscountFixed": order.order_discount_fixed,
        "surchargePercent": order.surcharge_pct,
        "vatAmount":     order.vat_amount,
        "total":         order.total,
        "paymentMethod": order.payment_method,
        "amountTendered":order.amount_tendered,
        "changeDue":     order.change_due,
        "paymentRef":    order.payment_ref,
        "paymentTenders": order.payment_tenders,
        "status":        order.status,
        "notes":         order.note,
        "lines":         line_values,
        "createdAt":     order.created_at,
    })
}

#[cfg(test)]
mod payment_tests {
    use super::*;
    fn sale(tenders: serde_json::Value, tendered: f64, change: f64) -> Order {
        serde_json::from_value(serde_json::json!({
            "id":"split-test", "order_number":"SPLIT-0001", "status":"completed",
            "cashier_id":"cashier", "cashier_name":"Cashier", "price_level":1,
            "order_discount_pct":0, "order_discount_fixed":0, "subtotal":30,
            "discount_amount":0, "vat_amount":0, "total":30, "payment_method":"split",
            "amount_tendered":tendered, "change_due":change, "payment_tenders":tenders,
            "created_at":"2026-10-04T12:00:00Z"
        })).unwrap()
    }
    fn split() -> Order {
        sale(serde_json::json!([
            {"id":"cash", "method":"cash", "amount":10, "label":"Cash"},
            {"id":"card", "method":"card_jcc", "amount":20, "approved":true, "reference":"APPROVED", "label":"Card (JCC)"}
        ]), 30.0, 0.0)
    }
    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        crate::migrations::run_migrations(&pool).await.unwrap();
        sqlx::query("INSERT INTO pos_shifts (id, cashier_id, cashier_name) VALUES ('shift', 'cashier', 'Cashier')")
            .execute(&pool).await.unwrap();
        pool
    }
    #[tokio::test]
    async fn split_save_outbox_shift_and_retry_are_consistent() {
        let pool = pool().await;
        let order = split();
        save_order(&pool, &order, &[], "terminal", "location").await.unwrap();
        save_order(&pool, &order, &[], "terminal", "location").await.unwrap();
        let shift = sqlx::query("SELECT * FROM pos_shifts").fetch_one(&pool).await.unwrap();
        assert_eq!(shift.get::<f64, _>("total_cash_sales"), 10.0);
        assert_eq!(shift.get::<f64, _>("total_card_sales"), 20.0);
        assert_eq!(shift.get::<i64, _>("order_count"), 1);
        let saved = sqlx::query("SELECT payment_tenders FROM pos_orders").fetch_one(&pool).await.unwrap();
        let tenders: serde_json::Value = serde_json::from_str(&saved.get::<String, _>("payment_tenders")).unwrap();
        assert_eq!(tenders, serde_json::json!(order.payment_tenders));
        let payload = sqlx::query("SELECT payload FROM pos_outbox").fetch_all(&pool).await.unwrap();
        assert_eq!(payload.len(), 1);
        let body: serde_json::Value = serde_json::from_str(&payload[0].get::<String, _>("payload")).unwrap();
        assert_eq!(body["paymentTenders"], tenders);
        let mut changed = order.clone();
        changed.payment_tenders[0]["amount"] = serde_json::json!(15);
        changed.payment_tenders[1]["amount"] = serde_json::json!(15);
        assert!(save_order(&pool, &changed, &[], "terminal", "location").await.is_err());
    }
    #[tokio::test]
    async fn cash_change_is_not_counted_as_sales() {
        let pool = pool().await;
        let mut order = split();
        order.payment_tenders[0]["amount"] = serde_json::json!(15);
        order.amount_tendered = Some(35.0);
        order.change_due = Some(5.0);
        save_order(&pool, &order, &[], "terminal", "location").await.unwrap();
        let shift = sqlx::query("SELECT * FROM pos_shifts").fetch_one(&pool).await.unwrap();
        assert_eq!(shift.get::<f64, _>("total_cash_sales"), 10.0);
        assert_eq!(shift.get::<f64, _>("total_card_sales"), 20.0);
    }
    #[tokio::test]
    async fn failed_voucher_settlement_rolls_back_the_whole_sale() {
        let pool = pool().await;
        sqlx::query("INSERT INTO pos_gift_vouchers (id, code, amount, remaining, cashier_id, cashier_name) VALUES ('gift', 'GIFT', 2, 2, 'test', 'Test')")
            .execute(&pool).await.unwrap();
        let order = sale(serde_json::json!([
            {"id":"cash", "method":"cash", "amount":25},
            {"id":"voucher", "method":"voucher", "amount":5, "settleId":"gift"}
        ]), 30.0, 0.0);
        assert!(save_order(&pool, &order, &[], "terminal", "location").await.is_err());
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM pos_orders").fetch_one(&pool).await.unwrap(), 0);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM pos_outbox").fetch_one(&pool).await.unwrap(), 0);
        assert_eq!(sqlx::query_scalar::<_, i64>("SELECT order_count FROM pos_shifts").fetch_one(&pool).await.unwrap(), 0);
    }
    #[tokio::test]
    async fn voucher_balance_is_settled_once_in_the_sale_transaction() {
        let pool = pool().await;
        sqlx::query("INSERT INTO pos_gift_vouchers (id, code, amount, remaining, cashier_id, cashier_name) VALUES ('gift', 'GIFT', 20, 20, 'test', 'Test')")
            .execute(&pool).await.unwrap();
        let order = sale(serde_json::json!([
            {"id":"cash", "method":"cash", "amount":25},
            {"id":"voucher", "method":"voucher", "amount":5, "settleId":"gift"}
        ]), 30.0, 0.0);
        save_order(&pool, &order, &[], "terminal", "location").await.unwrap();
        save_order(&pool, &order, &[], "terminal", "location").await.unwrap();
        assert_eq!(sqlx::query_scalar::<_, f64>("SELECT remaining FROM pos_gift_vouchers").fetch_one(&pool).await.unwrap(), 15.0);
    }
    #[test]
    fn invalid_card_reference_and_non_cash_change_are_rejected() {
        let mut order = split();
        order.payment_tenders[1]["reference"] = serde_json::json!("");
        assert!(crate::payment_tenders::allocation(&order).is_err());
        let order = sale(serde_json::json!([
            {"id":"card", "method":"card_jcc", "amount":40, "approved":true, "reference":"APPROVED"}
        ]), 40.0, 10.0);
        assert!(crate::payment_tenders::allocation(&order).is_err());
    }
}

#[cfg(test)]
mod grocery_tests {
    use super::*;

    #[tokio::test]
    async fn weighed_and_gross_department_lines_survive_hold_recall_and_outbox() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
            .connect("sqlite::memory:").await.unwrap();
        crate::migrations::run_migrations(&pool).await.unwrap();
        let mut order: Order = serde_json::from_value(serde_json::json!({
            "id":"test-grocery", "order_number":"TEST-GROCERY", "status":"held",
            "cashier_id":"test", "cashier_name":"Test", "price_level":1,
            "order_discount_pct":0, "order_discount_fixed":0,
            "subtotal":4.43, "discount_amount":0, "vat_amount":0.22, "total":4.65,
            "created_at":"2026-10-04T12:00:00Z"
        })).unwrap();
        let department: OrderLine = serde_json::from_value(serde_json::json!({
            "id":"dept", "order_id":order.id, "category_id":"fruit", "description":"Fruit department",
            "qty":1, "unit_price":2.30, "price_includes_vat":true,
            "line_discount_pct":0, "line_discount_fixed":0, "vat_rate":5,
            "line_total":2.30, "vat_amount":0.11, "voided":false
        })).unwrap();
        let weight = crate::scale_simulator::ScaleSimulation::default().read().unwrap();
        let mut banana = department.clone();
        banana.id = "banana-line".into();
        banana.product_id = Some("banana".into());
        banana.qty = weight.kg;
        banana.unit_price = 2.99;
        banana.price_includes_vat = false;
        banana.line_total = 2.35;
        let lines = vec![department, banana];
        save_order(&pool, &order, &lines, "test-till", "test-shop").await.unwrap();
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM pos_outbox")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(count.0, 0, "Held orders must not upload");
        let restored: (f64, i64, Option<String>) = sqlx::query_as(
            "SELECT line_total, price_includes_vat, product_id FROM pos_order_lines WHERE id='dept'"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(restored, (2.30, 1, None));
        // Recall preserves amounts; completion then uses the real native outbox builder.
        order.status = "active".into();
        save_order(&pool, &order, &lines, "test-till", "test-shop").await.unwrap();
        order.status = "completed".into();
        save_order(&pool, &order, &lines, "test-till", "test-shop").await.unwrap();
        let payload: (String,) = sqlx::query_as("SELECT payload FROM pos_outbox WHERE order_id=?")
            .bind(&order.id).fetch_one(&pool).await.unwrap();
        let json: serde_json::Value = serde_json::from_str(&payload.0).unwrap();
        assert_eq!(json["lines"][0]["total"], 2.30);
        assert_eq!(json["lines"][0]["priceIncludesVat"], true);
        assert!(json["lines"][0]["itemId"].is_null(), "Department sale must not identify SKU stock");
        assert_eq!(json["lines"][1]["quantity"], 0.75);
        assert_eq!(json["lines"][1]["total"], 2.35);
        let persisted: (f64,) = sqlx::query_as("SELECT qty FROM pos_order_lines WHERE id='banana-line'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(persisted.0, 0.75);
    }
}

/// Generate the next sequential order number.
pub async fn next_order_number(pool: &SqlitePool, prefix: &str) -> Result<String, sqlx::Error> {
    let pattern = format!("{}%", prefix);
    let row = sqlx::query("SELECT COUNT(*) as cnt FROM pos_orders WHERE order_number LIKE ?")
        .bind(&pattern)
        .fetch_one(pool)
        .await?;
    let cnt: i64 = row.try_get("cnt").unwrap_or(0);
    Ok(format!("{}{:06}", prefix, cnt + 1))
}
