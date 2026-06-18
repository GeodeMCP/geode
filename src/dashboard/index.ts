import type { Express } from "express";
import express from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApiRouter, type ApiDeps } from "./api.js";

export interface DashboardDeps extends Omit<ApiDeps, "secure"> {
  webDir: string;   // absolute path to the built SPA (web/dist)
  secure?: boolean;
}

/** Mounts /api and the static SPA on the given Express app. Call only when the dashboard is enabled. */
export function mountDashboard(app: Express, deps: DashboardDeps): void {
  app.use("/api", createApiRouter({ ...deps, secure: deps.secure ?? false }));
  if (existsSync(deps.webDir)) {
    app.use(express.static(deps.webDir));
    // SPA fallback: any non-/api, non-/mcp, non-/artifacts GET returns index.html
    app.get(/^\/(?!api\/|mcp$|artifacts\/).*/, (_req, res) => { res.sendFile(join(deps.webDir, "index.html")); });
  } else {
    app.get(/^\/(?!api\/|mcp$|artifacts\/).*/, (_req, res) => {
      res.status(503).type("text/plain").send("Dashboard SPA not built. Run: cd web && npm run build");
    });
  }
}
