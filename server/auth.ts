import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.SESSION_SECRET || "vintrade-secret-key-2024";
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
  return jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role, permissions: user.permissions }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.temp) return null;
    return { ...payload, permissions: payload.permissions || [] } as AuthUser;
  } catch {
    return null;
  }
}

export function signTempToken(userId: string): string {
  return jwt.sign({ temp: true, id: userId }, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyTempToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (!payload.temp || !payload.id) return null;
    return payload.id as string;
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
  "/portal",
  "/api/portal",
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
