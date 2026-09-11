import { getConfig, saveCatalogPage, getOutbox, clearOutboxItem, saveCashiers, getSyncCursor, saveSyncCursor, clearSyncCursor, getActiveProductsCount, getAuditOutbox, clearAuditItem, setConfig } from "./db";
import type { Category, Product, CashierSession, TerminalConfig } from "../types";
import { fetchOnce, fetchWithRetry, normalizeServerUrl } from "./utils";
import { mapCashier, mapCategory, mapProduct, toAuditEntry, toBillPayload } from "./terminal-contract";

export async function registerTerminal(serverUrl: string, terminalCode: string): Promise<TerminalConfig> {
  const origin = normalizeServerUrl(serverUrl);
  
  const text = await fetchOnce(`${origin}/api/pos/terminals/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminalCode, catalogSyncVersion: 1 })
  });
  
  const data = JSON.parse(text);
  
  if (!data?.terminal?.id || !data?.terminal?.name || !data?.location?.id || !data?.location?.name) {
    throw new Error("Terminal registration response is incomplete");
  }
  const config: TerminalConfig = {
    server_url: origin,
    terminal_code: terminalCode,
    terminal_id: data.terminal?.id || "",
    terminal_name: data.terminal?.name || "",
    location_id: data.location?.id || "",
    location_name: data.location?.name || "",
    price_level: data.terminal?.priceLevel || 1,
    initial_sync_complete: false,
  };
  
  if (Array.isArray(data.cashiers)) await saveCashiers(data.cashiers.map(mapCashier));
  
  await setConfig(config);
  return config;
}

export async function syncCashiers(): Promise<void> {
  const config = await getConfig();
  if (!config) throw new Error("No config available");
  
  const text = await fetchWithRetry(`${config.server_url}/api/pos/sync/cashiers`, {
    headers: { "X-Terminal-Code": config.terminal_code }
  });
  
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Cashier sync response is invalid");
  const cashiers: CashierSession[] = data.map(mapCashier);
  
  await saveCashiers(cashiers);
}

export async function syncCatalog(onProgress?: (progress: number) => void): Promise<number> {
  const config = await getConfig();
  if (!config) throw new Error("No config available");
  
  const limit = 250;
  const baseUrl = config.server_url;
  let cursor = await getSyncCursor(baseUrl, config.terminal_code);
  let firstPage = cursor === null;
  
  while (true) {
    const url = new URL(`${baseUrl}/api/sync/catalog`);
    url.searchParams.set("limit", limit.toString());
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    
    const text = await fetchWithRetry(url.toString(), {
      headers: { "X-Terminal-Code": config.terminal_code }
    });
    
    const data = JSON.parse(text);
    if (!Array.isArray(data.items) || !Array.isArray(data.categories) || typeof data.done !== "boolean") {
      throw new Error("Catalog sync response is invalid");
    }
    if (!data.done && (typeof data.nextCursor !== "string" || !data.nextCursor)) {
      throw new Error("Catalog sync response is missing nextCursor");
    }
    const categories: Category[] = data.categories.map(mapCategory);
    const products: Product[] = data.items.map(mapProduct);
    
    await saveCatalogPage(
      categories.length > 0 ? categories : null, 
      products, 
      firstPage
    );
    
    if (data.done) {
      await clearSyncCursor(baseUrl, config.terminal_code);
      if (onProgress) onProgress(100);
      break;
    }
    const nextCursor = data.nextCursor as string;
    cursor = nextCursor;
    await saveSyncCursor(baseUrl, config.terminal_code, nextCursor);
    firstPage = false;
  }
  
  return getActiveProductsCount();
}

let activeFlush: Promise<number> | null = null;

async function performOutboxFlush(): Promise<number> {
  const config = await getConfig();
  if (!config) return 0;
  
  const outbox = await getOutbox();
  let synced = 0;
  const baseUrl = config.server_url;
  
  for (const item of outbox) {
    try {
      const bill = toBillPayload(item.order, item.lines);
      const text = await fetchOnce(`${baseUrl}/api/sync/bills`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Terminal-Code": config.terminal_code
        },
        body: JSON.stringify({ bills: [bill] })
      });
      const response = JSON.parse(text);
      const result = response?.results?.find((entry: any) => entry.orderNumber === bill.orderNumber);
      if (result?.status !== "ok") throw new Error(result?.message || "Order was not accepted");
      await clearOutboxItem(item.id);
      synced++;
    } catch (e) {
      console.error("Failed to sync outbox item", item.id, e);
    }
  }

  const audits = await getAuditOutbox();
  for (const item of audits) {
    try {
      const text = await fetchOnce(`${baseUrl}/api/pos/sync/audit-logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Terminal-Code": config.terminal_code
        },
        body: JSON.stringify({ entries: [toAuditEntry(item)] })
      });
      const response = JSON.parse(text);
      if (response?.status !== "ok") throw new Error("Audit record was not accepted");
      await clearAuditItem(item.id);
    } catch (e) {
      console.error("Failed to sync audit item", item.id, e);
    }
  }
  
  return synced;
}

export function flushOutbox(): Promise<number> {
  if (activeFlush) return activeFlush;
  activeFlush = performOutboxFlush().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}
