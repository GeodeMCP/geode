import type { Express } from "express";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApiRouter, type ApiDeps } from "./api.js";
import { verifySecretLink } from "./secretLinks.js";
import { renderAuthScreen, renderAuthResult } from "./authScreen.js";

export interface DashboardDeps extends Omit<ApiDeps, "secure"> {
  webDir: string;   // absolute path to the built SPA (web/dist)
  secure?: boolean;
}

/** Mounts /api and the static SPA on the given Express app. Call only when the dashboard is enabled. */
export function mountDashboard(app: Express, deps: DashboardDeps): void {
  app.use("/api", createApiRouter({ ...deps, secure: deps.secure ?? false }));

  const authRouter = express.Router();
  authRouter.use(express.urlencoded({ extended: false }));
  const consumed = new Set<string>();
  const expired = () => ({ html: renderAuthResult({ ok: false, ref: "", message: "Deze link is verlopen of al gebruikt." }) });
  authRouter.get("/s/:token", (req, res) => {
    const c = verifySecretLink(deps.linkKey, req.params.token);
    if (!c || consumed.has(c.nonce)) { res.status(410).type("html").send(expired().html); return; }
    const minutesLeft = Math.max(1, Math.ceil((c.exp - Date.now()) / 60000));
    res.type("html").send(renderAuthScreen({ ref: c.ref, action: req.originalUrl, minutesLeft }));
  });
  authRouter.post("/s/:token", async (req, res) => {
    const c = verifySecretLink(deps.linkKey, req.params.token);
    if (!c || consumed.has(c.nonce)) { res.status(410).type("html").send(expired().html); return; }
    const value = String((req.body as { value?: string })?.value ?? "");
    if (!value) { res.type("html").send(renderAuthScreen({ ref: c.ref, action: req.originalUrl, minutesLeft: 1, error: "Voer een waarde in." })); return; }
      // Consume AFTER a successful write → "single successful use" (a transient set() failure leaves the link usable for a retry).
    await deps.secrets.set(c.ref, value);
    consumed.add(c.nonce);
    res.type("html").send(renderAuthResult({ ok: true, ref: c.ref, message: `${c.ref} is opgeslagen in de broker.` }));
  });
  app.use("/auth", authRouter);

  if (existsSync(deps.webDir)) {
    app.use(express.static(deps.webDir));
    // SPA fallback: any non-/api, non-/auth/, non-/mcp, non-/artifacts GET returns index.html
    app.get(/^\/(?!api\/|auth\/|mcp$|artifacts\/).*/, (_req, res) => { res.sendFile(join(deps.webDir, "index.html")); });
  } else {
    app.get(/^\/(?!api\/|auth\/|mcp$|artifacts\/).*/, (_req, res) => {
      res.status(503).type("text/plain").send("Dashboard SPA not built. Run: cd web && npm run build");
    });
  }
}
