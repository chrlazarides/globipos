import type { TerminalConfig, CashierSession, Product, Category, Order, OrderLine } from "../types";
import { hashPin } from "./utils";

const DB_NAME = "globipos_terminal";
const DB_VERSION = 2; // Incremented for sync_cursor

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
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
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
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

export async function saveCatalogPage(categories: Category[] | null, products: Product[], isFirstPage: boolean): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["categories", "products"], "readwrite");
    
    if (categories && isFirstPage) {
      const catStore = t.objectStore("categories");
      catStore.clear();
      categories.forEach(c => catStore.put(c));
    }
    
    const prodStore = t.objectStore("products");
    if (isFirstPage) {
      prodStore.clear();
    }
    products.forEach(p => prodStore.put(p));
    
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
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

