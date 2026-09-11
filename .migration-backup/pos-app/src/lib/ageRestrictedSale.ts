import type { Product } from "../types";

export interface PendingAgeCheck {
  product: Product;
  qty: number;
  priceOverride?: number;
}

interface ProductAdder {
  (product: Product, qty?: number, priceOverride?: number): void;
}

interface AgeAudit {
  (action: "age_verify_passed" | "age_verify_refused", product: Product): void;
}

function addProductAndDeposit(
  pending: PendingAgeCheck,
  addProduct: ProductAdder,
): void {
  addProduct(pending.product, pending.qty, pending.priceOverride);

  const depositAmount = (pending.product as Product & { deposit_amount?: number }).deposit_amount;
  if (!depositAmount || depositAmount <= 0) return;

  const depositProduct: Product = {
    ...pending.product,
    id: `deposit-${pending.product.id}`,
    server_id: `deposit-${pending.product.server_id ?? pending.product.id}`,
    name: `Deposit - ${pending.product.name}`,
    sku: `DEP-${pending.product.sku ?? ""}`,
    price1: depositAmount,
    price2: depositAmount,
    price3: depositAmount,
    price4: depositAmount,
    price5: depositAmount,
  };
  addProduct(depositProduct, pending.qty);
}

export function requestProductAddition(
  pending: PendingAgeCheck,
  addProduct: ProductAdder,
  requestAgeCheck: (pending: PendingAgeCheck) => void,
): void {
  const restricted = (pending.product as Product & { age_restricted?: boolean }).age_restricted;
  if (restricted) {
    requestAgeCheck(pending);
    return;
  }

  addProductAndDeposit(pending, addProduct);
}

export function resolveAgeCheck(
  pending: PendingAgeCheck,
  approved: boolean,
  addProduct: ProductAdder,
  audit: AgeAudit,
): void {
  if (approved) {
    addProductAndDeposit(pending, addProduct);
    audit("age_verify_passed", pending.product);
    return;
  }

  audit("age_verify_refused", pending.product);
}
