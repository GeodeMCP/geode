import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, type QueryDeps } from "../src/query.js";
import { createRunManager } from "../src/runManager.js";
import type { EngineEvent } from "../src/engine.js";
import { resolveSandboxPolicy } from "../src/agentSandbox.js";
import { buildGraph } from "../src/graph.js";
import { renderIndex } from "../src/indexRender.js";

function fakeWorkspace() {
  const calls: string[] = [];
  return {
    calls,
    root: "/vault",
    init: async () => {},
    isClean: async () => true,
    head: async () => "HEAD0",
    commitAll: async (m: string) => { calls.push(`commit:${m}`); return "COMMIT1"; },
    resetToHead: async () => { calls.push("reset"); },
    changedFilesSince: async (_r: string) => ["note.md"],
    uncommittedChanges: async () => ["draft.md"],
  };
}

function fakeEngine(events: EngineEvent[]) {
  return async function* () { for (const e of events) yield e; };
}

function deps(over: Partial<QueryDeps>): QueryDeps {
  return {
    workspace: fakeWorkspace() as any,
    engine: fakeEngine([{ type: "text", text: "p1" }, { type: "result", text: "done" }]) as any,
    runManager: createRunManager({ maxRuntimeMs: 1000, queueLimit: 4 }),
    systemPrompt: "SYS",
    sandboxPolicy: resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/vault"), // disabled by default; tests opt in
    ...over,
  };
}

test("on success: streams progress, commits agent changes, returns result + files", async () => {
  const progress: string[] = [];
  const d = deps({});
  const res = await query(d, "do X", (ev) => progress.push((ev as any).text));
  expect(progress).toEqual(["p1"]);
  expect(res.text).toBe("done");
  expect(res.commit).toBe("COMMIT1");
  expect(res.filesTouched).toEqual(["note.md"]);
  expect((d.workspace as any).calls).toContain("commit:query run-1: do X");
  expect((d.workspace as any).calls).not.toContain("commit:query run-1: log");
});

test("on failure (non-review): resets the tree and rethrows, no log commit", async () => {
  const ws = fakeWorkspace();
  const boom = async function* () { throw new Error("boom"); };
  const d = deps({ workspace: ws as any, engine: boom as any });
  await expect(query(d, "do X")).rejects.toThrow("boom");
  expect(ws.calls).toContain("reset");
  expect(ws.calls.some((c: string) => c.includes("log (error)"))).toBe(false);
});

test("reports only newly-created artifacts (diffs pre-existing) with bearer URLs", async () => {
  const artifactsDir = mkdtempSync(join(tmpdir(), "geode-qa-"));
  writeFileSync(join(artifactsDir, "old.md"), "old");           // pre-existing → must NOT be reported
  const writingEngine = async function* () {
    writeFileSync(join(artifactsDir, "new.md"), "new");          // created during the run → reported
    yield { type: "result", text: "done" } as any;
  };
  const d = deps({ engine: writingEngine as any, artifactsDir, baseUrl: "http://h" } as any);
  const res = await query(d, "make a report");
  expect(res.artifacts).toEqual([{ path: "new.md", url: "http://h/artifacts/new.md" }]);
  rmSync(artifactsDir, { recursive: true, force: true });
});

test("review mode never resets a dirty tree at start — it accumulates onto the existing draft", async () => {
  const ws = fakeWorkspace(); ws.isClean = async () => false; // a human draft is pending
  const d = deps({ workspace: ws as any });
  const res = await query(d, "do X", undefined, { commit: false });
  expect(ws.calls).not.toContain("reset");
  expect(res.commit).toBeNull();
  expect(res.filesTouched).toEqual(["draft.md"]);
});

