import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The decoded payload of a secret-link token, containing the secret ref, expiry timestamp, and a single-use nonce. */
export interface SecretLinkClaims { ref: string; exp: number; nonce: string }

const sign = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest("base64url");

/** A signed, scoped, single-use, expiring token for entering secret <ref>. The token never carries the value. */
export function mintSecretLink(key: Buffer, ref: string, ttlMs: number, now: () => number = Date.now): string {
  const claims: SecretLinkClaims = { ref, exp: now() + ttlMs, nonce: randomBytes(9).toString("base64url") };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(key, payload)}`;
}

/** Verifies an HMAC-signed secret-link token and returns its claims if the signature is valid and it has not expired. */
export function verifySecretLink(key: Buffer, token: string, now: () => number = Date.now): SecretLinkClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = sign(key, payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: SecretLinkClaims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (typeof claims.ref !== "string" || typeof claims.exp !== "number" || typeof claims.nonce !== "string") return null;
  if (claims.exp < now()) return null;
  return claims;
}
