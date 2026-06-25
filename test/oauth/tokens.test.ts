import { expect, test } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { createOAuth } from "../../src/oauth/tokens.js";

const key = Buffer.from("k".repeat(32));
const mk = (now = () => 1_000_000) => createOAuth({ signKey: key, baseUrl: "https://v.example.com", now });

test("client_id round-trips redirect_uris; tampering is rejected", () => {
  const o = mk();
  const cid = o.registerClient({ redirect_uris: ["https://claude.ai/cb"], name: "Claude" });
  expect(o.verifyClientId(cid)).toEqual({ redirect_uris: ["https://claude.ai/cb"], name: "Claude" });
  expect(o.verifyClientId(cid + "x")).toBeNull();
  expect(o.verifyClientId("garbage")).toBeNull();
});

test("auth code is single-use and expires", () => {
  let t = 1_000_000; const o = mk(() => t);
  const code = o.mintCode({ client_id: "c", redirect_uri: "https://claude.ai/cb", code_challenge: "cc", resource: "https://v.example.com/mcp", scope: "vault", sub: "owner-1" });
  const p = o.consumeCode(code);
  expect(p?.sub).toBe("owner-1");
  expect(o.consumeCode(code)).toBeNull();              // single-use
  const code2 = o.mintCode({ client_id: "c", redirect_uri: "r", code_challenge: "cc", resource: "x", scope: "vault", sub: "s" });
  t += 61_000;
  expect(o.consumeCode(code2)).toBeNull();             // expired (60s TTL)
});

test("PKCE S256 verifies the matching verifier only", () => {
  const o = mk();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  expect(o.verifyPkce(verifier, challenge)).toBe(true);
  expect(o.verifyPkce("wrong", challenge)).toBe(false);
});

test("access/refresh tokens carry sub+scope, are audience-bound, and expire", () => {
  let t = 1_000_000; const o = mk(() => t);
  const at = o.mintAccessToken({ sub: "owner-1", scope: "vault" });
  expect(o.verifyAccessToken(at.token)).toEqual({ sub: "owner-1", scope: "vault" });
  // a token from a different-audience server must not verify here
  const other = createOAuth({ signKey: key, baseUrl: "https://evil.example.com", now: () => t }).mintAccessToken({ sub: "x", scope: "vault" });
  expect(o.verifyAccessToken(other.token)).toBeNull();
  const rt = o.mintRefreshToken({ sub: "owner-1", scope: "vault" });
  expect(o.verifyRefreshToken(rt)).toEqual({ sub: "owner-1", scope: "vault" });
  t += 3_600_001;
  expect(o.verifyAccessToken(at.token)).toBeNull();    // access expired (1h)
  expect(o.verifyRefreshToken(rt)).not.toBeNull();      // refresh still valid (30d)
});

test("auth-request blob round-trips and rejects tampering", () => {
  const o = mk();
  const areq = o.mintAuthRequest({ client_id: "c", redirect_uri: "https://claude.ai/cb", code_challenge: "cc", resource: "https://v.example.com/mcp", scope: "vault", state: "s1" });
  expect(o.verifyAuthRequest(areq)?.state).toBe("s1");
  expect(o.verifyAuthRequest(areq + "x")).toBeNull();
});
