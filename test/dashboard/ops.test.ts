import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listIntegrations, listSecrets, listArtifacts } from "../../src/dashboard/ops.js";

let root: string;
const fakeSecrets = (refs: string[]) => ({ list: async () => refs } as any);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-ops-"));
  mkdirSync(join(root, "integrations", "moneybird"), { recursive: true });
  writeFileSync(join(root, "integrations", "moneybird", "manifest.json"), JSON.stringify({
    name: "moneybird", type: "connection", description: "boekhouding", requires: ["MONEYBIRD_API_KEY"],
    actions: { create_invoice: { method: "POST", url: "https://api/x", description: "maak factuur" } },
  }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("listIntegrations composes credential status from the broker", async () => {
  const none = await listIntegrations(root, fakeSecrets([]));
  expect(none[0]).toMatchObject({ name: "moneybird", type: "connection" });
  expect(none[0].actions[0]).toMatchObject({ name: "create_invoice", method: "POST" });
  expect(none[0].requiredSecrets).toEqual([{ ref: "MONEYBIRD_API_KEY", set: false }]);
  const set = await listIntegrations(root, fakeSecrets(["MONEYBIRD_API_KEY"]));
  expect(set[0].requiredSecrets[0].set).toBe(true);
});

test("listSecrets reports which integrations require each ref (no values)", async () => {
  expect(await listSecrets(root, fakeSecrets(["MONEYBIRD_API_KEY"]))).toEqual([
    { ref: "MONEYBIRD_API_KEY", requiredBy: ["moneybird"] },
  ]);
});

test("listArtifacts lists files recursively as relative paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "geode-art-"));
  mkdirSync(join(dir, "sub")); writeFileSync(join(dir, "a.md"), "x"); writeFileSync(join(dir, "sub", "b.md"), "y");
  expect(listArtifacts(dir).map((a) => a.path).sort()).toEqual(["a.md", "sub/b.md"]);
  rmSync(dir, { recursive: true, force: true });
});
