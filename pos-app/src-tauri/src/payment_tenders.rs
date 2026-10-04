use crate::models::Order;
use sqlx::Error;

fn invalid(message: &str) -> Error { Error::Protocol(message.to_string()) }
fn cents(value: f64) -> Result<i64, Error> {
    if !value.is_finite() || value.abs() > 1_000_000_000.0 { return Err(invalid("Invalid tender amount")); }
    Ok((value * 100.0).round() as i64)
}

/// Validate actual tender portions, not a guessed primary payment method.
pub fn allocation(order: &Order) -> Result<(f64, f64), Error> {
    if order.payment_tenders.is_empty() {
        // Older saved sales have no breakdown. Never guess that a legacy split was all card.
        let method = order.payment_method.as_deref().unwrap_or("cash");
        return Ok((if method == "cash" { order.total } else { 0.0 },
            if method.starts_with("card") { order.total } else { 0.0 }));
    }
    let mut paid = 0_i64;
    let mut cash = 0_i64;
    let mut card = 0_i64;
    let mut ids = std::collections::HashSet::new();
    for tender in &order.payment_tenders {
        let id = tender["id"].as_str().filter(|id| !id.is_empty()).ok_or_else(|| invalid("Tender ID required"))?;
        if !ids.insert(id) { return Err(invalid("Duplicate tender ID")); }
        let amount = cents(tender["amount"].as_f64().ok_or_else(|| invalid("Tender amount required"))?)?;
        if amount <= 0 { return Err(invalid("Tender must be positive")); }
        let method = tender["method"].as_str().unwrap_or("");
        match method {
            "cash" => cash += amount,
            "card_jcc" | "card_viva" | "card_worldpay" => {
                if tender["approved"].as_bool() != Some(true) ||
                    tender["reference"].as_str().map_or(true, |reference| reference.trim().is_empty()) {
                    return Err(invalid("Approved card tender reference required"));
                }
                card += amount;
            },
            "voucher" | "credit_note" => {
                if tender["settleId"].as_str().map_or(true, |id| id.is_empty()) {
                    return Err(invalid("Validated voucher or credit note required"));
                }
            },
            "cheque" | "loyalty" => {},
            // On-account sales retain their separate online approval flow.
            _ => return Err(invalid("Unsupported payment tender")),
        }
        paid += amount;
    }
    let change = cents(order.change_due.unwrap_or(0.0))?;
    if change < 0 || change > cash || paid - change != cents(order.total)? ||
        paid != cents(order.amount_tendered.unwrap_or(0.0))? {
        return Err(invalid("Tender totals or cash change do not reconcile"));
    }
    let method = order.payment_method.as_deref().unwrap_or("");
    let expected = if order.payment_tenders.len() > 1 { "split" }
        else { order.payment_tenders[0]["method"].as_str().unwrap_or("") };
    if method != expected { return Err(invalid("Payment method does not match tender breakdown")); }
    Ok(((cash - change) as f64 / 100.0, card as f64 / 100.0))
}