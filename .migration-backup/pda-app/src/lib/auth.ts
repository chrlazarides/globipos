const TOKEN_KEY = "globi_pda_token";
const STAFF_KEY = "globi_pda_staff";

export interface StaffSession {
  id: string;
  username: string;
  email: string | null;
  role: string;
  permissions: string[];
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(STAFF_KEY);
}

export function getStaff(): StaffSession | null {
  const raw = localStorage.getItem(STAFF_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setStaff(s: StaffSession): void {
  localStorage.setItem(STAFF_KEY, JSON.stringify(s));
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function hasModuleAccess(staff: StaffSession | null, moduleKey: string): boolean {
  if (!staff) return false;
  if (staff.role === "admin" || staff.role === "superuser") return true;
  if (!staff.permissions || staff.permissions.length === 0) return true;
  return staff.permissions.includes(moduleKey);
}
