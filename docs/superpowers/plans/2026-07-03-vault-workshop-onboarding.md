# Vault Workshop: Onboarding & Capability-Gap Backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner drop a workspace folder (file(s)/folder/zip) into the dashboard chat and have the vault agent inspect it, propose a plan, and — after approval and in-dashboard secret setup — author the corresponding vault pages, skills, and tools; plus a capability-gap backlog and clearer `remember`/`query` responses.

**Architecture:** Thin, testable additions along the existing seams. The dashboard chat stays the write-agency "workshop"; MCP `query`/`remember`/`invoke`/`list_capabilities` stay thin. Uploads stage to a temp dir outside the vault and reach the run through the sandbox's existing `extraReadDirs` (read-only) hook. Secrets flow through the existing capture-link + secret-store infra (agent never sees values). A new `onboard-workspace` skill is the prompt-level brain.

**Tech Stack:** TypeScript ESM (Node), Express 5, `@anthropic-ai/claude-agent-sdk`, Zod, React + Vite (web/), Vitest. New deps: `busboy` (multipart), `adm-zip` (zip expansion).

## Global Constraints

- ESM: every relative import ends in `.js`; `package.json` has `"type": "module"`. Copy the import style of neighbouring files.
- Pre-commit gate (husky + lint-staged) runs eslint + `tsc --noEmit` on staged `src/**/*.ts` and `test/**/*.ts`. **`jsdoc/require-jsdoc` blocks the commit unless every new exported function/interface/type has a `/** … */` doc comment.** Write the JSDoc as you go.
- All code and user-facing strings are **English** (chat conversation may be Dutch; the codebase never is).
- Tests: `npm test` (Vitest). Run the whole suite before each commit; it is fast.
- **Sandbox invariants must not regress** (see `test/engine.test.ts`): a sandboxed run keeps `permissionMode: "default"` + a `canUseTool` handler, never `bypassPermissions`; `settingSources: []`; `disallowedTools` includes `"AskUserQuestion"` and `"Task"`. Do not touch these.
- Secrets never get written into vault files; the agent never receives secret values.
- Branch: `feat/vault-onboarding` (already checked out; the design spec commit `5222ff1` is its first commit).
- `QueryResult` shape (from `src/query.ts`): `{ runId: string; text: string; commit: string | null; filesTouched: string[]; artifacts?: {path,url}[]; metrics?: Metrics }`.

---

## WS5 — Deterministic response envelope

### Task 1: `formatOutcome` helper

**Files:**
- Create: `src/outcome.ts`
- Test: `test/outcome.test.ts`

**Interfaces:**
- Produces: `formatOutcome(result: QueryResult): string` — a one-line "what was written" summary, or `""` when the run committed nothing.

- [ ] **Step 1: Write the failing test** — `test/outcome.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { formatOutcome } from "../src/outcome.js";

describe("formatOutcome", () => {
  it("summarises files + short commit when the run wrote something", () => {
    expect(formatOutcome({ runId: "r", text: "x", commit: "abcdef1234567", filesTouched: ["notes/x.md", "notes/y.md"] }))
      .toBe("✓ saved to notes/x.md, notes/y.md · commit abcdef1");
  });
  it("caps the file list at three and counts the rest", () => {
    expect(formatOutcome({ runId: "r", text: "x", commit: "abcdef1234567", filesTouched: ["a", "b", "c", "d", "e"] }))
      .toBe("✓ saved to a, b, c +2 more · commit abcdef1");
  });
  it("returns empty string when nothing was committed (a read-only answer stands alone)", () => {
    expect(formatOutcome({ runId: "r", text: "x", commit: null, filesTouched: [] })).toBe("");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '../src/outcome.js'`)

Run: `npm test -- outcome`

- [ ] **Step 3: Implement** — `src/outcome.ts`

```ts
import type { QueryResult } from "./query.js";

/** Builds a short, deterministic "what was written" line for a completed run — files touched plus the short commit — or "" when the run committed nothing (a read-only answer needs no envelope). */
export function formatOutcome(result: QueryResult): string {
  if (!result.commit) return "";
  const files = result.filesTouched ?? [];
  const shown = files.slice(0, 3).join(", ");
  const more = files.length > 3 ? ` +${files.length - 3} more` : "";
  const where = files.length ? ` to ${shown}${more}` : "";
  return `✓ saved${where} · commit ${result.commit.slice(0, 7)}`;
}
```

- [ ] **Step 4: Run it — expect PASS** — `npm test -- outcome`

- [ ] **Step 5: Commit**

```bash
git add src/outcome.ts test/outcome.test.ts
git commit -m "feat(outcome): deterministic run-outcome line helper"
```

### Task 2: Show the outcome line to MCP callers

**Files:**
- Modify: `src/server.ts` (the `runAgenticTool` function, lines ~49-57)
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: `formatOutcome` (Task 1).

- [ ] **Step 1: Write the failing test** — append to `test/server.test.ts`

```ts
import { makeRememberHandler } from "../src/server.js";

test("remember handler appends the deterministic outcome line to the visible text", async () => {
  const handler = makeRememberHandler({
    runRemember: async () => ({ runId: "run-1", text: "Filed it under notes.", commit: "abcdef1234567", filesTouched: ["notes/x.md"] }),
  });
  const out = await handler({ content: "hi" } as any, {});
  expect(out.content[0].text).toContain("Filed it under notes.");
  expect(out.content[0].text).toContain("✓ saved to notes/x.md");
  expect(out.content[0].text).toContain("commit abcdef1");
});
```

- [ ] **Step 2: Run it — expect FAIL** (text lacks `✓ saved`) — `npm test -- server`

- [ ] **Step 3: Implement** — in `src/server.ts`, add the import at the top:

```ts
import { formatOutcome } from "./outcome.js";
```

Replace the `text` construction inside `runAgenticTool` (currently the `const text = result.artifacts && … ? … : result.text;` expression) with:

