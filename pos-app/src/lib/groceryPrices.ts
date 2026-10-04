import type { PrintReceiptLine } from "../hooks/useHardware";

export type GroceryPriceEntry = { itemId: string; name: string; sku: string; unit: string; price: number; effectivePrice: number };
export type GroceryPriceList = { priceLevel: number; locationId: string; categoryId: string; categoryName: string; scope: string; items: GroceryPriceEntry[] };
export type GroceryMacroStep = { code: string; conditions: { receiptSign: string; transactionType: string }[] };

export function dailyPriceStepMatches(step: GroceryMacroStep, total: number, isReturn: boolean) {
  return step.conditions.every(c =>
    (c.transactionType === "any" || c.transactionType === (isReturn ? "return" : "sale")) &&
    (c.receiptSign === "any" || (c.receiptSign === "positive" && total > 0) ||
      (c.receiptSign === "negative" && total < 0) || (c.receiptSign === "zero" && total === 0)));
}

export function parseDailyPrice(text: string): number {
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(text.trim())) throw new Error("Enter a positive price per kg with at most two decimal places.");
  const value = Number(text.trim().replace(",", "."));
  if (value <= 0 || value > 100_000) throw new Error("Price per kg must be above zero and at most 100,000.");
  return value;
}

export function dailyPriceChanges(list: GroceryPriceList, drafts: Record<string, string>) {
  return list.items.flatMap(item => {
    const draft = drafts[item.itemId];
    if (draft === undefined || !draft.trim()) return [];
    const price = parseDailyPrice(draft);
    return price === item.effectivePrice ? [] : [{ itemId: item.itemId, price, previousPrice: item.price }];
  });
}

export function dailyPriceReceipt(list: GroceryPriceList, locationName: string, now = new Date()): PrintReceiptLine[] {
  return [
    { text: "UPDATED PRICE LIST", align: "center", bold: true },
    { text: locationName, align: "center" },
    { text: list.categoryName, align: "center", bold: true },
    { text: `Price level ${list.priceLevel} • EUR` },
    { text: now.toLocaleString("en-GB", { timeZone: "Europe/Nicosia" }) },
    { divider: true },
    ...list.items.flatMap(item => [
      { text: `${item.sku} ${item.name}` },
      { text: `EUR ${item.effectivePrice.toFixed(2)} / ${item.unit}`, align: "right" as const },
    ]),
    { divider: true },
    { text: "Shared level: all locations using it." },
  ];
}