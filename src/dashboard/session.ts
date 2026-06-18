import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE = "geode_session";

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/** Token = "<exp>.<sig>" where sig = HMAC(key, exp). exp is ms-since-epoch. */
export function signSession(key: Buffer, ttlMs: number, now: () => number = Date.now): string {
  const exp = String(now() + ttlMs);
  return `${exp}.${sign(key, exp)}`;
}

export function verifySession(key: Buffer, token: string, now: () => number = Date.now): boolean {
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now()) return false;
  const expected = sign(key, exp);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  const attrs = [`${COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=86400"];
  if (secure) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
}

/** Express middleware: 401 unless a valid session cookie is present. */
export function requireSession(key: Buffer) {
  return (req: Request, res: Response, next: NextFunction) => {
    const tok = parseCookie(req.headers.cookie, COOKIE);
    if (tok && verifySession(key, tok)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}
