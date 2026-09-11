import type {
  CashierSession,
  Category,
  Order,
  OrderLine,
  Product,
} from "../types";

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function permissionsForRole(role: string): string[] {
  if (role === "manager") {
    return ["sell", "void_order", "void_line", "price_override", "discount", "hold", "recall", "refund", "promo_code", "reports", "end_shift"];
  }
  if (role === "supervisor") {
    return ["sell", "void_line", "price_override", "discount", "hold", "recall", "promo_code", "end_shift"];
  }
  return ["sell", "hold", "recall"];
}

export function mapCashier(value: any): CashierSession {
  return {
    cashier_id: String(value.id ?? ""),
    cashier_name: String(value.name ?? ""),
    role: value.role === "manager" || value.role === "supervisor" ? value.role : "cashier",
    pin_hash: String(value.pinHash ?? "").toLowerCase(),
    permissions: Array.isArray(value.permissions)
      ? value.permissions.map(String)
      : permissionsForRole(String(value.role ?? "")),
  };
}

export function mapCategory(value: any): Category {
  return {
    id: String(value.id ?? ""),
    server_id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    description: value.description ? String(value.description) : undefined,
    parent_id: value.parentId ? String(value.parentId) : undefined,
    vat_rate: numberValue(value.vatRate),
    active: value.active !== false,
  };
}

export function mapProduct(value: any): Product {
  return {
    id: String(value.id ?? ""),
    server_id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    sku: String(value.sku ?? ""),
    barcode: value.barcode ? String(value.barcode) : undefined,
    description: value.description ? String(value.description) : undefined,
    category_id: value.categoryId ? String(value.categoryId) : undefined,
    price1: numberValue(value.price1),
    price2: numberValue(value.price2),
    price3: numberValue(value.price3),
    price4: numberValue(value.price4),
    price5: numberValue(value.price5),
    cost_price: numberValue(value.costPrice),
    vat_rate: numberValue(value.vatRate),
    unit_type: String(value.unitType ?? "unit"),
    pack_size: numberValue(value.packSize, 1),
    stock_quantity: numberValue(value.stockQuantity),
    active: value.active !== false,
    updated_at: value.updatedAt ? String(value.updatedAt) : undefined,
    timed_price: value.timedPrice == null ? null : numberValue(value.timedPrice),
  };
}

export function toBillPayload(order: Order, lines: OrderLine[]) {
  return {
    orderNumber: order.order_number,
    customerId: order.customer_id,
    cashierId: order.cashier_id,
    cashierName: order.cashier_name,
    subtotal: order.subtotal,
    discountAmount: order.discount_amount,
    vatAmount: order.vat_amount,
    total: order.total,
    paymentMethod: order.payment_method ?? "cash",
    amountTendered: order.amount_tendered ?? order.total,
    changeDue: order.change_due ?? 0,
    status: order.status,
    createdAt: order.created_at,
    notes: order.note,
    lines: lines.map((line) => ({
      itemId: line.product_id,
      description: line.description,
      sku: line.sku,
      quantity: line.qty,
      unitPrice: line.unit_price,
      discountPercent: line.line_discount_pct,
      vatRate: line.vat_rate,
      total: line.line_total,
    })),
  };
}

export function toAuditEntry(value: any) {
  return {
    localId: Number(value.id),
    cashierId: value.cashierId ?? null,
    cashierName: value.cashierName ?? null,
    action: String(value.action ?? ""),
    entity: value.entity ?? null,
    entityId: value.entityId ?? null,
    detail: value.detail ?? null,
    createdAt: String(value.timestamp ?? ""),
  };
}