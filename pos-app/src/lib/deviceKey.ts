import { load } from "@tauri-apps/plugin-store";
import type { TerminalConfig } from "../types";

const FILE = "device_key.json";
export const DEVICE_KEY_EVENT = "globipos:device-key-changed";

export function deviceKeyScope(config: Pick<TerminalConfig, "server_url" | "terminal_code">): string {
  return JSON.stringify([config.server_url.trim().replace(/\/+$/, ""), config.terminal_code.trim().toUpperCase()]);
}

/** Device credentials must not be carried over to a different server or till. */
export async function readDeviceKey(config: TerminalConfig, migrateLegacy = false): Promise<string> {
  try {
    const store = await load(FILE);
    const field = `voucher_device_key:${deviceKeyScope(config)}`;
    let value = await store.get<string>(field);
    // Only migrate when opening an already configured installation, never while
    // registering a new target. Keep the legacy value until the scoped copy saves.
    const legacyScope = await store.get<string>("legacy_device_key_scope");
    if (!value && migrateLegacy && (!legacyScope || legacyScope === deviceKeyScope(config))) {
      const legacy = await store.get<string>("voucher_device_key");
      if (typeof legacy === "string" && legacy) {
        await store.set(field, legacy);
        await store.set("legacy_device_key_scope", deviceKeyScope(config));
        await store.save();
        await store.delete("voucher_device_key");
        await store.save();
        value = legacy;
      }
    }
    return typeof value === "string" ? value : "";
  } catch { return ""; }
}

export async function writeDeviceKey(key: string, config: TerminalConfig): Promise<void> {
  const store = await load(FILE);
  const trimmed = key.trim();
  const scope = deviceKeyScope(config);
  const field = `voucher_device_key:${scope}`;
  if (trimmed) await store.set(field, trimmed); else await store.delete(field);
  await store.save();
  window.dispatchEvent(new CustomEvent(DEVICE_KEY_EVENT, { detail: { scope, key: trimmed } }));
}
