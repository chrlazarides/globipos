import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeServerUrl(url: string): string {
  let toParse = url.trim();
  if (!toParse.startsWith("http://") && !toParse.startsWith("https://")) {
    toParse = "https://" + toParse;
  }
  
  try {
    const u = new URL(toParse);
    if (u.protocol !== "https:") throw new Error("Must be HTTPS");
    if (u.username || u.password) throw new Error("No credentials allowed");
    if (u.pathname !== "/" && u.pathname !== "") throw new Error("No path allowed");
    if (u.search) throw new Error("No query allowed");
    if (u.hash) throw new Error("No fragment allowed");
    return u.origin;
  } catch (e: any) {
    if (e.message && (e.message.includes("allowed") || e.message.includes("HTTPS"))) {
      throw e;
    }
    throw new Error("Invalid URL: must be an HTTPS origin like https://store.globipos.com");
  }
}

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const RETRY_DELAYS = [1000, 2000, 4000] as const;

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

async function readSuccessfulResponse(url: string, options: RequestInit): Promise<string> {
  // Bound both headers and body reads; a stalled request must release the sync worker.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
  const response = await fetch(url, { ...options, signal: controller.signal });
  if (!response.ok) {
    let errorText = "";
    try {
      errorText = await response.text();
    } catch {
      // The HTTP status is authoritative even if the error body is interrupted.
    }
    throw new HttpError(response.status, `HTTP error ${response.status}: ${errorText}`);
  }
  return await response.text();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchOnce(url: string, options: RequestInit): Promise<string> {
  return readSuccessfulResponse(url, options);
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryDelays: readonly number[] = RETRY_DELAYS,
): Promise<string> {
  let attempt = 0;
  while (true) {
    try {
      return await readSuccessfulResponse(url, options);
    } catch (e: any) {
      if (e instanceof HttpError || e.name === 'AbortError') {
        throw e;
      }
      if (attempt >= retryDelays.length) {
        throw e;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
      attempt++;
    }
  }
}
