const TOKEN_KEY = "globi_customer_token";
const CUSTOMER_KEY = "globi_customer";

export interface CustomerSession {
  id: string;
  name: string;
  code: string;
  email: string | null;
  priceLevel: number;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_KEY);
}

export function getCustomer(): CustomerSession | null {
  const raw = localStorage.getItem(CUSTOMER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setCustomer(c: CustomerSession): void {
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(c));
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
