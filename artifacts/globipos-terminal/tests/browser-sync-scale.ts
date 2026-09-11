import {
  getCategories,
  getProducts,
  getSyncCursor,
  saveCatalogPage,
  saveSyncCursor,
  setConfig,
} from "../src/lib/db";
import { syncCatalog } from "../src/lib/sync";

const TOTAL_PRODUCTS = 130_000;
const PAGE_SIZE = 250;
const SERVER_ORIGIN = "https://catalog-scale-test.example";
const TERMINAL_CODE = "SCALE-TERMINAL";

const query = new URLSearchParams(location.search);
const stopAfter = Number(query.get("stopAfter") ?? TOTAL_PRODUCTS);
const killDuringOffset = query.has("killDuringOffset") ? Number(query.get("killDuringOffset")) : null;
const killStage = query.get("killStage");
const verifyRecovery = query.get("verifyRecovery") === "true";
const verifyFinalRecovery = query.get("verifyFinalRecovery") === "true";
const seedExistingCatalog = query.get("seedExistingCatalog") === "true";
const verifyFreshReplacement = query.get("verifyFreshReplacement") === "true";
const result = document.querySelector<HTMLPreElement>("#result");

function catalogItem(index: number) {
  return {
    id: `product-${index.toString().padStart(6, "0")}`,
    name: `Scale product ${index}`,
    sku: `SKU-${index}`,
    barcode: `200${index.toString().padStart(10, "0")}`,
    categoryId: `category-${index % 20}`,
    price1: (index % 10_000) / 100,
    price2: 0,
    price3: 0,
    price4: 0,
    price5: 0,
    costPrice: 0,
    vatRate: 19,
    unitType: "unit",
    packSize: 1,
    stockQuantity: index % 500,
    active: true,
  };
}

