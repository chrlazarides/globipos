import type { LayoutColumnConfig } from "../hooks/useWindowSize";

function cacheKey(serverUrl: string, terminalCode: string) {
  return `globipos:layout-presentation:${serverUrl.replace(/\/+$/, "")}:${terminalCode}`;
}

function validConfig(value: unknown): value is LayoutColumnConfig {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return ["columns", "colsTablet", "colsMobile", "colsLarge", "colsTV"].every(key =>
    typeof data[key] === "number" && Number.isInteger(data[key]) &&
    (data[key] as number) >= 1 && (data[key] as number) <= 12
  ) && ["standard", "light", "fresh"].includes(String(data.colorTheme ?? "standard"));
}

export function readCachedLayoutConfig(serverUrl: string, terminalCode: string): LayoutColumnConfig | null {
  try {
    const raw = localStorage.getItem(cacheKey(serverUrl, terminalCode));
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return validConfig(data) ? data : null;
  } catch {
    return null;
  }
}

export function writeCachedLayoutConfig(serverUrl: string, terminalCode: string, value: unknown): void {
  if (!validConfig(value)) return;
  // Presentation only: never persist live external approvals or monetary credentials.
  const { columns, colsTablet, colsMobile, colsLarge, colsTV, colorTheme } = value;
  try {
    localStorage.setItem(cacheKey(serverUrl, terminalCode),
      JSON.stringify({ columns, colsTablet, colsMobile, colsLarge, colsTV, colorTheme }));
  } catch {
    console.warn("Layout presentation could not be cached for offline use.");
  }
}