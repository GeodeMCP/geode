import { describe, it, expect } from "vitest";
import { declaredHosts, targetHost, hostStatus } from "../src/hostPolicy.js";
import type { ToolManifest } from "../src/tools.js";

const base = (over: Partial<ToolManifest>): ToolManifest => ({
  id: "t", name: "t", type: "http", description: "", actions: {}, ...over,
});

describe("declaredHosts", () => {
  it("collects hosts from http action urls, lowercased + sorted + deduped", () => {
    const m = base({ actions: {
      a: { http: { method: "GET", url: "https://API.Moneybird.nl/v2/x" } },
      b: { http: { method: "GET", url: "https://api.moneybird.nl/v2/y" } },
      c: { http: { method: "GET", url: "https://api.github.com/repos" } },
    } });
    expect(declaredHosts(m)).toEqual(["api.github.com", "api.moneybird.nl"]);
  });

  it("includes permissions.network array entries and transport host", () => {
    const m = base({ type: "cli", permissions: { network: ["registry.npmjs.org"] },
      transport: { kind: "http", url: "https://mcp.example.com/sse" } });
    expect(declaredHosts(m)).toEqual(["mcp.example.com", "registry.npmjs.org"]);
  });

  it("returns a dynamic host verbatim rather than dropping it", () => {
    const m = base({ actions: { a: { http: { method: "GET", url: "https://${conn.host}/x" } } } });
    expect(declaredHosts(m)).toContain("${conn.host}");
  });
});

describe("targetHost", () => {
  it("returns the lowercased hostname", () => {
    expect(targetHost("https://API.Example.com:443/a?b=c")).toBe("api.example.com");
  });
  it("returns null on an unparseable url", () => {
    expect(targetHost("not a url")).toBeNull();
  });
});

describe("hostStatus", () => {
  it("splits declared into approved and pending", () => {
    const m = base({ actions: {
      a: { http: { method: "GET", url: "https://api.moneybird.nl/x" } },
      b: { http: { method: "GET", url: "https://evil.com/x" } },
    } });
    expect(hostStatus(m, ["api.moneybird.nl"])).toEqual({
      approved: ["api.moneybird.nl"], pending: ["evil.com"],
    });
  });
});
