const DB_NAME = "vintrade-offline";
const DB_VERSION = 1;

const STORES = {
  items: "items",
  customers: "customers",
  pendingInvoices: "pendingInvoices",
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.items)) db.createObjectStore(STORES.items, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.customers)) db.createObjectStore(STORES.customers, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.pendingInvoices)) db.createObjectStore(STORES.pendingInvoices, { keyPath: "offlineId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putAll<T>(storeName: string, data: T[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  store.clear();
  for (const item of data) {
    store.put(item);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put<T>(storeName: string, data: T): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(data);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const offlineStore = {
  cacheItems: (data: any[]) => putAll(STORES.items, data),
  getCachedItems: () => getAll(STORES.items),

  cacheCustomers: (data: any[]) => putAll(STORES.customers, data),
  getCachedCustomers: () => getAll(STORES.customers),

  savePendingInvoice: (invoice: any) => put(STORES.pendingInvoices, invoice),
  getPendingInvoices: () => getAll(STORES.pendingInvoices),
  removePendingInvoice: (offlineId: string) => remove(STORES.pendingInvoices, offlineId),
};
