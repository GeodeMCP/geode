import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTools, listSecrets, listArtifacts } from "../../src/dashboard/ops.js";

let root: string;
const fakeSecrets = (refs: string[]) => ({ list: async () => refs, get: async (r: string) => refs.includes(r) ? "v" : null } as any);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-ops-"));
  mkdirSync(join(root, "tools", "moneybird"), { recursive: true });
  writeFileSync(join(root, "tools", "moneybird", "TOOL.md"), [
    "---",
    "id: moneybird",
    "name: Moneybird",
    "type: http",
    "description: boekhouding",
    "requires: [MONEYBIRD_API_KEY]",
    "connections: [{label: default}]",
    "actions:",
    "  create_invoice:",
    "    description: maak factuur",
    "    http: {method: POST, url: \"https://api/x\"}",
    "---",
  ].join("\n"));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("listTools composes connection status from the broker", async () => {
  const none = await listTools(root, fakeSecrets([]));
  expect(none[0]).toMatchObject({ id: "moneybird", type: "http" });
  expect(none[0].actions[0]).toMatchObject({ name: "create_invoice", description: "maak factuur" });
  expect(none[0].connections).toEqual([{ label: "default", configured: false }]);
  const set = await listTools(root, fakeSecrets(["moneybird__default__MONEYBIRD_API_KEY"]));
  expect(set[0].connections[0].configured).toBe(true);
});

test("listSecrets reports which tool the composite ref belongs to", async () => {
  expect(await listSecrets(root, fakeSecrets(["moneybird__default__MONEYBIRD_API_KEY"]))).toEqual([
    { ref: "moneybird__default__MONEYBIRD_API_KEY", requiredBy: ["moneybird"] },
  ]);
});

test("listArtifacts lists files recursively as relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-art-"));
  mkdirSync(join(dir, "sub")); writeFileSync(join(dir, "a.md"), "x"); writeFileSync(join(dir, "sub", "b.md"), "y");
  expect(listArtifacts(dir).map((a) => a.path).sort()).toEqual(["a.md", "sub/b.md"]);
  rmSync(dir, { recursive: true, force: true });
});
