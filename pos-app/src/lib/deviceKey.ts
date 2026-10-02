import { load } from "@tauri-apps/plugin-store";

const FILE = "device_key.json";
export const DEVICE_KEY_EVENT = "globipos:device-key-changed";

/** Kept in its own store so saving or re-registering terminal config can never clear it. */
export async function readDeviceKey(): Promise<string> {
  try {
    const store = await load(FILE);
    const value = await store.get<string>("voucher_device_key");
    return typeof value === "string" ? value : "";
  } catch { return ""; }
}

export async function writeDeviceKey(key: string): Promise<void> {
  const store = await load(FILE);
  const trimmed = key.trim();
  if (trimmed) await store.set("voucher_device_key", trimmed); else await store.delete("voucher_device_key");
  await store.save();
  window.dispatchEvent(new CustomEvent(DEVICE_KEY_EVENT, { detail: trimmed }));
}
