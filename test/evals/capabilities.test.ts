import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadManifests, renderCapabilities, renderToolDetail } from "../../evals/capabilities.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "evals", "fixtures", "vault");

describe("capabilities", () => {
  it("loads all tool manifests", () => {
    const ids = loadManifests(ROOT).map((m) => m.id).sort();
    expect(ids).toEqual(["cloakbrowser", "github", "gmail", "linear"]);
  });

  it("tiered L1 lists tools + connection labels/status but NOT action params", () => {
    const text = renderCapabilities(ROOT, "tiered");
    expect(text).toContain("gmail");
    expect(text).toContain("companyB");
    expect(text).toContain("needs_reconnect"); // github status surfaced
    expect(text).not.toContain('"required"'); // no raw param schema in L1
  });

  it("flat includes action names inline", () => {
    const text = renderCapabilities(ROOT, "flat");
    expect(text).toContain("send");
    expect(text).toContain("create_issue");
  });

  it("tool detail exposes actions + params for one tool", () => {
    const text = renderToolDetail(ROOT, "gmail");
    expect(text).toContain("send");
    expect(text).toContain("to");
    expect(text).toContain("subject");
  });
});