async function run() {
  await setConfig({
    server_url: SERVER_ORIGIN,
    terminal_code: TERMINAL_CODE,
    terminal_id: "scale-terminal-id",
    terminal_name: "Scale terminal",
    location_id: "scale-location-id",
    location_name: "Scale location",
    price_level: 1,
  });

  if (seedExistingCatalog) {
    const oldProducts = Array.from({ length: PAGE_SIZE }, (_, index) => ({
      ...catalogItem(index),
      id: `old-product-${index.toString().padStart(6, "0")}`,
      name: `Old product ${index}`,
      categoryId: "old-category",
    }));
    await saveCatalogPage(
      [{ id: "old-category", name: "Old category", vatRate: 19, active: true }],
      oldProducts,
      true,
      SERVER_ORIGIN,
      TERMINAL_CODE,
      null,
    );
    result!.dataset.status = "passed";
    result!.textContent = JSON.stringify({
      status: "passed",
      productCount: (await getProducts()).length,
      categoryCount: (await getCategories()).length,
    });
    return;
  }

  const startingCursor = await getSyncCursor(SERVER_ORIGIN, TERMINAL_CODE);
  const productsBeforeRecovery = verifyRecovery || verifyFinalRecovery || verifyFreshReplacement ? await getProducts() : [];
  const categoriesBeforeRecovery = verifyFreshReplacement ? await getCategories() : [];
  let freshRecoveryState: "old" | "replacement" | null = null;
  let finalRecoveryState: "rolled-back" | "committed" | null = null;
  if (verifyRecovery) {
    const expectedCursor = String(killDuringOffset);
    if (startingCursor !== expectedCursor) {
      throw new Error(`Partially committed page advanced cursor: expected ${expectedCursor}, found ${startingCursor}`);
    }
    if (productsBeforeRecovery.length !== killDuringOffset) {
      throw new Error(`Partially committed page saved products: expected ${killDuringOffset}, found ${productsBeforeRecovery.length}`);
    }
  }
  if (verifyFreshReplacement) {
    const ids = productsBeforeRecovery.map((product) => product.id);
    const hasOnlyOldProducts = ids.length === PAGE_SIZE && ids.every((id) => id.startsWith("old-product-"));
    const hasOnlyReplacementProducts = ids.length === PAGE_SIZE && ids.every((id) => id.startsWith("product-"));
    const hasOnlyOldCategories = categoriesBeforeRecovery.length === 1
      && categoriesBeforeRecovery[0]?.id === "old-category";
    const hasOnlyReplacementCategories = categoriesBeforeRecovery.length === 20
      && categoriesBeforeRecovery.every((category) => category.id.startsWith("category-"));
    const recoveredOldCatalog = hasOnlyOldProducts && hasOnlyOldCategories;
    const recoveredReplacementCatalog = hasOnlyReplacementProducts && hasOnlyReplacementCategories;
    if (!recoveredOldCatalog && !recoveredReplacementCatalog) {
      throw new Error(`Fresh replacement recovered a mixed catalog: ${ids.slice(0, 10).join(", ")}`);
    }
    freshRecoveryState = recoveredOldCatalog ? "old" : "replacement";
    const expectedCursor = freshRecoveryState === "old" ? null : String(PAGE_SIZE);
    if (startingCursor !== expectedCursor) {
      throw new Error(`Fresh replacement state ${freshRecoveryState} retained cursor ${startingCursor}`);
    }
  }
  if (verifyFinalRecovery) {
    const finalPageOffset = TOTAL_PRODUCTS - PAGE_SIZE;
    const rolledBack = startingCursor === String(finalPageOffset)
      && productsBeforeRecovery.length === finalPageOffset;
    const committed = startingCursor === null
      && productsBeforeRecovery.length === TOTAL_PRODUCTS;
    if (!rolledBack && !committed) {
      throw new Error(
        `Final page and cursor deletion were not atomic: found ${productsBeforeRecovery.length} products with cursor ${startingCursor}`,
      );
    }
    finalRecoveryState = rolledBack ? "rolled-back" : "committed";
  }
  const requestedOffsets: number[] = [];
  let writeCount = 0;
  let categoryWriteCount = 0;
  let killStageReached = false;
  const originalPut = IDBObjectStore.prototype.put;
  const originalClear = IDBObjectStore.prototype.clear;
  const originalDelete = IDBObjectStore.prototype.delete;
  const pauseTransaction = (store: IDBObjectStore, stage: string) => {
    if (killStageReached) return;
    killStageReached = true;
    result!.dataset.status = "writing";
    result!.textContent = JSON.stringify({
      cursor: startingCursor,
      killDuringOffset,
      killStage: stage,
      writeCount,
    });
    const productStore = store.transaction.objectStore("products");
    let keepAliveWrites = 0;
    const keepTransactionAlive = () => {
      const request = originalPut.call(productStore, catalogItem(0));
      request.onsuccess = () => {
        keepAliveWrites += 1;
        if (keepAliveWrites < 100_000) keepTransactionAlive();
      };
    };
    keepTransactionAlive();
  };
  if (!verifyRecovery && (killDuringOffset !== null || killStage !== null)) {
    IDBObjectStore.prototype.clear = function (...args: Parameters<IDBObjectStore["clear"]>) {
      const request = originalClear.apply(this, args);
      if (killStage === "after-category-clear" && this.name === "categories" && requestedOffsets.at(-1) === 0) {
        pauseTransaction(this, killStage);
      }
      return request;
    };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "categories" && requestedOffsets.at(-1) === 0) {
        categoryWriteCount += 1;
        if (killStage === "during-category-writes" && categoryWriteCount === 10) {
          pauseTransaction(this, killStage);
        }
      }
      if (this.name === "products" && requestedOffsets.at(-1) === killDuringOffset) {
        writeCount += 1;
        if (writeCount === 50 && (killStage === null || killStage === "during-product-writes")) {
          pauseTransaction(this, killStage ?? "during-product-writes");
        }
      }
      const request = originalPut.apply(this, args);
      if (killStage === "before-commit" && this.name === "sync_cursor" && requestedOffsets.at(-1) === 0) {
        pauseTransaction(this, killStage);
      }
      return request;
    };
    IDBObjectStore.prototype.delete = function (...args: Parameters<IDBObjectStore["delete"]>) {
      const request = originalDelete.apply(this, args);
      if (killStage === "before-commit" && this.name === "sync_cursor" && requestedOffsets.at(-1) === 0) {
        pauseTransaction(this, killStage);
      }
      return request;
    };
  }
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    requestedOffsets.push(offset);

    if (offset === stopAfter && stopAfter < TOTAL_PRODUCTS) {
      return new Response(JSON.stringify({ interrupted: true }), { status: 200 });
    }

    const end = Math.min(offset + PAGE_SIZE, TOTAL_PRODUCTS);
    const done = end === TOTAL_PRODUCTS;
    const items = Array.from({ length: end - offset }, (_, pageIndex) =>
      catalogItem(offset + pageIndex),
    );
    const categories = offset === 0
      ? Array.from({ length: 20 }, (_, index) => ({
          id: `category-${index}`,
          name: `Category ${index}`,
          vatRate: 19,
          active: true,
        }))
      : [];

    return new Response(JSON.stringify({
      items,
      categories,
      done,
      nextCursor: done ? null : String(end),
    }), { status: 200 });
  };

  let interrupted = false;
  if (finalRecoveryState !== "committed") {
    try {
      await syncCatalog();
    } catch (error) {
      if (stopAfter >= TOTAL_PRODUCTS || !(error instanceof Error) || error.message !== "Catalog sync response is invalid") {
        throw error;
      }
      interrupted = true;
    }
  }

  const products = await getProducts();
  const cursor = await getSyncCursor(SERVER_ORIGIN, TERMINAL_CODE);

  if (stopAfter < TOTAL_PRODUCTS) {
    if (!interrupted) throw new Error(`Expected interruption at ${stopAfter}`);
    if (products.length !== stopAfter) {
      throw new Error(`Expected ${stopAfter} saved products, found ${products.length}`);
    }
    if (cursor !== String(stopAfter)) {
      throw new Error(`Expected saved cursor ${stopAfter}, found ${cursor}`);
    }
    const expectedStart = Number(startingCursor ?? "0");
    if (requestedOffsets[0] !== expectedStart) {
      throw new Error(`Expected sync to start at ${expectedStart}, requested ${requestedOffsets[0]}`);
    }
  } else {
    const categories = await getCategories();
    if (products.length !== TOTAL_PRODUCTS) {
      throw new Error(`Expected ${TOTAL_PRODUCTS} products, found ${products.length}`);
    }
    const ids = new Set(products.map((product) => product.id));
    if (ids.size !== TOTAL_PRODUCTS) {
      throw new Error(`Expected ${TOTAL_PRODUCTS} unique products, found ${ids.size}`);
    }
    for (let index = 0; index < TOTAL_PRODUCTS; index += 1) {
      const id = `product-${index.toString().padStart(6, "0")}`;
      if (!ids.has(id)) throw new Error(`Missing ${id}`);
    }
    const categoryIds = new Set(categories.map((category) => category.id));
    if (categoryIds.size !== 20 || categories.length !== 20) {
      throw new Error(`Expected 20 unique categories, found ${categoryIds.size} unique among ${categories.length}`);
    }
    for (let index = 0; index < 20; index += 1) {
      const id = `category-${index}`;
      if (!categoryIds.has(id)) throw new Error(`Missing ${id}`);
    }
    if (cursor !== null) throw new Error(`Completed sync retained cursor ${cursor}`);

    await saveSyncCursor("https://other-origin.example", TERMINAL_CODE, "origin-cursor");
    await saveSyncCursor(SERVER_ORIGIN, "OTHER-TERMINAL", "terminal-cursor");
    if (await getSyncCursor(SERVER_ORIGIN, TERMINAL_CODE) !== null) {
      throw new Error("Completed terminal cursor was contaminated by another key");
    }
    if (await getSyncCursor("https://other-origin.example", TERMINAL_CODE) !== "origin-cursor") {
      throw new Error("Cursor was not isolated by server origin");
    }
    if (await getSyncCursor(SERVER_ORIGIN, "OTHER-TERMINAL") !== "terminal-cursor") {
      throw new Error("Cursor was not isolated by terminal code");
    }
  }

  result!.dataset.status = "passed";
  result!.textContent = JSON.stringify({
    status: "passed",
    stopAfter,
    productCount: products.length,
    categoryCount: (await getCategories()).length,
    cursor,
    firstRequestedOffset: requestedOffsets[0],
    pagesRequested: requestedOffsets.length,
    productsBeforeRecovery: productsBeforeRecovery.length,
    categoriesBeforeRecovery: categoriesBeforeRecovery.length,
    freshRecoveryState,
    finalRecoveryState,
  });
}

run().catch((error) => {
  result!.dataset.status = "failed";
  result!.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
});