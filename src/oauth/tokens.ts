import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString("base64url");
const dec = (s: string): any => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export interface ClientReg { redirect_uris: string[]; name: string }
export interface CodePayload { client_id: string; redirect_uri: string; code_challenge: string; resource: string; scope: string; sub: string }
export interface AuthRequest { client_id: string; redirect_uri: string; code_challenge: string; resource: string; scope: string; state: string }
export interface TokenClaims { sub: string; scope: string }

export interface OAuth {
  readonly resource: string;
  registerClient(reg: ClientReg): string;
  verifyClientId(clientId: string): ClientReg | null;
  mintAuthRequest(p: AuthRequest): string;
  verifyAuthRequest(token: string): AuthRequest | null;
  mintCode(p: CodePayload): string;
  consumeCode(code: string): CodePayload | null;
  verifyPkce(codeVerifier: string, codeChallenge: string): boolean;
  mintAccessToken(c: TokenClaims): { token: string; expiresIn: number };
  verifyAccessToken(token: string): TokenClaims | null;
  mintRefreshToken(c: TokenClaims): string;
  verifyRefreshToken(token: string): TokenClaims | null;
}

const ACCESS_TTL = 3_600_000, REFRESH_TTL = 30 * 86_400_000, CODE_TTL = 60_000, AREQ_TTL = 600_000;

// Stateless HMAC-signed blobs: "<kind>.<base64url(json)>.<sig>". Single-use codes tracked in a nonce set.
export function createOAuth(opts: { signKey: Buffer; baseUrl: string; now?: () => number }): OAuth {
  const now = opts.now ?? (() => Date.now());
  const resource = `${opts.baseUrl}/mcp`;
  const consumed = new Set<string>();
  const sign = (payload: string) => createHmac("sha256", opts.signKey).update(payload).digest("base64url");
  const make = (kind: string, body: object): string => { const payload = `${kind}.${enc(body)}`; return `${payload}.${sign(payload)}`; };
  const open = (kind: string, token: string): any | null => {
    const j = token.lastIndexOf("."); if (j < 0) return null;
    const payload = token.slice(0, j), sig = token.slice(j + 1);
    if (!payload.startsWith(kind + ".")) return null;
    const a = Buffer.from(sig), b = Buffer.from(sign(payload));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try { return dec(payload.slice(kind.length + 1)); } catch { return null; }
  };
  const live = (body: any): any | null => (body && typeof body.exp === "number" && body.exp >= now() ? body : null);
  return {
    resource,
    registerClient: (reg) => make("cid", { redirect_uris: reg.redirect_uris, name: reg.name, iat: now() }),
    verifyClientId: (cid) => { const b = open("cid", cid); return b && Array.isArray(b.redirect_uris) ? { redirect_uris: b.redirect_uris.map(String), name: String(b.name ?? "") } : null; },
    mintAuthRequest: (p) => make("areq", { ...p, exp: now() + AREQ_TTL }),
    verifyAuthRequest: (t) => { const b = live(open("areq", t)); return b ? { client_id: b.client_id, redirect_uri: b.redirect_uri, code_challenge: b.code_challenge, resource: b.resource, scope: b.scope, state: b.state } : null; },
    mintCode: (p) => make("code", { ...p, nonce: randomBytes(9).toString("base64url"), exp: now() + CODE_TTL }),
    consumeCode: (code) => {
      const b = live(open("code", code));
      if (!b || consumed.has(b.nonce)) return null;
      consumed.add(b.nonce);
      return { client_id: b.client_id, redirect_uri: b.redirect_uri, code_challenge: b.code_challenge, resource: b.resource, scope: b.scope, sub: b.sub };
    },
    verifyPkce: (verifier, challenge) => { const h = createHash("sha256").update(verifier).digest("base64url"); const a = Buffer.from(h), b = Buffer.from(challenge); return a.length === b.length && timingSafeEqual(a, b); },
    mintAccessToken: (c) => ({ token: make("at", { aud: resource, sub: c.sub, scope: c.scope, exp: now() + ACCESS_TTL }), expiresIn: Math.floor(ACCESS_TTL / 1000) }),
    verifyAccessToken: (t) => { const b = live(open("at", t)); return b && b.aud === resource ? { sub: b.sub, scope: b.scope } : null; },
    mintRefreshToken: (c) => make("rt", { aud: resource, sub: c.sub, scope: c.scope, exp: now() + REFRESH_TTL }),
    verifyRefreshToken: (t) => { const b = live(open("rt", t)); return b && b.aud === resource ? { sub: b.sub, scope: b.scope } : null; },
  };
}
