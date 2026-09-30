import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAvailableStock,
  PosStockInError,
  receivePosStock,
  stockInRequestHash,
  type PosStockInInput,
} from "./pos-stock-in-service";

const request: PosStockInInput = {
  itemId: "item-1",
  variantId: null,
  locationId: "location-1",
  terminalId: "terminal-1",
  cashierId: "cashier-1",
  idempotencyKey: "stock-in-request-1",
  quantity: 4,
};

test("stock-in request fingerprints are stable and bind identity, location, cashier, and quantity", () => {
  assert.equal(stockInRequestHash(request), stockInRequestHash({ ...request }));
  assert.notEqual(stockInRequestHash(request), stockInRequestHash({ ...request, quantity: 5 }));
  assert.notEqual(stockInRequestHash(request), stockInRequestHash({ ...request, variantId: "variant-1" }));
  assert.notEqual(stockInRequestHash(request), stockInRequestHash({ ...request, locationId: "location-2" }));
});

test("stock availability subtracts reserved units without returning a negative balance", () => {
  assert.equal(calculateAvailableStock(12, 5), 7);
  assert.equal(calculateAvailableStock(2, 3), 0);
  assert.equal(calculateAvailableStock(8, 0), 8);
});

test("stock-in rejects zero, negative, and fractional quantities before opening a transaction", async () => {
  for (const quantity of [0, -1, 1.5]) {
    await assert.rejects(
      receivePosStock({ ...request, quantity }, {
        connect: async () => { throw new Error("database should not be reached"); },
      } as any),
      (error: unknown) => error instanceof PosStockInError && error.code === "INVALID_QUANTITY",
    );
  }
});