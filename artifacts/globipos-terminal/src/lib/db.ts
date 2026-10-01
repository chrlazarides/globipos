import type { TerminalConfig, CashierSession, Product, Category, Order, OrderLine } from "../types";
import { hashPin } from "./utils";
import type { SyncSnapshot } from "./sync-state";

const DB_NAME = "globipos_terminal";
const DB_VERSION = 3; // Stage each catalog before replacing the active snapshot.

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      blocked = true;
      reject(new Error("Terminal storage is busy in another tab. Close other terminal tabs and retry. Do not clear offline data."));
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      if (blocked) { req.result.close(); return; }
      resolve(req.result);
    };
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cashiers")) {
        db.createObjectStore("cashiers", { keyPath: "cashier_id" });
      }
      if (!db.objectStoreNames.contains("products")) {
        const productStore = db.createObjectStore("products", { keyPath: "id" });
        productStore.createIndex("category_id", "category_id", { unique: false });
        productStore.createIndex("barcode", "barcode", { unique: false });
      }
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("products_staging")) {
        db.createObjectStore("products_staging", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("categories_staging")) {
        db.createObjectStore("categories_staging", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("orders")) {
        const orderStore = db.createObjectStore("orders", { keyPath: "id" });
        orderStore.createIndex("status", "status", { unique: false });
      }
      if (!db.objectStoreNames.contains("order_lines")) {
        const lineStore = db.createObjectStore("order_lines", { keyPath: "id" });
        lineStore.createIndex("order_id", "order_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("sync_cursor")) {
        db.createObjectStore("sync_cursor", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audit")) {
        db.createObjectStore("audit", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

async function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const req = fn(store);
    transaction.oncomplete = () => { db.close(); resolve(req.result as T); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? req.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Local save aborted")); };
  });
}

// Config
export async function getConfig(): Promise<TerminalConfig | null> {
  const config = await tx<TerminalConfig | undefined>("config", "readonly", (s) => s.get("main"));
  return config || null;
}

export async function setConfig(config: TerminalConfig): Promise<void> {
  await tx("config", "readwrite", (s) => s.put({ ...config, id: "main" }));
}

// Cashiers
export async function getSyncCursor(origin: string, terminalCode: string): Promise<string | null> {
  const doc = await tx<{id: string, cursor: string} | undefined>("sync_cursor", "readonly", s => s.get(`${origin}:${terminalCode}`));
  return doc?.cursor || null;
}

export async function saveSyncCursor(origin: string, terminalCode: string, cursor: string): Promise<void> {
  await tx("sync_cursor", "readwrite", s => s.put({ id: `${origin}:${terminalCode}`, cursor }));
}

export async function clearSyncCursor(origin: string, terminalCode: string): Promise<void> {
  await tx("sync_cursor", "readwrite", s => s.delete(`${origin}:${terminalCode}`));
}

export async function hasCatalogStaging(): Promise<boolean> {
  return (await tx<number>("products_staging", "readonly", s => s.count())) > 0 ||
    (await tx<number>("categories_staging", "readonly", s => s.count())) > 0;
}

export async function getSyncSnapshot(origin: string, terminalCode: string): Promise<SyncSnapshot | null> {
  const row = await tx<{ snapshot: SyncSnapshot } | undefined>("sync_cursor", "readonly",
    s => s.get(`status:${origin}:${terminalCode}`));
  return row?.snapshot ?? null;
}

export async function saveSyncSnapshot(origin: string, terminalCode: string, snapshot: SyncSnapshot): Promise<void> {
  await tx("sync_cursor", "readwrite", s => s.put({ id: `status:${origin}:${terminalCode}`, snapshot }));
}

/** An independent durable counter prevents delayed reports overwriting newer observations. */
export async function nextSyncReportSequence(origin: string, terminalCode: string): Promise<number> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sync_cursor", "readwrite");
    const store = transaction.objectStore("sync_cursor");
    const id = `report:${origin}:${terminalCode}`;
    let sequence = 0;
    const request = store.get(id);
    request.onsuccess = () => {
      sequence = (request.result?.sequence ?? 0) + 1;
      store.put({ id, sequence });
    };
    transaction.oncomplete = () => { db.close(); resolve(sequence); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Report counter save aborted")); };
  });
}

// Cashiers
export async function getCashiers(): Promise<CashierSession[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("cashiers", "readonly").objectStore("cashiers").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCashiers(cashiers: CashierSession[]): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("cashiers", "readwrite");
    const s = t.objectStore("cashiers");
    s.clear();
    cashiers.forEach(c => s.put(c));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function validatePin(pin: string): Promise<CashierSession | null> {
  const cashiers = await getCashiers();
  const hashed = await hashPin(pin);
  const found = cashiers.find(c => c.pin_hash === hashed);
  return found || null;
}

// Products & Categories
export async function getCategories(): Promise<Category[]> {
  return await tx<Category[]>("categories", "readonly", s => s.getAll());
}

export async function getProducts(categoryId?: string, search?: string): Promise<Product[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    let req;
    if (categoryId) {
      req = db.transaction("products", "readonly").objectStore("products").index("category_id").getAll(categoryId);
    } else {
      req = db.transaction("products", "readonly").objectStore("products").getAll();
    }
    
    req.onsuccess = () => {
      let results: Product[] = req.result;
      if (search) {
        const s = search.toLowerCase();
        results = results.filter(p => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || (p.barcode && p.barcode.toLowerCase().includes(s)));
      }
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveCatalogPage(
  categories: Category[] | null,
  products: Product[],
  isFirstPage: boolean,
  origin: string,
  terminalCode: string,
  nextCursor: string | null,
  snapshot?: SyncSnapshot,
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["categories", "products", "categories_staging", "products_staging", "sync_cursor"], "readwrite");
    
    if (isFirstPage) {
      t.objectStore("products_staging").clear();
      t.objectStore("categories_staging").clear();
    }
    if (categories && isFirstPage) categories.forEach(c => t.objectStore("categories_staging").put(c));
    products.forEach(p => t.objectStore("products_staging").put(p));

    const cursorStore = t.objectStore("sync_cursor");
    const cursorId = `${origin}:${terminalCode}`;
    if (nextCursor === null) {
      cursorStore.delete(cursorId);
      const activeProducts = t.objectStore("products");
      const stagedProducts = t.objectStore("products_staging");
      const productRequest = stagedProducts.getAll();
      productRequest.onsuccess = () => {
        activeProducts.clear();
        for (const product of productRequest.result as Product[]) activeProducts.put(product);
        stagedProducts.clear();
      };
      const activeCategories = t.objectStore("categories");
      const stagedCategories = t.objectStore("categories_staging");
      const categoryRequest = stagedCategories.getAll();
      categoryRequest.onsuccess = () => {
        activeCategories.clear();
        for (const category of categoryRequest.result as Category[]) activeCategories.put(category);
        stagedCategories.clear();
      };
    } else {
      cursorStore.put({ id: cursorId, cursor: nextCursor });
    }
    if (snapshot) cursorStore.put({ id: `status:${origin}:${terminalCode}`, snapshot });
    
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error ?? new Error("Catalog save aborted")); };
  });
}

