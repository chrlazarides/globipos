import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: SESSION_SECRET environment variable is not set. Refusing to start.");
  process.exit(1);
}
const JWT_SECRET_SAFE = JWT_SECRET as string;
const TOKEN_COOKIE = "vt_auth";
const TOKEN_EXPIRY = "30d";

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role, permissions: user.permissions }, JWT_SECRET_SAFE, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET_SAFE) as any;
    if (payload.temp || payload.recovery2fa || payload.recoverySetup2fa) return null;
    if (!payload.id || !payload.username || !payload.role) return null;
    return { ...payload, permissions: payload.permissions || [] } as AuthUser;
  } catch {
    return null;
  }
}

type TempTokenPurpose = "2fa-login" | "2fa-setup";

export function signTempToken(userId: string, purpose: TempTokenPurpose): string {
  return jwt.sign({ temp: true, id: userId, purpose }, JWT_SECRET_SAFE, { expiresIn: "5m" });
}

export function verifyTempToken(token: string, purpose: TempTokenPurpose): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET_SAFE) as any;
    if (!payload.temp || !payload.id || payload.purpose !== purpose) return null;
    return payload.id as string;
  } catch {
    return null;
  }
}

export function sign2faRecoveryToken(userId: string, challengeId: string): string {
  return jwt.sign({ recovery2fa: true, id: userId, challengeId }, JWT_SECRET_SAFE, { expiresIn: "10m" });
}

export function verify2faRecoveryToken(token: string): { userId: string; challengeId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET_SAFE) as any;
    if (!payload.recovery2fa || !payload.id || !payload.challengeId) return null;
    return { userId: payload.id as string, challengeId: payload.challengeId as string };
  } catch {
    return null;
  }
}

export function sign2faRecoverySetupToken(userId: string, grantId: string, secret: string): string {
  return jwt.sign({ recoverySetup2fa: true, id: userId, grantId, secret }, JWT_SECRET_SAFE, { expiresIn: "5m" });
}

export function verify2faRecoverySetupToken(token: string): { userId: string; grantId: string; secret: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET_SAFE) as any;
    if (!payload.recoverySetup2fa || !payload.id || !payload.grantId || !payload.secret) return null;
    return { userId: payload.id as string, grantId: payload.grantId as string, secret: payload.secret as string };
  } catch {
    return null;
  }
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(TOKEN_COOKIE);
}

const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/2fa/verify",
  "/api/auth/2fa/setup-initial",
  "/api/auth/2fa/recovery",
  "/portal",
  "/api/portal",
  "/api/manual",
  "/api/public",
  "/api/customer",
  "/api/pos/terminals/register", // bootstrap — no session cookie on first launch
  "/api/pos/sync/audit-logs", // terminal audit-log push — authenticated via X-Terminal-Code (requireTerminal)
  "/api/orders", // Click & Collect lookup/collect — authenticated via X-Terminal-Code (requireTerminal)
  "/api/signage/play", // screen-facing player, keyed by pairing code, no session
  "/api/webhooks/whatsapp", // Meta webhook — no session; verified via hub.verify_token (GET) / X-Hub-Signature-256 (POST)
  "/api/control/heartbeat", // deployment agent authenticates with its own bearer credential
];

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(p + "/"))) {
    return next();
  }
  if (!req.path.startsWith("/api/")) {
    return next();
  }
  const token = req.cookies?.[TOKEN_COOKIE] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ message: "Session expired, please log in again" });
  }
  req.user = user;
  next();
}

/** Superuser only (Settings, user management) */
export function requireSuperuser(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "superuser") {
    return res.status(403).json({ message: "Superuser access required" });
  }
  next();
}

/** Admin OR superuser */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "superuser")) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

/** Staff, admin, or superuser — use for POS operations that cashiers must perform */
export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "staff" && req.user.role !== "admin" && req.user.role !== "superuser")) {
    return res.status(403).json({ message: "Staff access required" });
  }
  next();
}

/**
 * Requires the caller's role/permissions to include the given module.
 * Admin/superuser always pass. Staff pass if their permissions array is empty
 * (full access) or explicitly includes the module — mirrors client hasModuleAccess().
 * Must run after requireStaff/requireAuth so req.user is populated.
 */
export function requireModule(module: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (user.role === "admin" || user.role === "superuser") {
      return next();
    }
    if (!user.permissions || user.permissions.length === 0 || user.permissions.includes(module)) {
      return next();
    }
    return res.status(403).json({ message: `Access to the "${module}" module is required` });
  };
}
