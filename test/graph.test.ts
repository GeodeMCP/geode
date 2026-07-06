import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { buildNodes } from "../src/graph.js";

const noSecrets = { get: async () => null };

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "geode-graph-"));
  mkdirSync(join(root, "tools/moneybird"), { recursive: true });
  writeFileSync(join(root, "tools/moneybird/TOOL.md"),
    `---\nid: moneybird\nname: Moneybird\ntype: http\ndescription: MB\nconnections: [{ label: default }]\nactions: { list_mutations: { http: { method: GET, url: "https://x/m" } } }\n---\n`);
  mkdirSync(join(root, "notes/administratie"), { recursive: true });
  writeFileSync(join(root, "notes/administratie/sop-booking.md"),
    `---\ntype: sop\ntitle: SOP boeken\ndescription: boek\ntags: [administratie]\n---\nGebruik [[moneybird]].\n`);
  mkdirSync(join(root, "backlog"), { recursive: true });
  writeFileSync(join(root, "backlog/mb-attach.md"),
    `---\ntype: gap\nkind: tool\ntitle: MB attachment\ndescription: gap\ntags: [administratie]\n---\nBlokkeert [moneybird](../tools/moneybird/TOOL.md).\n`);
  return root;
}

test("buildNodes classifies tool, sop, gap with domain", async () => {
  const nodes = await buildNodes(fixture(), noSecrets);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  expect(byId["tools/moneybird"].type).toBe("tool");
  expect(byId["tools/moneybird"].actions).toContain("list_mutations");
  expect(byId["notes/administratie/sop-booking"]).toMatchObject({ type: "sop", domain: "administratie" });
  expect(byId["backlog/mb-attach"]).toMatchObject({ type: "gap", kind: "tool", count: 1 });
});
