import { Router, type Request, type Response } from "express";
import express from "express";
import type { OAuth } from "./tokens.js";
import type { AccountStore } from "../account.js";
import type { RateLimiter } from "../dashboard/rateLimit.js";
import { sessionFromCookie, signSession, setSessionCookie } from "../dashboard/session.js";
import { protectedResourceMetadata, authorizationServerMetadata } from "./metadata.js";
import { renderConsent } from "./consentScreen.js";

const SESSION_TTL = 86_400_000; // matches dashboard SESSION_TTL
const ipKey = (req: Request) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";

/** Dependencies injected into the OAuth router, including the token service, account store, and rate limiter. */
export interface OAuthRouterDeps {
  oauth: OAuth;
  accounts: AccountStore;
  sessionKey: Buffer;
  baseUrl: string;
  secure: boolean;
  rateLimit: RateLimiter;
}

/** Builds and returns an Express Router implementing the full OAuth 2.0 authorization code + PKCE flow, including dynamic client registration and token endpoints. */
export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false }));   // for the POST /authorize form (JSON parsed app-level)

  router.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(protectedResourceMetadata(deps.baseUrl)));
  router.get("/.well-known/oauth-authorization-server", (_req, res) => res.json(authorizationServerMetadata(deps.baseUrl)));

  router.post("/register", (req, res) => {
    const redirect_uris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
    if (!redirect_uris.length) { res.status(400).json({ error: "invalid_redirect_uri" }); return; }
    const client_name = String(req.body?.client_name ?? "MCP Client");
    const client_id = deps.oauth.registerClient({ redirect_uris, name: client_name });
    res.status(201).json({ client_id, client_name, redirect_uris, token_endpoint_auth_method: "none" });
  });

  const validateAuthQuery = (q: any) => {
    if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) return null;
    const client = deps.oauth.verifyClientId(String(q.client_id ?? ""));
    const redirect_uri = String(q.redirect_uri ?? "");
    if (!client || !client.redirect_uris.includes(redirect_uri)) return null;
    if (String(q.resource ?? "") !== deps.oauth.resource) return null;
    return { client, redirect_uri, scope: String(q.scope || "vault") || "vault", state: String(q.state ?? "") };
  };

  router.get("/authorize", (req, res) => {
    const v = validateAuthQuery(req.query);
    if (!v) { res.status(400).type("html").send("<p>Invalid authorization request.</p>"); return; }
    if (!deps.accounts.hasOwner()) { res.redirect("/"); return; }   // first-run setup instead
    const reqBlob = deps.oauth.mintAuthRequest({ client_id: String(req.query.client_id), redirect_uri: v.redirect_uri, code_challenge: String(req.query.code_challenge), resource: deps.oauth.resource, scope: v.scope, state: v.state });
    const needsLogin = !sessionFromCookie(deps.sessionKey, req.headers.cookie);
    res.type("html").send(renderConsent({ clientName: v.client.name, scope: v.scope, action: "/authorize", req: reqBlob, needsLogin }));
  });

  router.post("/authorize", (req, res) => {
    const rl = deps.rateLimit.check(ipKey(req)); if (!rl.ok) { res.status(429).type("html").send("<p>Too many attempts. Try again shortly.</p>"); return; }
    const areq = deps.oauth.verifyAuthRequest(String(req.body?.req ?? ""));
    if (!areq) { res.status(400).type("html").send("<p>This request expired. Start the connection again from Claude.</p>"); return; }
    const client = deps.oauth.verifyClientId(areq.client_id);
    if (!client || !client.redirect_uris.includes(areq.redirect_uri)) { res.status(400).type("html").send("<p>Invalid client.</p>"); return; }

    let session = sessionFromCookie(deps.sessionKey, req.headers.cookie);
    const email = String(req.body?.email ?? ""), password = String(req.body?.password ?? "");
    if (!session && email && password) {
      const p = deps.accounts.verify(email, password);
      if (p) { setSessionCookie(res, signSession(deps.sessionKey, SESSION_TTL, p.id), deps.secure); session = { sub: p.id }; }
    }
    if (!session) {
      res.type("html").send(renderConsent({ clientName: client.name, scope: areq.scope, action: "/authorize", req: String(req.body?.req ?? ""), needsLogin: true, error: deps.accounts.hasOwner() ? "Invalid credentials" : "No owner — complete first-run setup" }));
      return;
    }
    const sep = areq.redirect_uri.includes("?") ? "&" : "?";
    const tail = `state=${encodeURIComponent(areq.state)}&iss=${encodeURIComponent(deps.baseUrl)}`;
    if (String(req.body?.decision) !== "approve") { res.redirect(`${areq.redirect_uri}${sep}error=access_denied&${tail}`); return; }
    const code = deps.oauth.mintCode({ client_id: areq.client_id, redirect_uri: areq.redirect_uri, code_challenge: areq.code_challenge, resource: areq.resource, scope: areq.scope, sub: session.sub });
    res.redirect(`${areq.redirect_uri}${sep}code=${encodeURIComponent(code)}&${tail}`);
  });

  router.post("/token", (req: Request, res: Response) => {
    const grant = String(req.body?.grant_type ?? "");
    if (grant === "authorization_code") {
      const p = deps.oauth.consumeCode(String(req.body?.code ?? ""));
      if (!p || p.redirect_uri !== String(req.body?.redirect_uri ?? "") || !deps.oauth.verifyPkce(String(req.body?.code_verifier ?? ""), p.code_challenge)) { res.status(400).json({ error: "invalid_grant" }); return; }
      const at = deps.oauth.mintAccessToken({ sub: p.sub, scope: p.scope });
      res.json({ access_token: at.token, token_type: "Bearer", expires_in: at.expiresIn, refresh_token: deps.oauth.mintRefreshToken({ sub: p.sub, scope: p.scope }), scope: p.scope });
      return;
    }
    if (grant === "refresh_token") {
      const c = deps.oauth.verifyRefreshToken(String(req.body?.refresh_token ?? ""));
      if (!c) { res.status(400).json({ error: "invalid_grant" }); return; }
      const at = deps.oauth.mintAccessToken({ sub: c.sub, scope: c.scope });
      res.json({ access_token: at.token, token_type: "Bearer", expires_in: at.expiresIn, scope: c.scope });
      return;
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  });

  return router;
}
