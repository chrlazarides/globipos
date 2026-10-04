import type { Category, Product } from "../types";

/** Monetary digit entry is minor units; quantities/weights never use this parser. */
export function parseMoneyDigits(digits: string): number | null {
  if (!/^\d{1,8}$/.test(digits)) return null;
  return Number(digits) / 100;
}

export function categoryBranchIds(categories: Category[], categoryId: string): Set<string> {
  const ids = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.id === categoryId || category.server_id === categoryId ||
          (category.parent_id && ids.has(category.parent_id))) {
        for (const id of [category.id, category.server_id]) {
          if (!ids.has(id)) { ids.add(id); changed = true; }
        }
      }
    }
  }
  return ids;
}

export function inheritedDepartmentVat(category: Category, categories: Category[]): number | null {
  const seen = new Set<string>();
  let current: Category | undefined = category;
  while (current && !seen.has(current.server_id)) {
    seen.add(current.server_id);
    if (typeof current.vat_rate === "number" &&
        Number.isFinite(current.vat_rate) && current.vat_rate >= 0 && current.vat_rate <= 100) {
      return current.vat_rate;
    }
    current = categories.find(c => c.id === current?.parent_id || c.server_id === current?.parent_id);
  }
  return null;
}

export function departmentButtonAction(categoryId: string, digits: string, categories: Category[]) {
  const category = categories.find(c => c.active && (c.id === categoryId || c.server_id === categoryId));
  if (!category) throw new Error("This department is unavailable. Sync the catalogue and try again.");
  if (!digits) return { type: "navigate" as const, category };
  const amount = parseMoneyDigits(digits);
  const vatRate = inheritedDepartmentVat(category, categories);
  if (amount == null || amount <= 0) throw new Error("Enter a positive department amount.");
  if (vatRate == null) throw new Error("Configure this department's VAT before making a department sale.");
  return { type: "sale" as const, category: { ...category, vat_rate: vatRate }, amount };
}

export function scaleQuantity(
  product: Pick<Product, "unit_type">,
  reading: { grams: number; kg: number; stable: boolean } | null,
): number {
  if (!reading || reading.stable !== true) throw new Error("Wait for a stable scale reading and try again.");
  const unit = product.unit_type.trim().toLowerCase();
  const gramsUnit = ["g", "gr", "gram", "grams"].includes(unit);
  const value = gramsUnit ? reading.grams : reading.kg;
  if (!Number.isFinite(value) || value <= 0) throw new Error("Place the item on the scale before selecting it.");
  return value;
}

export function isWeighedProduct(product: Pick<Product, "unit_type">): boolean {
  return ["kg", "kgs", "kilogram", "kilograms", "g", "gr", "gram", "grams", "weight"]
    .includes(product.unit_type.trim().toLowerCase());
}