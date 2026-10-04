import type { Product, TerminalConfig } from "../types";

export type LookupProduct = Pick<Product, "server_id" | "name" | "sku" | "barcode" |
  "price1" | "price2" | "price3" | "price4" | "price5" | "timed_price">;

/** Read-only shared catalogue search. Results never enter the terminal's downloaded list. */
export async function searchStoreProducts(
  config: TerminalConfig | null, query: string, request: typeof fetch = fetch,
): Promise<LookupProduct[]> {
  if (!config) throw new Error("Configure this terminal before searching other stores.");
  if (!query.trim()) return [];
  if (query.length > 120) throw new Error("Search text must be at most 120 characters.");
  const url = new URL(`${config.server_url.replace(/\/+$/, "")}/api/pos/stock/search`);
  url.searchParams.set("q", query.trim());
  const response = await request(url.toString(), {
    headers: { "X-Terminal-Code": config.terminal_code },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Online store lookup is unavailable (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data?.items)) throw new Error("Invalid store lookup response.");
  return data.items.map((item: any) => {
    if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || typeof item.sku !== "string") {
      throw new Error("Invalid product in store lookup response.");
    }
    const prices = [item.price1, item.price2, item.price3, item.price4, item.price5];
    if (prices.some(value => (typeof value !== "number" && typeof value !== "string") ||
        value === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      throw new Error("Invalid product price in store lookup response.");
    }
    return { server_id: item.id, name: item.name, sku: item.sku,
      barcode: typeof item.barcode === "string" ? item.barcode : undefined,
      price1: Number(prices[0]), price2: Number(prices[1]), price3: Number(prices[2]),
      price4: Number(prices[3]), price5: Number(prices[4]) };
  });
}