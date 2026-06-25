import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE = "geode_session";

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/** Token = "<exp>.<sub>.<sig>" where sig = HMAC(key, "<exp>.<sub>"). exp is ms-since-epoch; sub is dot-free. */
export function signSession(key: Buffer, ttlMs: number, sub: string, now: () => number = Date.now): string {
  if (sub.includes(".")) throw new Error("session subject must be dot-free");
  const payload = `${now() + ttlMs}.${sub}`;
  return `${payload}.${sign(key, payload)}`;
}

export function verifySession(key: Buffer, token: string, now: () => number = Date.now): { sub: string } | null {
  const i = token.indexOf("."); if (i < 0) return null;
  const j = token.indexOf(".", i + 1); if (j < 0) return null;
  const exp = token.slice(0, i), sub = token.slice(i + 1, j), sig = token.slice(j + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < now()) return null;
  const expected = sign(key, `${exp}.${sub}`);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { sub } : null;
}

export function sessionFromCookie(key: Buffer, cookieHeader: string | undefined, now: () => number = Date.now): { sub: string } | null {
  const tok = parseCookie(cookieHeader, COOKIE);
  return tok ? verifySession(key, tok, now) : null;
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

/** Express middleware: 401 unless a valid session cookie is present; attaches the principal to res.locals. */
export function requireSession(key: Buffer) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = sessionFromCookie(key, req.headers.cookie);
    if (s) { (res.locals as Record<string, unknown>).principal = s; return next(); }
    res.status(401).json({ error: "unauthorized" });
  };
}
