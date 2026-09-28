import type { TerminalConfig } from "../types";

export function isSameTerminalIdentity(a: TerminalConfig, b: TerminalConfig): boolean {
  const origin = (value: string) => {
    try {
      return new URL(value).origin;
    } catch {
      return value.trim().replace(/\/+$/, "").toLowerCase();
    }
  };

  return origin(a.server_url) === origin(b.server_url)
    && a.terminal_code.trim().toUpperCase() === b.terminal_code.trim().toUpperCase()
    && a.terminal_id === b.terminal_id
    && a.location_id === b.location_id;
}