test("review mode leaves the tree on failure (no reset, no error-log commit) and rethrows", async () => {
  const ws = fakeWorkspace(); ws.isClean = async () => false;
  const boom = async function* () { yield { type: "text", text: "p" }; throw new Error("boom"); };
  const d = deps({ workspace: ws as any, engine: boom as any });
  await expect(query(d, "do Y", undefined, { commit: false })).rejects.toThrow("boom");
  expect(ws.calls).not.toContain("reset");
  expect(ws.calls.some((c) => c.includes("log (error)"))).toBe(false);
});

test("auto-commit mode checkpoints a dirty tree before the run instead of resetting it", async () => {
  const ws = fakeWorkspace(); ws.isClean = async () => false; // a pending dashboard draft
  const d = deps({ workspace: ws as any });
  await query(d, "do X"); // auto-commit mode (MCP)
  expect(ws.calls).not.toContain("reset");
  expect(ws.calls.some((c) => c.startsWith("commit:dashboard-draft: checkpoint before "))).toBe(true);
});

test("engine receives systemPrompt that includes the resolved onboarding-skill path", async () => {
  let seenPrompt = "";
  const engine = async function* (opts: any) {
    seenPrompt = opts.systemPrompt;
    yield { type: "result", text: "ok" };
  };
  const d = deps({ engine: engine as any });
  await query(d, "hi");
  expect(seenPrompt).toContain("onboard-tool.md");
  expect(seenPrompt).toContain("Your vault's conventions (overlay)"); // core ⊕ overlay ⊕ footer
});

test("a request with attachmentDirs (onboarding) defaults to librarian — no desk terseness", async () => {
  let seenPrompt = "";
  const engine = async function* (opts: any) {
    seenPrompt = opts.systemPrompt;
    yield { type: "result", text: "ok" };
  };
  const d = deps({ engine: engine as any });
  await query(d, "onboard this", undefined, { commit: false, attachmentDirs: ["/tmp/staged/abc"] });
  expect(seenPrompt).not.toContain("No section headers");
});

test("a plain request without attachments defaults to desk — terse fragment present", async () => {
  let seenPrompt = "";
  const engine = async function* (opts: any) {
    seenPrompt = opts.systemPrompt;
    yield { type: "result", text: "ok" };
  };
  const d = deps({ engine: engine as any });
  await query(d, "hi");
  expect(seenPrompt).toContain("No section headers");
});

test("engine receives sandbox settings built from the sandbox policy", async () => {
  let seen: any;
  const engine = async function* (opts: any) { seen = opts.sandbox; yield { type: "result", text: "ok" }; };
  const d = deps({ engine: engine as any, sandboxPolicy: resolveSandboxPolicy({}, "/vault") } as any);
  await query(d, "hi");
  expect(seen).toBeDefined();
  expect(seen.filesystem.allowWrite).toEqual(["/vault"]);
  expect(seen.network.allowedDomains).toContain("api.anthropic.com");
});

test("engine receives no sandbox when the policy is disabled (GEODE_SANDBOX_DISABLE)", async () => {
  let seen: any = "unset";
  const engine = async function* (opts: any) { seen = opts.sandbox; yield { type: "result", text: "ok" }; };
  const d = deps({ engine: engine as any, sandboxPolicy: resolveSandboxPolicy({ GEODE_SANDBOX_DISABLE: "1" }, "/vault") });
  await query(d, "hi");
  expect(seen).toBeUndefined();
});

test("attachment dirs are granted read access and surfaced to the agent", async () => {
  let seen: any;
  const engine = async function* (opts: any) { seen = opts; yield { type: "result", text: "ok" }; };
  const d = deps({ engine: engine as any, sandboxPolicy: resolveSandboxPolicy({}, "/vault") } as any);
  await query(d, "process these", undefined, { commit: false, attachmentDirs: ["/tmp/up/abc"] });
  expect(seen.sandbox.filesystem.allowRead).toEqual(["/tmp/up/abc"]);
  expect(seen.instruction).toContain("/tmp/up/abc");
  expect(seen.instruction).toContain("process these");
});

const noSecrets = { get: async () => null };

