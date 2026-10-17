// Test entry only. All calculations below come from production, not test copies.
export * as pricing from "../../pos-app/src/lib/pricing";
export * as tenders from "../../pos-app/src/lib/paymentTenders";
export * as cards from "../../pos-app/src/lib/cardPayment";
export * as terminal from "../../artifacts/globipos-terminal/src/lib/pos-calculations";
export * as invoice from "../../artifacts/api-server/src/pos-invoice-pricing";
export * as credit from "../../artifacts/globipos-terminal/src/lib/customer-invoice";
export * as loyalty from "../../artifacts/api-server/src/loyalty-policy";
export * as bills from "../../artifacts/api-server/src/terminal-bill";
export * as stock from "../../artifacts/api-server/src/pos-stock-in-service";
export { useMultiBuy, evalBuyNGetM, evalQtyThreshold, evalMixMatch, evalMealDeal }
  from "../../pos-app/src/hooks/useMultiBuy";
