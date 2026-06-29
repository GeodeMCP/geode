import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHandlers } from "../../evals/tools.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "fixtures", "vault");
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "geode-eval-")); cpSync(FIX, root, { recursive: true }); });

describe("handlers", () => {
  it("search returns matching file paths + snippets", async () => {
    const h = makeHandlers(root, "tiered");
    const out = await h.search({ query: "fly deploy" });
    expect(out).toContain("deploy-staging");
    expect(out.toLowerCase()).toContain("fly deploy");
  });

  it("read returns file contents", async () => {
    const h = makeHandlers(root, "tiered");
    const out = await h.read({ path: "clients/acme/preferences.md" });
    expect(out).toContain("airbnb-base");
  });

  it("read refuses to escape the vault", async () => {
    const h = makeHandlers(root, "tiered");
    await expect(h.read({ path: "../../etc/passwd" })).rejects.toThrow();
  });

  it("remember writes a findable note", async () => {
    const h = makeHandlers(root, "tiered");
    await h.remember({ content: "We deploy prod with fly deploy -a acme-prod." });
    const out = await h.search({ query: "acme-prod" });
    expect(out).toContain("acme-prod");
  });

  it("invoke validates action + connection and echoes the connection", async () => {
    const h = makeHandlers(root, "tiered");
    const out = await h.invoke({ tool: "gmail", action: "send", connection: "acme-sales", params: { to: "josh" } });
    expect(out).toContain("acme-sales");
    await expect(h.invoke({ tool: "gmail", action: "nope" })).rejects.toThrow();
    await expect(h.invoke({ tool: "gmail", action: "send", connection: "companyB" })).rejects.toThrow();
  });

  it("query works when called as a detached reference and returns vault content", async () => {
    const { query } = makeHandlers(root, "tiered");
    const out = await query({ instruction: "deploy staging" });
    expect(out.toLowerCase()).toContain("acme-staging");
  });
});
