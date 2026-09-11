import { getProducts, getSyncCursor, saveSyncCursor, setConfig } from "../src/lib/db";
import { syncCatalog } from "../src/lib/sync";

const TOTAL_PRODUCTS = 130_000;
const PAGE_SIZE = 250;
const SERVER_ORIGIN = "https://catalog-scale-test.example";
const TERMINAL_CODE = "SCALE-TERMINAL";

const query = new URLSearchParams(location.search);
const stopAfter = Number(query.get("stopAfter") ?? TOTAL_PRODUCTS);
const killDuringOffset = query.has("killDuringOffset") ? Number(query.get("killDuringOffset")) : null;
const verifyRecovery = query.get("verifyRecovery") === "true";
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

  const startingCursor = await getSyncCursor(SERVER_ORIGIN, TERMINAL_CODE);
  const productsBeforeRecovery = verifyRecovery ? await getProducts() : [];
  if (verifyRecovery) {
    const expectedCursor = String(killDuringOffset);
    if (startingCursor !== expectedCursor) {
      throw new Error(`Partially committed page advanced cursor: expected ${expectedCursor}, found ${startingCursor}`);
    }
    if (productsBeforeRecovery.length !== killDuringOffset) {
      throw new Error(`Partially committed page saved products: expected ${killDuringOffset}, found ${productsBeforeRecovery.length}`);
    }
  }
  const requestedOffsets: number[] = [];
  let writeCount = 0;
  const originalPut = IDBObjectStore.prototype.put;
  if (!verifyRecovery && killDuringOffset !== null) {
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "products" && requestedOffsets.at(-1) === killDuringOffset) {
        writeCount += 1;
        if (writeCount === 50) {
          result!.dataset.status = "writing";
          result!.textContent = JSON.stringify({ cursor: startingCursor, killDuringOffset, writeCount });
          let keepAliveWrites = 0;
          const keepTransactionAlive = () => {
            const request = originalPut.call(this, args[0]);
            request.onsuccess = () => {
              keepAliveWrites += 1;
              if (keepAliveWrites < 100_000) keepTransactionAlive();
            };
          };
          keepTransactionAlive();
        }
      }
      return originalPut.apply(this, args);
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
  try {
    await syncCatalog();
  } catch (error) {
    if (stopAfter >= TOTAL_PRODUCTS || !(error instanceof Error) || error.message !== "Catalog sync response is invalid") {
      throw error;
    }
    interrupted = true;
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
    cursor,
    firstRequestedOffset: requestedOffsets[0],
    pagesRequested: requestedOffsets.length,
    productsBeforeRecovery: productsBeforeRecovery.length,
  });
}

run().catch((error) => {
  result!.dataset.status = "failed";
  result!.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
});