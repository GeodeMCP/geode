import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invoke } from "../src/invoke.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "geode-inv-"));
  mkdirSync(join(root, "integrations", "demo"), { recursive: true });
  writeFileSync(join(root, "integrations", "demo", "manifest.json"), JSON.stringify({
    name: "demo", type: "connection", description: "d", requires: ["DEMO_KEY"],
    actions: { get_thing: { method: "GET", url: "https://api/things/${params.id}", headers: { Authorization: "Bearer ${secrets.DEMO_KEY}" } } },
  }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const secrets = (m: Record<string,string>) => ({ get: async (k: string) => m[k] ?? null } as any);

test("injects the secret into the request and returns the response (secret not in result)", async () => {
  let seen: any;
  const fetchFn = (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }); }) as any;
  const res = await invoke({ root, secrets: secrets({ DEMO_KEY: "sk-xyz" }), fetchFn }, { integration: "demo", action: "get_thing", params: { id: "42" } });
  expect(seen.url).toBe("https://api/things/42");
  expect(seen.init.headers.Authorization).toBe("Bearer sk-xyz");
  expect(res.status).toBe(200);
  expect(JSON.stringify(res)).not.toContain("sk-xyz");
});

test("missing secret → clear error naming the ref", async () => {
  const fetchFn = (async () => new Response("", { status: 200 })) as any;
  await expect(invoke({ root, secrets: secrets({}), fetchFn }, { integration: "demo", action: "get_thing", params: { id: "1" } }))
    .rejects.toThrow(/DEMO_KEY/);
});

test("unknown action → clear error", async () => {
  const fetchFn = (async () => new Response("", { status: 200 })) as any;
  await expect(invoke({ root, secrets: secrets({ DEMO_KEY: "x" }), fetchFn }, { integration: "demo", action: "nope" }))
    .rejects.toThrow(/action/i);
});
