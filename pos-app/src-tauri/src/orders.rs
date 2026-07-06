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
    // Upsert the order row
    sqlx::query(
        r#"INSERT OR REPLACE INTO pos_orders
            (id, order_number, status, customer_id, cashier_id, cashier_name,
             price_level, order_discount_pct, order_discount_fixed,
             subtotal, discount_amount, vat_amount, total,
             note, payment_method, amount_tendered, change_due, payment_ref, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))"#
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
    .execute(pool)
    .await?;

    // Delete existing lines (in case of update)
    sqlx::query("DELETE FROM pos_order_lines WHERE order_id = ?")
        .bind(&order.id)
        .execute(pool)
        .await?;

    // Insert lines
    for (i, line) in lines.iter().enumerate() {
        let voided = line.voided as i32;
        sqlx::query(
            r#"INSERT INTO pos_order_lines
                (id, order_id, product_id, description, sku, qty, unit_price, override_price,
                 line_discount_pct, line_discount_fixed, line_surcharge_pct, vat_rate, line_total, vat_amount,
                 note, voided, sort_order)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"#
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
        .execute(pool)
        .await?;
    }

    // Enqueue completed orders in outbox for sync
    if order.status == "completed" {
        let payload = build_outbox_payload(order, lines, terminal_id, location_id);
        let outbox_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO pos_outbox (id, order_id, payload, status, attempts) VALUES (?,?,?,'pending',0)"
        )
        .bind(outbox_id)
        .bind(&order.id)
        .bind(serde_json::to_string(&payload).unwrap_or_default())
        .execute(pool)
        .await?;
    }

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
            "description":   l.description,
            "sku":           l.sku,
            "quantity":      l.qty,
            "unitPrice":     l.unit_price,
            "discountPercent": l.line_discount_pct,
            "vatRate":       l.vat_rate,
            "total":         l.line_total,
            "vatAmount":     l.vat_amount,
            "voided":        l.voided,
            "note":          l.note,
        }))
        .collect();

    serde_json::json!({
        "terminalId":    terminal_id,
        "locationId":    location_id,
        "orderNumber":   order.order_number,
        "customerId":    order.customer_id,
        "cashierId":     order.cashier_id,
        "cashierName":   order.cashier_name,
        "subtotal":      order.subtotal,
        "discountAmount":order.discount_amount,
        "vatAmount":     order.vat_amount,
        "total":         order.total,
        "paymentMethod": order.payment_method,
        "amountTendered":order.amount_tendered,
        "changeDue":     order.change_due,
        "paymentRef":    order.payment_ref,
        "status":        order.status,
        "notes":         order.note,
        "lines":         line_values,
        "createdAt":     order.created_at,
    })
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