```ts
    const segments = [result.text];
    if (result.artifacts && result.artifacts.length) {
      segments.push(`Artifacts:\n${result.artifacts.map((a) => `- ${a.url}`).join("\n")}`);
    }
    const outcome = formatOutcome(result);
    if (outcome) segments.push(outcome);
    const text = segments.join("\n\n");
```

- [ ] **Step 4: Run it — expect PASS** — `npm test -- server`

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "feat(server): fold outcome line into query/remember MCP responses"
```

---

## WS6 — Capability-gap backlog

### Task 3: `list_capabilities` surfaces `type: gap` pages

**Files:**
- Modify: `src/capabilities.ts` (`Frontmatter`, `parseFrontmatter`, `CapabilitySummary`, `deriveCapabilities`)
- Test: `test/capabilities.test.ts`

**Interfaces:**
- Produces: `CapabilitySummary.gaps: { title: string; kind?: string; description: string; path: string }[]`, and a `## Planned / needed` section in `.text` when gaps exist.

- [ ] **Step 1: Write the failing test** — append to `test/capabilities.test.ts` (self-contained temp vault)

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveCapabilities } from "../src/capabilities.js";

test("gaps (type: gap) surface under Planned / needed", async () => {
  const root = mkdtempSync(join(tmpdir(), "geode-caps-"));
  mkdirSync(join(root, "backlog"), { recursive: true });
  writeFileSync(join(root, "backlog", "moneybird-tool.md"),
    "---\ntype: gap\nkind: tool\ntitle: Moneybird REST tool\ndescription: needed to book mutations\n---\nbody");
  const caps = await deriveCapabilities(root, { get: async () => null });
  expect(caps.gaps).toEqual([{ title: "Moneybird REST tool", kind: "tool", description: "needed to book mutations", path: "backlog/moneybird-tool.md" }]);
  expect(caps.text).toContain("## Planned / needed");
  expect(caps.text).toContain("[tool] Moneybird REST tool — needed to book mutations");
  rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`caps.gaps` undefined) — `npm test -- capabilities`

- [ ] **Step 3: Implement** — in `src/capabilities.ts`:

Extend the `Frontmatter` interface:

```ts
/** Parsed YAML frontmatter fields extracted from a Markdown document. */
export interface Frontmatter { type?: string; title?: string; description?: string; tags?: string[]; kind?: string; status?: string }
```

In `parseFrontmatter`, add two branches inside the `for (const line …)` loop, after the `tags` branch:

```ts
    else if (k === "kind") fm.kind = v;
    else if (k === "status") fm.status = v;
```

Extend `CapabilitySummary`:

```ts
  gaps: { title: string; kind?: string; description: string; path: string }[];
```

In `deriveCapabilities`, declare `const gaps: CapabilitySummary["gaps"] = [];` next to `recipes`, and in the `for (const f of files)` loop change the classification branch to also catch gaps:

```ts
    const fm = parseFrontmatter(await readFile(f, "utf8").catch(() => ""));
    if (fm.type && RECIPE_TYPES.has(fm.type)) recipes.push({ title: fm.title ?? f, description: fm.description ?? "", path: f.slice(root.length + 1) });
    else if (fm.type === "gap") gaps.push({ title: fm.title ?? f, kind: fm.kind, description: fm.description ?? "", path: f.slice(root.length + 1) });
```

After the Tools section is pushed to `lines`, append the gaps section:

```ts
  if (gaps.length) {
    lines.push("\n## Planned / needed");
    lines.push(gaps.map((g) => `- ${g.kind ? `[${g.kind}] ` : ""}${g.title} — ${g.description} (${g.path})`).join("\n"));
  }
```

Finally add `gaps` to the returned object: `return { tools, recipes, gaps, text: lines.join("\n") };`

- [ ] **Step 4: Run it — expect PASS** — `npm test -- capabilities`

- [ ] **Step 5: Commit**

```bash
git add src/capabilities.ts test/capabilities.test.ts
git commit -m "feat(capabilities): surface type:gap backlog under Planned / needed"
```

### Task 4: Constitution rule — record gaps instead of failing silently

**Files:**
- Modify: `src/constitution.ts`
- Test: `test/constitution.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/constitution.test.ts`

```ts
import { CONSTITUTION } from "../src/constitution.js";

test("the constitution tells the agent to log missing capabilities as gaps", () => {
  expect(CONSTITUTION).toContain("backlog/");
  expect(CONSTITUTION).toContain("type: gap");
});
```

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- constitution`

- [ ] **Step 3: Implement** — in `src/constitution.ts`, add this bullet to the `Discipline (always):` list, immediately after the "You can ONBOARD tools/connections/MCPs…" bullet:

```
- When a request needs a capability that does not exist yet (a tool, context, SOP, or skill), do not fail silently or invent it: record it as a gap under \`backlog/\` — an OKF page with \`type: gap\` and \`kind: tool|context|sop|skill\` — deduping against existing gaps, and tell the user you logged it and where.
```

(Keep the `\`` backtick escapes — this is a template literal.)

- [ ] **Step 4: Run it — expect PASS** — `npm test -- constitution`

- [ ] **Step 5: Commit**

```bash
git add src/constitution.ts test/constitution.test.ts
git commit -m "feat(constitution): record missing capabilities as backlog gaps"
```

---

## WS1 — Attachment intake

### Task 5: Add deps + `stageFiles` (pure staging + zip expansion)

**Files:**
- Modify: `package.json` (deps)
- Create: `src/dashboard/uploads.ts`
- Test: `test/dashboard/uploads.test.ts`

**Interfaces:**
- Produces: `interface UploadFile { relPath: string; buffer: Buffer }` and `stageFiles(baseDir: string, files: UploadFile[]): Promise<string[]>` (returns relative paths written; throws on path traversal).

- [ ] **Step 1: Install deps**

Run: `npm install busboy adm-zip && npm install -D @types/busboy @types/adm-zip`

- [ ] **Step 2: Write the failing test** — `test/dashboard/uploads.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { stageFiles } from "../../src/dashboard/uploads.js";

describe("stageFiles", () => {
  it("writes plain files and expands zip entries, preserving relative paths", async () => {
    const base = mkdtempSync(join(tmpdir(), "geode-stage-"));
    const zip = new AdmZip();
    zip.addFile("skills/booking.md", Buffer.from("# booking"));
    const written = await stageFiles(base, [
      { relPath: "reference/notes.md", buffer: Buffer.from("hello") },
      { relPath: "bundle.zip", buffer: zip.toBuffer() },
    ]);
    expect(written.sort()).toEqual(["reference/notes.md", "skills/booking.md"]);
    expect(readFileSync(join(base, "reference/notes.md"), "utf8")).toBe("hello");
    expect(readFileSync(join(base, "skills/booking.md"), "utf8")).toBe("# booking");
    rmSync(base, { recursive: true, force: true });
  });
  it("rejects a path that escapes the staging dir", async () => {
    const base = mkdtempSync(join(tmpdir(), "geode-stage-"));
    await expect(stageFiles(base, [{ relPath: "../evil.md", buffer: Buffer.from("x") }])).rejects.toThrow(/unsafe/);
    expect(existsSync(join(base, "..", "evil.md"))).toBe(false);
    rmSync(base, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** — `npm test -- uploads`

- [ ] **Step 4: Implement** — `src/dashboard/uploads.ts`

```ts
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import AdmZip from "adm-zip";

/** One uploaded file: its path relative to the upload root, and its raw bytes. */
export interface UploadFile { relPath: string; buffer: Buffer }

/** Stages uploaded files under `baseDir`, expanding any `.zip` into its entries; returns the relative paths written. Throws on any path that would escape `baseDir`. */
export async function stageFiles(baseDir: string, files: UploadFile[]): Promise<string[]> {
  const root = resolve(baseDir);
  const written: string[] = [];
  const safeAbs = (rel: string): string => {
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`unsafe upload path: ${rel}`);
    return abs;
  };
  const put = async (rel: string, buf: Buffer) => {
    const abs = safeAbs(rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    written.push(rel);
  };
  for (const f of files) {
    if (f.relPath.toLowerCase().endsWith(".zip")) {
      for (const e of new AdmZip(f.buffer).getEntries()) {
        if (!e.isDirectory) await put(e.entryName, e.getData());
      }
    } else {
      await put(f.relPath, f.buffer);
    }
  }
  return written;
}
```

- [ ] **Step 5: Run it — expect PASS, then commit**

```bash
npm test -- uploads
git add package.json package-lock.json src/dashboard/uploads.ts test/dashboard/uploads.test.ts
git commit -m "feat(uploads): pure staging + zip expansion with traversal guard"
```

### Task 6: `createUploadStore`

**Files:**
- Modify: `src/dashboard/uploads.ts`
- Test: `test/dashboard/uploads.test.ts`

**Interfaces:**
- Produces: `interface UploadStore { stage(files: UploadFile[]): Promise<{ uploadId: string; dir: string }>; resolve(uploadId: string): string; cleanup(uploadId: string): Promise<void> }` and `createUploadStore(opts: { dir: string }): UploadStore`.

- [ ] **Step 1: Write the failing test** — append to `test/dashboard/uploads.test.ts`

```ts
import { createUploadStore } from "../../src/dashboard/uploads.js";

describe("createUploadStore", () => {
  it("stages to a uuid dir, resolves it, and cleans it up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "geode-uploads-"));
    const store = createUploadStore({ dir });
    const { uploadId } = await store.stage([{ relPath: "a.md", buffer: Buffer.from("hi") }]);
    expect(store.resolve(uploadId)).toBe(join(dir, uploadId));
    expect(readFileSync(join(dir, uploadId, "a.md"), "utf8")).toBe("hi");
    await store.cleanup(uploadId);
    expect(existsSync(join(dir, uploadId))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it("rejects a bogus uploadId in resolve", () => {
    const store = createUploadStore({ dir: "/tmp/x" });
    expect(() => store.resolve("../../etc")).toThrow(/invalid uploadId/);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- uploads`

- [ ] **Step 3: Implement** — append to `src/dashboard/uploads.ts`

```ts
/** A staged-upload store: writes each upload into its own UUID temp dir and resolves/cleans them. */
export interface UploadStore {
  stage(files: UploadFile[]): Promise<{ uploadId: string; dir: string }>;
  resolve(uploadId: string): string;
  cleanup(uploadId: string): Promise<void>;
}

const UPLOAD_ID_RE = /^[0-9a-f-]{36}$/;

/** Creates an UploadStore rooted at `opts.dir`; each upload gets a fresh UUID subdirectory. */
export function createUploadStore(opts: { dir: string }): UploadStore {
  const dirFor = (id: string): string => {
    if (!UPLOAD_ID_RE.test(id)) throw new Error("invalid uploadId");
    return join(opts.dir, id);
  };
  return {
    async stage(files) {
      const uploadId = randomUUID();
      const dir = join(opts.dir, uploadId);
      await stageFiles(dir, files);
      return { uploadId, dir };
    },
    resolve(uploadId) { return dirFor(uploadId); },
    async cleanup(uploadId) { await rm(dirFor(uploadId), { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 4: Run it — expect PASS, then commit**

```bash
npm test -- uploads
git add src/dashboard/uploads.ts test/dashboard/uploads.test.ts
git commit -m "feat(uploads): per-upload UUID staging store"
```

### Task 7: Thread `attachmentDirs` into `query()`

**Files:**
- Modify: `src/query.ts`
- Test: `test/query.test.ts`

**Interfaces:**
- Consumes: `buildSandboxSettings(policy, extraReadDirs?)` (existing seam, `src/agentSandbox.ts`).
- Produces: `query()` opts extended to `{ commit?: boolean; attachmentDirs?: string[]; history?: string }`. `attachmentDirs` become sandbox `allowRead` and are named in the engine instruction. (`history` is wired in Task 14; declare it now so the signature is stable.)

- [ ] **Step 1: Write the failing test** — append to `test/query.test.ts`

```ts
test("attachment dirs are granted read access and surfaced to the agent", async () => {
  let seen: any;
  const engine = async function* (opts: any) { seen = opts; yield { type: "result", text: "ok" }; };
  const d = deps({ engine: engine as any, sandboxPolicy: resolveSandboxPolicy({}, "/vault") } as any);
  await query(d, "process these", undefined, { commit: false, attachmentDirs: ["/tmp/up/abc"] });
  expect(seen.sandbox.filesystem.allowRead).toEqual(["/tmp/up/abc"]);
  expect(seen.instruction).toContain("/tmp/up/abc");
  expect(seen.instruction).toContain("process these");
});
```

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- query.test`

- [ ] **Step 3: Implement** — in `src/query.ts`:

Change the `opts` parameter type on `query(...)` from `opts?: { commit?: boolean }` to:

```ts
  opts?: { commit?: boolean; attachmentDirs?: string[]; history?: string },
```

Inside the `runManager.run` callback, just before the `for await (const ev of deps.engine({…}))` loop, build the engine instruction:

```ts
    const attachmentNote = opts?.attachmentDirs?.length
      ? `Attachments for this request are staged (read-only) at: ${opts.attachmentDirs.join(", ")}. Inspect them there; never assume other paths.\n\n`
      : "";
    const historyNote = opts?.history ? `${opts.history}\n\n` : "";
    const engineInstruction = `${historyNote}${attachmentNote}${instruction}`;
```

In the `deps.engine({…})` call, change `instruction,` to `instruction: engineInstruction,` and change `sandbox: buildSandboxSettings(deps.sandboxPolicy),` to:

```ts
        sandbox: buildSandboxSettings(deps.sandboxPolicy, opts?.attachmentDirs),
```

(Leave the later `commitAll(\`query ${runId}: ${truncate(instruction, 60)}\`)` using the raw `instruction` — commit messages and logs must stay clean.)

- [ ] **Step 4: Run it — expect PASS** (run the full suite; `query.test`, `query.reviewmode`, `ingest` all exercise this path) — `npm test`

- [ ] **Step 5: Commit**

```bash
git add src/query.ts test/query.test.ts
git commit -m "feat(query): thread attachment read-dirs into the run"
```

### Task 8: `POST /api/uploads` + `/api/query` uploadId wiring

**Files:**
- Modify: `src/dashboard/api.ts` (`ApiDeps`, new route, `/query` route)
- Modify: `src/dashboard/index.ts` (pass `uploads` through)
- Modify: `src/index.ts` (construct `createUploadStore`, extend `runQuery`)
- Test: `test/dashboard/api.test.ts`

**Interfaces:**
- Consumes: `UploadStore` (Task 6), extended `query()` opts (Task 7).
- Produces: `ApiDeps.uploads: UploadStore`; `ApiDeps.runQuery` becomes `(instruction, onProgress, opts?: { attachmentDirs?: string[]; history?: string }) => Promise<QueryResult>`.

- [ ] **Step 1: Write the failing test** — append to `test/dashboard/api.test.ts` (mirror the file's existing router-construction + supertest/fetch helper; this asserts uploadId → attachmentDirs threading with fakes)

```ts
test("/api/query resolves uploadId to an attachment dir and passes it to runQuery", async () => {
  const calls: any[] = [];
  const deps = makeApiDeps({                        // reuse this file's existing fake-deps helper
    uploads: { stage: async () => ({ uploadId: "u", dir: "/stage/u" }), resolve: (id: string) => `/stage/${id}`, cleanup: async () => {} },
    runQuery: async (instruction: string, _op: any, opts: any) => { calls.push({ instruction, opts }); return { runId: "run-1", text: "ok", commit: null, filesTouched: [] }; },
  });
  await postSse(deps, "/api/query", { instruction: "process these", uploadId: "abc" });   // reuse existing SSE-post helper
  expect(calls[0].opts.attachmentDirs).toEqual(["/stage/abc"]);
});
```

> If `test/dashboard/api.test.ts` has no reusable `makeApiDeps`/`postSse` helper, add a minimal one mirroring the fakes already used there. The assertion (uploadId → `attachmentDirs`) is the contract.

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- dashboard/api`

- [ ] **Step 3: Implement**

In `src/dashboard/api.ts`, add imports:

```ts
import busboy from "busboy";
import type { UploadStore, UploadFile } from "./uploads.js";
```

Extend `ApiDeps`:

```ts
  /** Extended: forwards attachment dirs (and, later, conversation history) into the run. */
  runQuery: (instruction: string, onProgress: (event: ProgressEvent) => void, opts?: { attachmentDirs?: string[]; history?: string }) => Promise<QueryResult>;
  /** Staged-upload store backing the chat's attachment intake. */
  uploads: UploadStore;
```

Add the upload route (after `router.use(requireSession(deps.sessionKey));`):

```ts
  router.post("/uploads", (req, res) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024, files: 300 } });
    const files: UploadFile[] = [];
    const pending: Promise<void>[] = [];
    bb.on("file", (_field, stream, info) => {
      const bufs: Buffer[] = [];
      stream.on("data", (d: Buffer) => bufs.push(d));
      pending.push(new Promise<void>((resolve) => stream.on("end", () => { files.push({ relPath: info.filename, buffer: Buffer.concat(bufs) }); resolve(); })));
    });
    bb.on("close", () => { void (async () => {
      await Promise.all(pending);
      try { const { uploadId } = await deps.uploads.stage(files); res.json({ uploadId }); }
      catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); }
    })(); });
    bb.on("error", (e: unknown) => { if (!res.headersSent) res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); });
    req.pipe(bb);
  });
```

Replace the `/query` route with the uploadId-aware version (history added in Task 14):

```ts
  router.post("/query", (req, res) => {
    const instruction = String(req.body?.instruction ?? "");
    const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : undefined;
    let attachmentDirs: string[] | undefined;
    try { attachmentDirs = uploadId ? [deps.uploads.resolve(uploadId)] : undefined; }
    catch { res.status(400).json({ error: "bad uploadId" }); return; }
    stream(
      (op) => deps.runQuery(instruction, op, { attachmentDirs }),
      async (events, outcome) => {
        const rec: TranscriptRecord = "result" in outcome
          ? { runId: outcome.result.runId, ts: Date.now(), instruction, events, result: { text: outcome.result.text, metrics: outcome.result.metrics } }
          : { runId: randomUUID(), ts: Date.now(), instruction, events, error: outcome.error };
        await deps.transcripts.append(rec);
        if (uploadId) await deps.uploads.cleanup(uploadId).catch(() => {});
      },
    )(req, res);
  });
```

In `src/dashboard/index.ts` (`mountDashboard` deps type + pass-through), add `uploads` to the deps it forwards to `createApiRouter` (mirror how `transcripts` is threaded).

In `src/index.ts`: import and construct the store, then pass it and the extended `runQuery`:

```ts
import { createUploadStore } from "./dashboard/uploads.js";
// …
  const uploads = createUploadStore({ dir: join(homedir(), ".geode", "uploads") });
```

In the `mountDashboard(app, { … })` object, change `runQuery` to forward opts and add `uploads`:

```ts
    runQuery: (instruction, onProgress, opts) => query(queryDeps, instruction, onProgress, { commit: false, attachmentDirs: opts?.attachmentDirs, history: opts?.history }),
    uploads,
```

- [ ] **Step 4: Run it — expect PASS** — `npm test -- dashboard/api` then `npm test`

- [ ] **Step 5: Manual e2e note** — append a section to `test/dashboard.e2e.manual.md`: "Upload intake — `curl -F file=@some.md $BASE/api/uploads` (with session cookie) returns `{uploadId}`; POST `/api/query` with `{instruction, uploadId}` and confirm the agent's transcript shows it Read the staged path."

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/api.ts src/dashboard/index.ts src/index.ts test/dashboard/api.test.ts test/dashboard.e2e.manual.md
git commit -m "feat(dashboard): upload endpoint + uploadId→attachment-dir wiring"
```

### Task 9: Chat composer upload affordance (frontend)

**Files:**
- Modify: `web/src/api.ts` (add `upload`; extend `run` body)
- Modify: `web/src/components/Chat.tsx` (attach button, staged chips, upload-then-send)
- Modify: `web/src/views/VaultHome.tsx` (pass `uploadId` through `send`)
- Test: `web/src/components/Chat.test.tsx` (new, minimal render/interaction)

**Interfaces:**
- Consumes: `POST /api/uploads` (Task 8).
- Produces: `api.upload(files: File[]): Promise<{ uploadId: string }>`; `Chat`'s `onSend` gains an optional `uploadId`.

- [ ] **Step 1: Implement `api.upload` + `run` body** — in `web/src/api.ts`, add to the `api` object:

```ts
  /** Upload staged attachments (files carry their folder-relative path as the filename); returns the uploadId to pass to /api/query. */
  upload: async (files: File[]): Promise<{ uploadId: string }> => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, (f as any).webkitRelativePath || f.name);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
```

The existing `run(path, body, onEvent)` already sends `body` verbatim, so `VaultHome` can include `uploadId` in it — no change to `run` needed.

- [ ] **Step 2: Wire `send` in `web/src/views/VaultHome.tsx`** — change the `send` signature and body:

```ts
  const send = async (instruction: string, onEvent: (e: SseEvent) => void, uploadId?: string) => {
    setRunning(true);
    try {
      await api.run("/api/query", { instruction, uploadId }, (e) => { onEvent(e); if (e.event === "result") { const f = e.data.filesTouched?.[0]; if (f) setSelected(f); } });
      await refresh();
    } finally { setRunning(false); }
  };
```

- [ ] **Step 3: Add the composer UI in `web/src/components/Chat.tsx`** — extend the `onSend` prop type to `(instruction: string, onEvent: (e: SseEvent) => void, uploadId?: string) => Promise<void>`, add staged-file state, and replace the `.ctrl` block:

```tsx
  const [staged, setStaged] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | null) => { if (list) setStaged((s) => [...s, ...Array.from(list)]); };
```

In `submit`, before `await onSend(...)`, upload staged files and pass the id:

```tsx
    let uploadId: string | undefined;
    if (staged.length) { uploadId = (await api.upload(staged)).uploadId; setStaged([]); }
    await onSend(instruction, (e) => { /* existing handlers unchanged */
      if (e.event === "progress") setMsgs((m) => applyProgress(m, e.data, Date.now()));
      else if (e.event === "result") setMsgs((m) => applyResult(m, e.data, Date.now()));
      else if (e.event === "error") setMsgs((m) => [...m, { kind: "error", text: e.data.message, ts: Date.now() }]);
    }, uploadId);
```

Replace the `.ctrl` div:

```tsx
      <div className="ctrl">
        {staged.length > 0 && (
          <div className="staged">{staged.map((f, i) => (
            <span key={i} className="chip">{(f as any).webkitRelativePath || f.name}
              <button onClick={() => setStaged((s) => s.filter((_, j) => j !== i))}>×</button></span>
          ))}</div>
        )}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={dirRef} type="file" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          {...({ webkitdirectory: "", directory: "" } as any)} />
        <button className="ghost sm" title="Attach files" disabled={running} onClick={() => fileRef.current?.click()}>📎</button>
        <button className="ghost sm" title="Attach folder" disabled={running} onClick={() => dirRef.current?.click()}>📁</button>
        <input className="input" value={text} disabled={running}
          placeholder={running ? "Working…" : "Talk to your vault…"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
```

- [ ] **Step 4: Minimal test** — `web/src/components/Chat.test.tsx` (mirror imports/setup of `web/src/components/FileTree.test.tsx`)

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Chat } from "./Chat";

vi.mock("../api", () => ({ api: { history: () => Promise.resolve([]), clearHistory: () => Promise.resolve(), upload: vi.fn() } }));

describe("Chat composer", () => {
  it("stages a selected file as a removable chip", async () => {
    render(<Chat onSend={vi.fn()} running={false} dirty={false} onCommit={vi.fn()} onDiscard={vi.fn()} />);
    const input = document.querySelector('input[type="file"]:not([webkitdirectory])') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.md")] } });
    expect(await screen.findByText("notes.md")).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run web tests + build** — `cd web && npx vitest run Chat && npm run build && cd ..`

- [ ] **Step 6: Add a `.staged`/`.chip` rule to `web/src/app.css`** (small flex-wrap row above the input; match existing chip styling if present) and **commit**

```bash
git add web/src/api.ts web/src/components/Chat.tsx web/src/components/Chat.test.tsx web/src/views/VaultHome.tsx web/src/app.css
git commit -m "feat(web): attach files/folder in the chat composer"
```

---

## WS4 — The `onboard-workspace` skill

### Task 10: Author the skill + reference it in the prompt footer

**Files:**
- Create: `kernel-skills/onboard-workspace.md`
- Modify: `src/skills.ts` (`buildSkillsFooter`)
- Test: `test/skills.test.ts`

- [ ] **Step 1: Write the failing test** — append to `test/skills.test.ts`

```ts
import { buildSkillsFooter } from "../src/skills.js";

test("the skills footer points the agent at the onboard-workspace skill", () => {
  expect(buildSkillsFooter("/vault")).toContain("onboard-workspace.md");
});
```

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- skills`

- [ ] **Step 3: Implement `buildSkillsFooter`** — in `src/skills.ts`, replace the function body:

```ts
/** A short system-prompt footer telling the agent which skills exist and where to read them on demand. */
export function buildSkillsFooter(vaultRoot: string): string {
  return `\n\nYour skills (read on demand):\n`
    + `- Onboard a single tool/repo/API/MCP: \`${resolveSkill(vaultRoot, "onboard-tool.md")}\`\n`
    + `- Onboard a whole dropped workspace (a folder/zip of reference docs, skills, and credentialed tools) into the vault: \`${resolveSkill(vaultRoot, "onboard-workspace.md")}\``;
}
```

- [ ] **Step 4: Run it — expect PASS** — `npm test -- skills`

- [ ] **Step 5: Create the skill** — `kernel-skills/onboard-workspace.md`

```markdown
---
name: onboard-workspace
description: Turn a folder/zip the owner dropped into the chat into vault content — reference pages, skills/SOPs, and tools — following the vault's conventions.
---

# Onboarding a dropped workspace

The owner staged a folder or zip (read-only) and asked you to bring it into the vault. Work in two turns: **inspect + propose**, then **write on approval**. You cannot ask questions mid-run — end your first turn with the plan and an explicit question, and wait for the owner's next message.

## Turn 1 — inspect and propose (write nothing yet)
1. Explore the staged directory named in the request. Read READMEs, any `CLAUDE.md`/`AGENTS.md`, `config`, `reference/`, `.claude/skills/*`, and `bin/`.
2. Classify every meaningful item into exactly one of:
   - **knowledge** — reference docs, conventions, domain notes → OKF pages in the vault (kebab-case, `type` in frontmatter, one topic per file).
   - **skills / SOPs** — `.claude/skills/*/SKILL.md` or documented procedures → vault recipes (`type: skill`). Rewrite `./bin/<tool> …` calls to `invoke(<tool>, <action>, …)`, local file paths to vault page references, and any "present a table, wait for go/skip/edit" confirmation into a **turn-based** step ("propose the table, stop, continue next turn").
   - **tools** — credentialed CLIs/APIs under `bin/` → `tools/<id>/TOOL.md` per the onboard-tool skill. One **connection per real account** (e.g. one per admin/mailbox); REST verbs → named `http` actions with templated JSON bodies; secret **key names** only via `requires` — never values.
3. Present a filing plan: for each item, its target path + kind, the tools you'll author with their connections, and **which secrets the owner must set** (list the exact `<tool>__<connection>__<KEY>` refs). If something needed can't be fully built yet (e.g. an OAuth/browser tool), note it as a gap you'll record.
4. **Stop.** Ask: "Shall I create these? (yes / adjust …)".

## Turn 2 — write on approval
1. Create the pages, skills, and `tools/<id>/TOOL.md` you proposed. Keep `index.md` current and append to `log.md`.
2. For anything not fully buildable now, record a gap under `backlog/` (`type: gap`, `kind: tool|context|sop|skill`) with a "Still to work out" section — dedup against existing gaps.
3. For each tool needing credentials, tell the owner exactly which connection secrets to set in the dashboard and (for OAuth like gogcli) give the precise terminal commands to run locally — you never handle the values yourself.
4. Report: what you filed and where, which secrets to set + test, and which gaps you logged.

## Hard rules
- Read the staging dir only; write only inside the vault. Never copy secret values anywhere.
- Never run the tools you author; the owner installs + tests them from the dashboard.
- Prefer the tool's documented CLI/endpoints over guessed inline scripts (see onboard-tool).
```

- [ ] **Step 6: Commit**

```bash
git add kernel-skills/onboard-workspace.md src/skills.ts test/skills.test.ts
git commit -m "feat(skills): onboard-workspace skill for dropped folders"
```

---

## WS3 — In-context secret capture + test

### Task 11: `pendingSetup` helper (compute connections needing setup)

**Files:**
- Create: `web/src/setup.ts`
- Test: `web/src/setup.test.ts`

**Interfaces:**
- Produces: `interface SetupItem { tool: string; connection: string; refs: string[] }` and `pendingSetup(tools: ToolView[]): SetupItem[]` — one item per unconfigured connection, with the exact secret refs (`tool__connection__KEY`) to capture.

- [ ] **Step 1: Write the failing test** — `web/src/setup.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { pendingSetup } from "./setup";

describe("pendingSetup", () => {
  it("lists unconfigured connections with their exact secret refs", () => {
    const tools = [{ id: "moneybird", requires: ["api-token"], connections: [
      { label: "roverm", configured: false }, { label: "mijnwebontwikkelaar", configured: true },
    ] }] as any;
    expect(pendingSetup(tools)).toEqual([{ tool: "moneybird", connection: "roverm", refs: ["moneybird__roverm__api-token"] }]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `cd web && npx vitest run setup`

- [ ] **Step 3: Implement** — `web/src/setup.ts`

```ts
import type { ToolView } from "./api";

/** One tool connection that still needs its secrets set, with the exact store refs to capture. */
export interface SetupItem { tool: string; connection: string; refs: string[] }

/** Derives the connections that still need setup from the tool list, with each connection's `tool__connection__KEY` refs. */
export function pendingSetup(tools: ToolView[]): SetupItem[] {
  const out: SetupItem[] = [];
  for (const t of tools) {
    for (const c of t.connections) {
      if (!c.configured) out.push({ tool: t.id, connection: c.label, refs: (t.requires ?? []).map((k) => `${t.id}__${c.label}__${k}`) });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it — expect PASS, then commit**

```bash
cd web && npx vitest run setup && cd ..
git add web/src/setup.ts web/src/setup.test.ts
git commit -m "feat(web): pendingSetup helper for unconfigured connections"
```

### Task 12: Setup strip in the chat (capture link + test)

**Files:**
- Create: `web/src/components/SetupStrip.tsx`
- Modify: `web/src/views/VaultHome.tsx` (load tools after a run; render the strip)
- Test: manual (interactive link/test flow) + build

**Interfaces:**
- Consumes: `pendingSetup` (Task 11); `api.tools()`, `api.secretLink(ref)`, `api.testAction(id, action, params)`, `api.tool(id)` (all exist in `web/src/api.ts`).

- [ ] **Step 1: Implement the component** — `web/src/components/SetupStrip.tsx`

```tsx
import { useState } from "react";
import { api } from "../api";
import type { SetupItem } from "../setup";

/** A banner listing tool connections that still need secrets, with a capture-link opener per secret and a test button. */
export function SetupStrip({ items, onDone }: { items: SetupItem[]; onDone: () => void }) {
  const [msg, setMsg] = useState("");
  if (!items.length) return null;
  const openLink = async (ref: string) => { const { url } = await api.secretLink(ref); window.open(url, "_blank", "noopener"); };
  const test = async (tool: string, connection: string) => {
    try {
      const t = await api.tool(tool);
      const action = t.actions.find((a) => true)?.name;               // first action; owner-authored tools expose a cheap read first
      if (!action) { setMsg("no action to test"); return; }
      const r = await api.testAction(tool, action, {});
      setMsg(r.status >= 200 && r.status < 300 ? `✓ ${connection} works (HTTP ${r.status})` : `✗ ${connection}: HTTP ${r.status}`);
      onDone();
    } catch (e) { setMsg(`✗ ${connection}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <div className="dirty-banner" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <span>Set up connection secrets:</span>
      {items.map((it) => (
        <div key={`${it.tool}/${it.connection}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <b>{it.tool} / {it.connection}</b>
          {it.refs.map((r) => <button key={r} className="ghost sm" onClick={() => openLink(r)}>Set {r.split("__").pop()}</button>)}
          <button className="btn sm" onClick={() => test(it.tool, it.connection)}>Test</button>
        </div>
      ))}
      {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `web/src/views/VaultHome.tsx`** — add tools state, refresh it after each run, and render the strip above `<Chat/>`:

```tsx
import { pendingSetup, type SetupItem } from "../setup";
import { SetupStrip } from "../components/SetupStrip";
// … inside VaultHome:
  const [setup, setSetup] = useState<SetupItem[]>([]);
  const refreshTools = useCallback(async () => { setSetup(pendingSetup(await api.tools().catch(() => []))); }, []);
  useEffect(() => { refreshTools(); }, [refreshTools]);
```

In `send`, after `await refresh();` add `await refreshTools();`. In the returned JSX, wrap the top so the strip renders above the chat column (e.g. place `<SetupStrip items={setup} onDone={refreshTools} />` just inside `.main`, before `<Chat/>`, or inside the chat column — match the existing layout).

- [ ] **Step 3: Build + manual e2e** — `cd web && npm run build && cd ..`. Add to `test/dashboard.e2e.manual.md`: author a tool with an unconfigured connection → confirm the strip appears → "Set …" opens the capture page → after setting, "Test" reports green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SetupStrip.tsx web/src/views/VaultHome.tsx test/dashboard.e2e.manual.md
git commit -m "feat(web): in-chat secret capture + connection test strip"
```

---

## WS2 — Conversation continuity

### Task 13: `buildHistoryPreamble`

**Files:**
- Create: `src/dashboard/history.ts`
- Test: `test/dashboard/history.test.ts`

**Interfaces:**
- Produces: `buildHistoryPreamble(records: TranscriptRecord[], limit: number): string` — a compact "recent conversation" block from the last `limit` turns, or `""` when there are none.

- [ ] **Step 1: Write the failing test** — `test/dashboard/history.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildHistoryPreamble } from "../../src/dashboard/history.js";

const rec = (instruction: string, text: string) => ({ runId: "r", ts: 0, instruction, events: [], result: { text } });

describe("buildHistoryPreamble", () => {
  it("returns empty for no records", () => { expect(buildHistoryPreamble([], 6)).toBe(""); });
  it("keeps only the last N turns and labels them", () => {
    const recs = [rec("first", "a"), rec("second", "b"), rec("third", "c")];
    const out = buildHistoryPreamble(recs, 2);
    expect(out).toContain("Recent conversation");
    expect(out).not.toContain("first");
    expect(out).toContain("You: second");
    expect(out).toContain("Vault: c");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- history`

- [ ] **Step 3: Implement** — `src/dashboard/history.ts`

```ts
import type { TranscriptRecord } from "../transcripts.js";

/** Builds a compact "recent conversation" preamble from the last `limit` transcript turns (most recent last), or "" when there are none. */
export function buildHistoryPreamble(records: TranscriptRecord[], limit: number): string {
  const recent = records.slice(-limit);
  if (!recent.length) return "";
  const oneLine = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > 400 ? t.slice(0, 400) + "…" : t; };
  const lines = recent.map((r) => `You: ${oneLine(r.instruction)}\nVault: ${oneLine(r.result?.text ?? r.error ?? "")}`);
  return `Recent conversation (most recent last):\n${lines.join("\n")}`;
}
```

- [ ] **Step 4: Run it — expect PASS, then commit**

```bash
npm test -- history
git add src/dashboard/history.ts test/dashboard/history.test.ts
git commit -m "feat(dashboard): compact conversation-history preamble"
```

### Task 14: Feed history into `/api/query`

**Files:**
- Modify: `src/dashboard/api.ts` (`/query` route)
- Test: `test/dashboard/api.test.ts`

**Interfaces:**
- Consumes: `buildHistoryPreamble` (Task 13); `deps.transcripts.list()`; the `history` opt already on `runQuery`/`query()` (Tasks 7-8).

- [ ] **Step 1: Write the failing test** — append to `test/dashboard/api.test.ts`

```ts
test("/api/query passes recent history to runQuery so follow-ups have context", async () => {
  const calls: any[] = [];
  const deps = makeApiDeps({
    transcripts: { list: async () => [{ runId: "r", ts: 0, instruction: "boek q1", events: [], result: { text: "done 3 rows" } }], append: async () => {}, clear: async () => {} },
    runQuery: async (_i: string, _op: any, opts: any) => { calls.push(opts); return { runId: "run-2", text: "ok", commit: null, filesTouched: [] }; },
  });
  await postSse(deps, "/api/query", { instruction: "go 1,3" });
  expect(calls[0].history).toContain("boek q1");
});
```

- [ ] **Step 2: Run it — expect FAIL** — `npm test -- dashboard/api`

- [ ] **Step 3: Implement** — in `src/dashboard/api.ts`, add the import:

```ts
import { buildHistoryPreamble } from "./history.js";
```

Make the `/query` handler `async` and build history before streaming; pass it alongside `attachmentDirs`:

```ts
  router.post("/query", async (req, res) => {
    const instruction = String(req.body?.instruction ?? "");
    const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : undefined;
    let attachmentDirs: string[] | undefined;
    try { attachmentDirs = uploadId ? [deps.uploads.resolve(uploadId)] : undefined; }
    catch { res.status(400).json({ error: "bad uploadId" }); return; }
    const history = buildHistoryPreamble(await deps.transcripts.list(), 6);
    stream(
      (op) => deps.runQuery(instruction, op, { attachmentDirs, history }),
      async (events, outcome) => {
        const rec: TranscriptRecord = "result" in outcome
          ? { runId: outcome.result.runId, ts: Date.now(), instruction, events, result: { text: outcome.result.text, metrics: outcome.result.metrics } }
          : { runId: randomUUID(), ts: Date.now(), instruction, events, error: outcome.error };
        await deps.transcripts.append(rec);
        if (uploadId) await deps.uploads.cleanup(uploadId).catch(() => {});
      },
    )(req, res);
  });
```

- [ ] **Step 4: Run it — expect PASS** — `npm test`

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/api.ts test/dashboard/api.test.ts
git commit -m "feat(dashboard): thread recent history into chat runs (turn-based continuity)"
```

---

## Final verification

- [ ] **Full suite green:** `npm test`
- [ ] **Typecheck:** `npm run typecheck` (src only) and `cd web && npx tsc --noEmit && cd ..`
- [ ] **Lint:** `npm run lint`
- [ ] **Web build:** `cd web && npm run build && cd ..`
- [ ] **Sandbox not regressed:** `npm test -- engine agentSandbox` (permissionMode/default, canUseTool, settingSources:[], Task+AskUserQuestion disallowed all still asserted).
- [ ] **Manual milestone** (from the spec §9), documented in `test/dashboard.e2e.manual.md`: drop the `administratie` folder → agent proposes a plan and stops → approve → `tools/moneybird/TOOL.md` (2 connections) + booking/reference pages + migrated skill created → set the two tokens via capture link, Test green → at least one gap under `backlog/` shows in `list_capabilities` → Planned/needed → from Claude Code, `query("how do I book a mutation")` returns SOP + `invoke` plan; one real booking runs via `invoke` (incl. the PDF attach once the multipart extension lands — tracked separately, see spec §5.1).

## Self-review notes

- **Spec coverage:** WS1 (Tasks 5-9), WS2 (13-14), WS3 (11-12), WS4 (10), WS5 (1-2), WS6 (3-4) — all six workstreams mapped. Scoping decision §5.1 (multipart PDF-attach on the `http` executor) is **not** in this plan; it is a self-contained follow-up and is flagged in the milestone. §5.2 (Gmail local) needs no code here — the skill guides it.
- **Type consistency:** `runQuery`/`query()` opts is `{ commit?: boolean; attachmentDirs?: string[]; history?: string }` everywhere (Tasks 7, 8, 14). `UploadFile`/`UploadStore` names match across Tasks 5, 6, 8. `SetupItem` matches across Tasks 11, 12.
- **Ordering:** the `/api/query` route is edited twice (Task 8 attachments, Task 14 history) — sequential, same file, stable signature. Tasks 1→2, 5→6→7→8 have hard dependencies; WS3/WS4/WS6 are independent and may be reordered.