export async function getActiveProductsCount(): Promise<number> {
  const products = await getProducts();
  return products.filter(p => p.active).length;
}

// Orders
export async function saveOrder(order: Order, lines: OrderLine[]): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["orders", "order_lines", "outbox"], "readwrite");
    const os = t.objectStore("orders");
    const ls = t.objectStore("order_lines");
    const ob = t.objectStore("outbox");
    
    os.put(order);
    lines.forEach(l => ls.put(l));
    
    ob.put({ order, lines, timestamp: Date.now() });
    
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getOutbox(): Promise<any[]> {
  return await tx<any[]>("outbox", "readonly", s => s.getAll());
}

export async function clearOutboxItem(id: number): Promise<void> {
  await tx("outbox", "readwrite", s => s.delete(id));
}

export async function confirmQueueItem(
  store: "outbox" | "audit", id: number, origin: string, terminalCode: string, snapshot: SyncSnapshot,
): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([store, "sync_cursor"], "readwrite");
    transaction.objectStore(store).delete(id);
    transaction.objectStore("sync_cursor").put({ id: `status:${origin}:${terminalCode}`, snapshot });
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Confirmation save aborted")); };
  });
}

export async function markQueueFailure(store: "outbox" | "audit", id: number, retryable: boolean): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    const request = objectStore.get(id);
    request.onsuccess = () => {
      if (request.result) objectStore.put({ ...request.result, sync_failed: true, sync_retryable: retryable });
    };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Could not save queue failure")); };
  });
}

export async function getQueueCounts() {
  const [orders, audits] = await Promise.all([getOutbox(), getAuditOutbox()]);
  return {
    outboxPending: orders.filter(item => !item.sync_failed).length,
    outboxFailed: orders.filter(item => item.sync_failed).length,
    auditPending: audits.filter(item => !item.sync_failed).length,
    auditFailed: audits.filter(item => item.sync_failed).length,
  };
}

// Audit
export async function writeAudit(
  action: string,
  entity?: string,
  entityId?: string,
  detail?: string,
  cashierId?: string,
  cashierName?: string
): Promise<void> {
  await tx("audit", "readwrite", s => s.put({
    action,
    entity,
    entityId,
    detail,
    cashierId,
    cashierName,
    timestamp: new Date().toISOString()
  }));
}

export async function getAuditOutbox(): Promise<any[]> {
  return await tx<any[]>("audit", "readonly", s => s.getAll());
}

export async function clearAuditItem(id: number): Promise<void> {
  await tx("audit", "readwrite", s => s.delete(id));
}

