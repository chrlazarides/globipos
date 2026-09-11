const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a finite number`);
  return parsed;
}

function sameMoney(left: unknown, right: unknown): boolean {
  return Math.round(finiteNumber(left, "stored amount") * 100) === Math.round(finiteNumber(right, "incoming amount") * 100);
}

export function validateTerminalBill(input: any) {
  if (!input || typeof input !== "object") throw new Error("bill must be an object");
  const orderNumber = String(input.orderNumber ?? "").trim();
  if (!orderNumber || orderNumber.length > 200) throw new Error("valid orderNumber is required");
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error("at least one order line is required");

  const lines = input.lines.map((line: any, index: number) => {
    const quantity = finiteNumber(line.quantity, `lines[${index}].quantity`);
    const unitPrice = finiteNumber(line.unitPrice, `lines[${index}].unitPrice`);
    const discountPercent = finiteNumber(line.discountPercent ?? 0, `lines[${index}].discountPercent`);
    const vatRate = finiteNumber(line.vatRate ?? 0, `lines[${index}].vatRate`);
    const total = finiteNumber(line.total, `lines[${index}].total`);
    if (quantity <= 0 || unitPrice < 0 || discountPercent < 0 || discountPercent > 100 || vatRate < 0 || vatRate > 100) {
      throw new Error(`lines[${index}] contains an invalid quantity, price, discount, or VAT rate`);
    }
    const expectedTotal = money(quantity * unitPrice * (1 - discountPercent / 100));
    if (!sameMoney(total, expectedTotal)) throw new Error(`lines[${index}].total does not match its quantity and price`);
    return {
      itemId: line.itemId ? String(line.itemId) : null,
      variantId: line.variantId ? String(line.variantId) : null,
      description: String(line.description ?? ""),
      sku: line.sku ? String(line.sku) : null,
      barcode: line.barcode ? String(line.barcode) : null,
      quantity,
      unitPrice,
      discountPercent,
      vatRate,
      total: expectedTotal,
    };
  });

  const subtotal = money(lines.reduce((sum: number, line: any) => sum + line.total, 0));
  const discountAmount = finiteNumber(input.discountAmount ?? 0, "discountAmount");
  const total = money(subtotal - discountAmount);
  const vatAmount = money(lines.reduce(
    (sum: number, line: any) => sum + money(line.vatRate > 0 ? line.total - line.total / (1 + line.vatRate / 100) : 0),
    0,
  ));
  if (discountAmount < 0 || discountAmount > subtotal) throw new Error("discountAmount is invalid");
  if (!sameMoney(input.subtotal, subtotal) || !sameMoney(input.total, total) || !sameMoney(input.vatAmount, vatAmount)) {
    throw new Error("bill totals or VAT do not match its lines");
  }

  const paymentMethod = String(input.paymentMethod ?? "cash").trim().toLowerCase();
  if (paymentMethod !== "cash" && paymentMethod !== "split" && !/^card(?:_[a-z0-9-]+)?$/.test(paymentMethod)) {
    throw new Error("unsupported payment method");
  }
  const amountTendered = finiteNumber(input.amountTendered ?? total, "amountTendered");
  const changeDue = finiteNumber(input.changeDue ?? 0, "changeDue");
  if (amountTendered < 0 || changeDue < 0) throw new Error("tender and change cannot be negative");
  if (paymentMethod === "cash" && (amountTendered < total || !sameMoney(changeDue, money(amountTendered - total)))) {
    throw new Error("cash tender or change is invalid");
  }
  const cardTerminalRef = input.paymentRef ?? input.cardTerminalRef ?? null;
  if (paymentMethod.startsWith("card") && (!String(cardTerminalRef ?? "").trim() || !sameMoney(amountTendered, total) || !sameMoney(changeDue, 0))) {
    throw new Error("card payment reference, tender, or change is invalid");
  }
  if (paymentMethod === "split" && amountTendered < total) throw new Error("split tender is invalid");
  if (input.status !== "completed") throw new Error("only completed bills can be synchronized");
  const createdAt = new Date(String(input.createdAt ?? ""));
  if (Number.isNaN(createdAt.getTime())) throw new Error("valid createdAt device sale timestamp is required");

  return {
    orderNumber,
    shiftId: input.shiftId ? String(input.shiftId) : null,
    customerId: input.customerId ? String(input.customerId) : null,
    cashierId: input.cashierId ? String(input.cashierId) : null,
    cashierName: input.cashierName ? String(input.cashierName) : null,
    subtotal,
    discountAmount,
    vatAmount,
    total,
    paymentMethod,
    amountTendered,
    changeDue,
    status: "completed",
    createdAt,
    cardTerminalRef,
    notes: input.notes ? String(input.notes) : null,
    receiptPrinted: Boolean(input.receiptPrinted),
    lines,
  };
}

export function terminalBillMatchesExisting(existing: any, bill: ReturnType<typeof validateTerminalBill>): boolean {
  const fields = ["subtotal", "discountAmount", "vatAmount", "total", "amountTendered", "changeDue"] as const;
  const textFields = ["orderNumber", "shiftId", "customerId", "cashierId", "cashierName", "paymentMethod", "status", "cardTerminalRef", "notes"] as const;
  if (
    textFields.some((field) => (existing[field] ?? null) !== (bill[field] ?? null)) ||
    fields.some((field) => !sameMoney(existing[field] ?? 0, bill[field])) ||
    Boolean(existing.receiptPrinted) !== bill.receiptPrinted
  ) return false;
  if (new Date(existing.createdAt).getTime() !== bill.createdAt.getTime()) return false;
  if (!Array.isArray(existing.lines) || existing.lines.length !== bill.lines.length) return false;
  const canonicalLine = (line: any) => JSON.stringify({
    itemId: line.itemId ?? null, variantId: line.variantId ?? null,
    description: line.description, sku: line.sku ?? null, barcode: line.barcode ?? null,
    quantity: Math.round(Number(line.quantity) * 1000),
    unitPrice: Math.round(Number(line.unitPrice) * 100),
    discountPercent: Math.round(Number(line.discountPercent) * 100),
    vatRate: Math.round(Number(line.vatRate) * 100),
    total: Math.round(Number(line.total) * 100),
  });
  const storedLines = existing.lines.map(canonicalLine).sort();
  const incomingLines = bill.lines.map(canonicalLine).sort();
  return storedLines.every((line: string, index: number) => line === incomingLines[index]);
}