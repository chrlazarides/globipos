export interface StorageStatus {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: string; code?: number; cause?: unknown };
  return value.name === "QuotaExceededError" ||
    value.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    value.code === 22 ||
    value.code === 1014 ||
    (value.cause != null && isQuotaError(value.cause));
}

export function storageWriteError(error: unknown, operation: "catalog" | "order"): unknown {
  if (!isQuotaError(error)) return error;
  return new Error(operation === "catalog"
    ? "Browser storage is full. Catalog sync stopped. Connect to the internet and send pending orders, then free device space or use a device with more storage before retrying. Do not clear site data while orders are pending."
    : "Browser storage is full. This order was not saved. Do not close the sale or clear site data. Free device space or ask a manager for help, then retry.", { cause: error });
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  if (!navigator.storage?.persist) return undefined;
  try {
    return await navigator.storage.persist();
  } catch {
    return undefined;
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = navigator.storage;
  if (!storage) return {};
  const [estimate, persisted] = await Promise.all([
    storage.estimate?.().catch(() => undefined),
    storage.persisted?.().catch(() => undefined),
  ]);
  return { usage: estimate?.usage, quota: estimate?.quota, persisted };
}

export function isStorageLow(status: StorageStatus): boolean {
  return status.quota !== undefined && status.usage !== undefined &&
    status.quota > 0 && status.quota - status.usage < Math.min(status.quota * 0.1, 100 * 1024 * 1024);
}