test("auto-commit mode with secrets rebuilds the graph after the query commits", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-qg-"));
  const ws = fakeWorkspace(); ws.root = root;
  const d = deps({ workspace: ws as any, secrets: noSecrets });
  await query(d, "do X");
  expect(existsSync(join(root, ".geode/graph.json"))).toBe(true);
  expect(ws.calls.some((c) => c.startsWith("commit:graph: rebuild "))).toBe(true);
  // index.md must regenerate alongside the graph, from the same rebuild.
  const graph = await buildGraph(root, noSecrets);
  expect(existsSync(join(root, "index.md"))).toBe(true);
  expect(await readFile(join(root, "index.md"), "utf8")).toBe(renderIndex(graph));
  rmSync(root, { recursive: true, force: true });
});

test("review mode never rebuilds the graph, even when secrets are present", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-qg-"));
  const ws = fakeWorkspace(); ws.root = root;
  const d = deps({ workspace: ws as any, secrets: noSecrets });
  await query(d, "do X", undefined, { commit: false });
  expect(existsSync(join(root, ".geode/graph.json"))).toBe(false);
  expect(ws.calls.some((c) => c.startsWith("commit:graph: rebuild "))).toBe(false);
  expect(existsSync(join(root, "index.md"))).toBe(false);
  rmSync(root, { recursive: true, force: true });
});

function capturingEngine() {
  const seen: { instruction?: string } = {};
  const gen = async function* (arg: any) { seen.instruction = arg.instruction; yield { type: "result", text: "done" } as EngineEvent; };
  return Object.assign(gen, { seen });
}

function retrievalFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "geode-qr-"));
  mkdirSync(join(root, "tools/moneybird"), { recursive: true });
  writeFileSync(join(root, "tools/moneybird/TOOL.md"),
    `---\nid: moneybird\nname: Moneybird\ntype: http\ndescription: MB\nconnections: [{ label: default }]\nactions: { list_mutations: { http: { method: GET, url: "https://x/m" } } }\n---\n`);
  mkdirSync(join(root, "notes/administratie"), { recursive: true });
  writeFileSync(join(root, "notes/administratie/sop-booking.md"),
    `---\ntype: sop\ntitle: SOP boeken\ndescription: boek\ntags: [administratie]\n---\nGebruik [[moneybird]].\n`);
  return root;
}

test("desk query prepends a scoped-retrieval note built from the compiled vault graph", async () => {
  const root = retrievalFixture();
  const ws = fakeWorkspace(); ws.root = root;
  const engine = capturingEngine();
  const d = deps({ workspace: ws as any, engine: engine as any });
  await query(d, "how do I book in moneybird");
  expect(engine.seen.instruction).toContain("tools/moneybird/TOOL.md");
  expect(engine.seen.instruction).toContain("notes/administratie/sop-booking.md");
  expect(engine.seen.instruction).toContain("how do I book in moneybird");
  rmSync(root, { recursive: true, force: true });
});

test("librarian role gets no retrieval note", async () => {
  const root = retrievalFixture();
  const ws = fakeWorkspace(); ws.root = root;
  const engine = capturingEngine();
  const d = deps({ workspace: ws as any, engine: engine as any });
  await query(d, "how do I book in moneybird", undefined, { role: "librarian" });
  expect(engine.seen.instruction).not.toContain("Relevant vault capabilities");
  rmSync(root, { recursive: true, force: true });
});

test("desk query with no matching nodes gets no retrieval note (empty match is best-effort no-op)", async () => {
  const root = retrievalFixture();
  const ws = fakeWorkspace(); ws.root = root;
  const engine = capturingEngine();
  const d = deps({ workspace: ws as any, engine: engine as any });
  await query(d, "xyzzy nonsense zzz");
  expect(engine.seen.instruction).not.toContain("Relevant vault capabilities");
  expect(engine.seen.instruction).toContain("xyzzy nonsense zzz");
  rmSync(root, { recursive: true, force: true });
});
