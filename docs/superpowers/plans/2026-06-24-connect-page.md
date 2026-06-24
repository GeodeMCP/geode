# Connect Page (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard **Connect** page that shows the MCP tools (with explanations) and two alternative connect methods — a working JSON/CLI config for local clients, and a preview of Claude's paste-a-URL flow.

**Architecture:** A shared backend tool catalog (single source of truth for tool name + description + display params) drives both MCP registration and a new `GET /api/connect` endpoint. A new React `Connect` view renders a two-column page (left = action, right = explanation) from that endpoint. Method 2 (paste-a-URL) ships as a disabled preview; the tunnel (C) and OAuth (B) are later sub-projects.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffix), Express 5, `@modelcontextprotocol/sdk`, zod, vitest; React 18 + Vite, `@testing-library/react`.

**Reference:** spec `docs/superpowers/specs/2026-06-24-connect-page-design.md`; approved mockup `docs/design/mockups/connect-page.html`.

---

### Task 1: Tool catalog (single source of truth)

**Files:**
- Create: `src/toolCatalog.ts`
- Modify: `src/server.ts` (use catalog descriptions)
- Test: `test/toolCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

`test/toolCatalog.test.ts`:
```ts
import { expect, test } from "vitest";
import { TOOL_CATALOG } from "../src/toolCatalog.js";

test("catalog lists exactly the four MCP tools", () => {
  expect(TOOL_CATALOG.map((t) => t.name)).toEqual(["query", "remember", "list_capabilities", "invoke"]);
});

test("every tool has a non-empty description and well-formed params", () => {
  for (const t of TOOL_CATALOG) {
    expect(t.description.trim().length).toBeGreaterThan(0);
    for (const p of t.params) {
      expect(p.name).toBeTruthy();
      expect(typeof p.required).toBe("boolean");
    }
  }
});

test("query takes instruction; list_capabilities takes none; invoke takes integration+action+params", () => {
  const byName = Object.fromEntries(TOOL_CATALOG.map((t) => [t.name, t]));
  expect(byName.query.params.map((p) => p.name)).toEqual(["instruction"]);
  expect(byName.list_capabilities.params).toEqual([]);
  expect(byName.invoke.params.map((p) => p.name)).toEqual(["integration", "action", "params"]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/toolCatalog.test.ts`
Expected: FAIL — cannot find module `../src/toolCatalog.js`.

- [ ] **Step 3: Create the catalog**

`src/toolCatalog.ts`:
```ts
export interface ToolParam { name: string; type: string; required: boolean }
export interface ToolDoc { name: string; description: string; params: ToolParam[] }

// Single source of truth for the MCP tool surface. `server.ts` registers each tool with the
// description here (so the dashboard copy and the MCP description are the same string), and the
// dashboard reads the whole catalog via GET /api/connect.
export const TOOL_CATALOG: ToolDoc[] = [
  {
    name: "query",
    description:
      "Ask your Geode vault — it searches your context, recipes and SOPs and returns a synthesized answer, OR an executable plan (the exact `invoke` calls to run). It prepares; you execute via `invoke`.",
    params: [{ name: "instruction", type: "string", required: true }],
  },
  {
    name: "remember",
    description:
      "Save a distilled learning, fact, or note in your Geode vault. Give the essence — not a whole conversation; the vault agent integrates, dedups, and files it.",
    params: [
      { name: "content", type: "string", required: true },
      { name: "source", type: "string", required: false },
      { name: "title", type: "string", required: false },
    ],
  },
  {
    name: "list_capabilities",
    description:
      "List what your Geode vault offers — recipes/skills and integrations with their actions. Cheap; call this to learn what the vault can do before delegating.",
    params: [],
  },
  {
    name: "invoke",
    description:
      "Run one action of an integration in your Geode vault — you (the caller) execute it; the server injects the required secret. First ask `query` for the plan (or read the integration manifest) to learn the action + params.",
    params: [
      { name: "integration", type: "string", required: true },
      { name: "action", type: "string", required: true },
      { name: "params", type: "object", required: false },
    ],
  },
];

export const toolDescription = (name: string): string => {
  const t = TOOL_CATALOG.find((d) => d.name === name);
  if (!t) throw new Error(`tool not in catalog: ${name}`);
  return t.description;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/toolCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `server.ts` to the catalog**

In `src/server.ts`, add the import near the other imports:
```ts
import { toolDescription } from "./toolCatalog.js";
```
Then replace each inline `description:` string in the four `registerTool` calls with the catalog lookup (leave `inputSchema` untouched). Examples:
```ts
// query
{ description: toolDescription("query"), inputSchema: { instruction: z.string(), workspace: z.string().optional() } },
// remember
{ description: toolDescription("remember"), inputSchema: { content: z.string().describe(...), source: ..., title: ..., workspace: z.string().optional() } },
// list_capabilities
{ description: toolDescription("list_capabilities"), inputSchema: {} },
// invoke
{ description: toolDescription("invoke"), inputSchema: { integration: z.string(), action: z.string(), params: z.record(z.string(), z.any()).optional(), workspace: z.string().optional() } },
```
Keep the per-field `.describe()` calls on `remember`'s schema exactly as they are.

- [ ] **Step 6: Run the backend suite**

Run: `npx vitest run test/server.test.ts test/toolCatalog.test.ts`
Expected: PASS (server tests unchanged; descriptions now sourced from the catalog).

- [ ] **Step 7: Commit**

```bash
git add src/toolCatalog.ts src/server.ts test/toolCatalog.test.ts
git commit -m "feat(catalog): add MCP tool catalog as single source of truth"
```

---

### Task 2: `GET /api/connect` endpoint

**Files:**
- Modify: `src/dashboard/api.ts` (add `authToken` to `ApiDeps`; add route)
- Modify: `src/index.ts` (pass `config.authToken`)
- Modify: `test/dashboard/api.test.ts` (add `authToken` to boot deps + new test)
- Modify: `test/dashboard/api-ops.test.ts`, `test/dashboard/authRoute.test.ts` (add `authToken` so `ApiDeps` compiles)

- [ ] **Step 1: Write the failing test**

Add to `test/dashboard/api.test.ts` (after the history tests):
```ts
test("GET /api/connect requires a session and returns mcpUrl, token, and the tool catalog", async () => {
  expect((await fetch(`${url}/api/connect`)).status).toBe(401);
  const cookie = await login();
  const body = await (await fetch(`${url}/api/connect`, { headers: { cookie } })).json();
  expect(body.mcpUrl).toMatch(/\/mcp$/);
  expect(body.authToken).toBe("test-token");
  expect(body.tools.map((t: any) => t.name)).toEqual(["query", "remember", "list_capabilities", "invoke"]);
});
```
In the same file's `boot()`, add `authToken: "test-token",` to the `createApiRouter({ ... })` deps object.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/dashboard/api.test.ts`
Expected: FAIL — `/api/connect` 404, and/or a TS error that `authToken` is missing (once the type is added in Step 3).

- [ ] **Step 3: Add `authToken` to `ApiDeps` and the route**

In `src/dashboard/api.ts`:
- Add to the `ApiDeps` interface: `authToken: string;`
- Add the import: `import { TOOL_CATALOG } from "../toolCatalog.js";`
- Add the route after the `requireSession` middleware (e.g. just before `router.get("/capabilities", ...)`):
```ts
router.get("/connect", (_req, res) => {
  res.json({ mcpUrl: `${deps.baseUrl}/mcp`, authToken: deps.authToken, tools: TOOL_CATALOG });
});
```

- [ ] **Step 4: Pass the token from `index.ts`**

In `src/index.ts`, inside the `mountDashboard(app, { ... })` deps, add:
```ts
authToken: config.authToken,
```

- [ ] **Step 5: Fix the other two ApiDeps test setups so they compile**

- In `test/dashboard/api-ops.test.ts` `boot()`, add `authToken: "test-token",` to the `createApiRouter({ ... })` deps.
- In `test/dashboard/authRoute.test.ts` `boot()`, add `authToken: "test-token",` to the `mountDashboard(app, { ... })` deps.

- [ ] **Step 6: Run the dashboard suite**

Run: `npx vitest run test/dashboard`
Expected: PASS (including the new `/api/connect` test).

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/api.ts src/index.ts test/dashboard/api.test.ts test/dashboard/api-ops.test.ts test/dashboard/authRoute.test.ts
git commit -m "feat(api): add GET /api/connect (mcpUrl + token + tool catalog)"
```

---

### Task 3: Web API client

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add types + method**

In `web/src/api.ts`, add near the other interfaces:
```ts
export interface ToolDoc { name: string; description: string; params: { name: string; type: string; required: boolean }[] }
export interface ConnectInfo { mcpUrl: string; authToken: string; tools: ToolDoc[] }
```
And add to the `api` object (next to `tree`, `history`, etc.):
```ts
connect: () => json<ConnectInfo>("/api/connect"),
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc -b --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(web): add api.connect() client"
```

---

### Task 4: Nav + routing

**Files:**
- Modify: `web/src/components/TopBar.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Add `Connect` to the nav**

In `web/src/components/TopBar.tsx`:
```ts
export const VIEWS = ["Vault", "Capabilities", "Connect", "Integrations", "Secrets", "Artifacts"] as const;
...
const ALWAYS = new Set<View>(["Vault", "Capabilities", "Connect"]);
```

- [ ] **Step 2: Route the view**

In `web/src/App.tsx`, add the import:
```ts
import { Connect } from "./views/Connect";
```
And render it alongside the others:
```tsx
{view === "Connect" && <Connect />}
```

- [ ] **Step 3: Type-check (will fail until Task 5 creates Connect)**

Run: `cd web && npx tsc -b --noEmit && cd ..`
Expected: FAIL — cannot find `./views/Connect`. (Resolved in Task 5; commit Task 4 + 5 together at the end of Task 5.)

---

### Task 5: Connect view + styles + test

**Files:**
- Create: `web/src/views/Connect.tsx`
- Create: `web/src/views/Connect.test.tsx`
- Modify: `web/src/app.css` (append `.connect`-scoped styles)

- [ ] **Step 1: Write the failing test**

`web/src/views/Connect.test.tsx`:
```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  api: {
    connect: vi.fn().mockResolvedValue({
      mcpUrl: "http://localhost:8794/mcp",
      authToken: "secret-token-123",
      tools: [
        { name: "query", description: "Ask your vault.", params: [{ name: "instruction", type: "string", required: true }] },
        { name: "remember", description: "Save a note.", params: [] },
        { name: "list_capabilities", description: "List capabilities.", params: [] },
        { name: "invoke", description: "Run an action.", params: [] },
      ],
    }),
  },
}));

import { Connect } from "./Connect";

afterEach(cleanup);

test("renders the tools, the mcpUrl, and masks the token until revealed", async () => {
  render(<Connect />);
  expect(await screen.findByText("query")).toBeTruthy();
  for (const t of ["remember", "list_capabilities", "invoke"]) expect(screen.getByText(t)).toBeTruthy();
  expect(screen.getAllByText(/localhost:8794\/mcp/).length).toBeGreaterThan(0);
  // token hidden initially
  expect(screen.queryByText(/secret-token-123/)).toBeNull();
  fireEvent.click(screen.getByText(/reveal/i));
  expect(screen.getAllByText(/secret-token-123/).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npx vitest run src/views/Connect.test.tsx && cd ..`
Expected: FAIL — cannot find `./Connect`.

- [ ] **Step 3: Create the view**

`web/src/views/Connect.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api, type ConnectInfo } from "../api";

const MASK = "••••••••••••••••";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* ignore */ }
  };
  return <button className="copy" onClick={copy}>{done ? "Copied" : "Copy"}</button>;
}

export function Connect() {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { api.connect().then(setInfo).catch(() => setInfo(null)); }, []);
  if (!info) return null;

  const realConfig = JSON.stringify(
    { mcpServers: { geode: { type: "http", url: info.mcpUrl, headers: { Authorization: `Bearer ${info.authToken}` } } } },
    null, 2,
  );
  const shownConfig = revealed ? realConfig : realConfig.replace(info.authToken, MASK);
  const realCli = `claude mcp add --transport http geode ${info.mcpUrl} --header "Authorization: Bearer ${info.authToken}"`;
  const shownCli = revealed ? realCli : realCli.replace(info.authToken, MASK);

  return (
    <div className="connect">
      <div className="actions">
        <span className="eyebrow">Connect</span>
        <h1>Connect your vault to an AI client</h1>
        <p className="lede">Two ways to plug in an MCP client — these are alternatives, so pick the one that matches where your AI runs.</p>

        <div className="methods">
          <div className="method">
            <div className="m-top">
              <div className="m-body">
                <h3>Add with a config (JSON)</h3>
                <p className="m-sub">For clients on this machine — Claude Code, Claude Desktop and other local MCP clients reach this kernel directly.</p>
              </div>
              <span className="works">Works now</span>
            </div>
            <div className="code">
              <div className="codebar"><span className="lbl">mcp.json</span><CopyButton text={realConfig} /></div>
              <pre>{shownConfig}</pre>
            </div>
            <div className="cli">
              <div className="lbl">…or one line in Claude Code</div>
              <div className="code">
                <div className="codebar"><span className="lbl">terminal</span><CopyButton text={realCli} /></div>
                <pre>{shownCli}</pre>
              </div>
            </div>
            <div className="divnote">
              This is your kernel's bearer token — anyone with it can use your vault, so it's shown only here.
              <button className="reveal" onClick={() => setRevealed((r) => !r)}>{revealed ? "hide token" : "reveal token"}</button>
            </div>
          </div>

          <div className="ordiv"><span>or</span></div>

          <div className="method preview">
            <div className="m-top">
              <div className="m-body">
                <h3>Add with a URL</h3>
                <p className="m-sub">Paste one URL into Claude and sign in — no token to copy. Works from any Claude client, including claude.ai and mobile.</p>
              </div>
              <span className="soon">Setup required</span>
            </div>
            <div className="m-preview">
              <div className="urlbar">https://&lt;your-vault&gt;.geodemcp.com/mcp</div>
              <ol className="steps">
                <li>In Claude → <b>Settings → Connectors → Add custom connector</b></li>
                <li>Paste the URL above and click <b>Add</b></li>
                <li>Click <b>Connect</b> and sign in to authorize Geode (OAuth)</li>
              </ol>
            </div>
            <div className="cta-row">
              <button className="btn disabled" disabled>Set up a public tunnel →</button>
              <span className="cta-note">A public URL + sign-in connector aren't enabled yet. Turn on a tunnel to activate this.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="about">
        <span className="eyebrow">What it does</span>
        <h2>Your AI works against your vault</h2>
        <p className="intro">Geode speaks the Model Context Protocol (MCP). Once connected, a client gains the tools below and works directly against your context vault.</p>
        <div className="rail-lbl">Tools a connected client can call</div>
        {info.tools.map((t) => (
          <div className="tool" key={t.name}>
            <span className="tname">{t.name}</span>
            <p className="tdesc">{t.description}</p>
            <div className="params">
              {t.params.length === 0
                ? <span className="pchip muted">no parameters</span>
                : t.params.map((p) => <span className={`pchip${p.required ? "" : " opt"}`} key={p.name}><b>{p.name}</b> {p.type}{p.required ? "" : "?"}</span>)}
            </div>
          </div>
        ))}
        <div className="trust">Secrets stay server-side. The agent never reads them and never calls integrations itself — your client runs <code>invoke</code> and the kernel injects the secret into the outbound request.</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append `.connect`-scoped styles to `web/src/app.css`**

Append this block to `web/src/app.css` (uses the existing CSS variables; ported from `docs/design/mockups/connect-page.html`, scoped under `.connect` to avoid collisions):
```css
/* Connect page */
.connect{flex:1;display:flex;min-height:0;}
.connect .actions{flex:1;min-width:0;overflow:auto;padding:32px 40px 80px;}
.connect .about{flex:0 0 36%;min-width:380px;overflow:auto;border-left:1px solid var(--border);background:var(--surface);padding:30px 30px 80px;}
.connect h1{font-family:"Instrument Sans",sans-serif;font-weight:700;font-size:26px;letter-spacing:-.02em;margin:9px 0 7px;}
.connect .lede{color:var(--muted);font-size:14px;line-height:1.55;max-width:64ch;margin:0;}
.connect .methods{margin-top:26px;}
.connect .ordiv{display:flex;align-items:center;gap:14px;margin:16px 2px;color:var(--faint);}
.connect .ordiv::before,.connect .ordiv::after{content:"";flex:1;height:1px;background:var(--border);}
.connect .ordiv span{font-family:"Instrument Sans",sans-serif;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.16em;}
.connect .method{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:18px;}
.connect .m-top{display:flex;align-items:flex-start;gap:12px;}
.connect .m-body{flex:1;min-width:0;}
.connect .method h3{font-family:"Instrument Sans",sans-serif;font-weight:600;font-size:15px;margin:0;}
.connect .m-sub{color:var(--muted);font-size:13px;line-height:1.5;margin:3px 0 0;}
.connect .works{display:inline-flex;align-items:center;gap:6px;font-family:"Instrument Sans",sans-serif;font-size:11.5px;font-weight:600;color:var(--green);background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.4);border-radius:999px;padding:4px 10px;flex:none;}
.connect .soon{display:inline-flex;align-items:center;gap:6px;font-family:"Instrument Sans",sans-serif;font-size:11.5px;font-weight:600;color:#d9a13a;background:rgba(217,161,58,.1);border:1px solid rgba(217,161,58,.4);border-radius:999px;padding:4px 10px;flex:none;}
.connect .code{margin-top:15px;background:var(--input);border:1px solid var(--border-strong);border-radius:10px;overflow:hidden;}
.connect .codebar{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);}
.connect .codebar .lbl{font-family:"Geist Mono",monospace;font-size:11.5px;color:var(--faint);}
.connect .copy{margin-left:auto;font-family:"Instrument Sans",sans-serif;font-size:12.5px;background:transparent;border:1px solid var(--border-strong);color:var(--neutral-200);border-radius:6px;padding:5px 11px;cursor:pointer;}
.connect .copy:hover{border-color:var(--green);color:var(--green);}
.connect .code pre{margin:0;padding:14px 15px;font-family:"Geist Mono",monospace;font-size:12.5px;line-height:1.75;color:var(--text);overflow:auto;white-space:pre-wrap;word-break:break-all;}
.connect .cli{margin-top:11px;}
.connect .cli .lbl{font-family:"Instrument Sans",sans-serif;font-size:12.5px;color:var(--faint);margin-bottom:6px;}
.connect .divnote{margin-top:14px;color:var(--faint);font-size:12.5px;line-height:1.5;}
.connect .reveal{font-family:"Instrument Sans",sans-serif;font-size:12px;color:var(--emerald-300);background:transparent;border:none;cursor:pointer;text-decoration:underline;padding:0 0 0 6px;}
.connect .preview .m-preview{opacity:.62;}
.connect .urlbar{margin-top:15px;background:var(--input);border:1px dashed var(--border-strong);border-radius:10px;padding:12px 14px;color:var(--faint);font-family:"Geist Mono",monospace;font-size:13px;}
.connect .steps{counter-reset:s;list-style:none;margin:15px 0 0;padding:0;}
.connect .steps li{position:relative;padding:0 0 11px 30px;color:var(--muted);font-size:13.5px;line-height:1.5;}
.connect .steps li::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:0;width:20px;height:20px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border-strong);color:var(--faint);font-family:"Geist Mono",monospace;font-size:11px;display:flex;align-items:center;justify-content:center;}
.connect .cta-row{display:flex;align-items:center;gap:12px;margin-top:18px;flex-wrap:wrap;}
.connect .btn.disabled{background:var(--surface-2);border-color:var(--border-strong);color:var(--faint);cursor:not-allowed;}
.connect .cta-note{color:var(--faint);font-size:12.5px;max-width:42ch;}
.connect .about h2{font-family:"Instrument Sans",sans-serif;font-weight:600;font-size:18px;letter-spacing:-.01em;margin:9px 0 8px;}
.connect .about .intro{color:var(--muted);font-size:13.5px;line-height:1.6;margin:0;}
.connect .rail-lbl{font-family:"Instrument Sans",sans-serif;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.16em;color:var(--faint);margin:26px 0 12px;}
.connect .tool{padding:13px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);margin-bottom:9px;}
.connect .tname{font-family:"Geist Mono",monospace;font-size:13px;color:var(--emerald-300);font-weight:500;}
.connect .tdesc{color:var(--muted);font-size:12.5px;line-height:1.5;margin:3px 0 0;}
.connect .params{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;}
.connect .pchip{font-family:"Geist Mono",monospace;font-size:11px;color:var(--faint);border:1px solid var(--border);border-radius:6px;padding:2px 7px;}
.connect .pchip b{color:var(--neutral-200);font-weight:500;}
.connect .pchip.opt{opacity:.7;}
.connect .trust{margin-top:18px;padding:13px 14px;border:1px solid rgba(52,211,153,.3);border-radius:12px;background:rgba(52,211,153,.06);color:var(--muted);font-size:12.5px;line-height:1.55;}
.connect .trust code{font-family:"Geist Mono",monospace;font-size:11px;color:var(--emerald-300);}
```

- [ ] **Step 5: Run the web test**

Run: `cd web && npx vitest run src/views/Connect.test.tsx && cd ..`
Expected: PASS.

- [ ] **Step 6: Full web type-check + tests + build**

Run: `cd web && npx tsc -b --noEmit && npx vitest run && npm run build && cd ..`
Expected: type-check clean, all web tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/views/Connect.tsx web/src/views/Connect.test.tsx web/src/app.css web/src/components/TopBar.tsx web/src/App.tsx
git commit -m "feat(web): add Connect view, nav entry, and styles"
```

---

### Task 6: Manual E2E note + live validation

**Files:**
- Modify: `test/dashboard.e2e.manual.md`

- [ ] **Step 1: Add a Connect smoke step**

Append under Increment C (or a new "Connect" subsection):
```markdown
## Connect page (manual)

19. Click **Connect** (always visible in the nav). Left column shows two alternative methods separated by "or": **Add with a config (JSON)** ("Works now") and **Add with a URL** ("Setup required", disabled). Right rail lists the 4 tools (query/remember/list_capabilities/invoke) + a secret-injection note.
20. The JSON shows the bearer masked; click **reveal token** → the real token appears; **Copy** copies the full config with the real token. The CLI one-liner copies likewise.
21. The "Set up a public tunnel →" button is disabled (wires to sub-project C).
```

- [ ] **Step 2: Live validation**

```bash
cd web && npm run build && cd ..
# restart the demo kernel (tsx doesn't hot-reload backend changes)
```
Open `http://localhost:8794/`, log in, click **Connect**: verify the two-column layout, copy/reveal behaviour, the 4 tools on the right, and method 2's disabled preview.

- [ ] **Step 3: Commit**

```bash
git add test/dashboard.e2e.manual.md
git commit -m "docs: add Connect page manual E2E steps"
```

---

## Self-review notes

- **Spec coverage:** nav placement (Task 4), tool catalog single-source-of-truth (Task 1), `GET /api/connect` (Task 2), token masked+reveal+copy (Task 5), two-column layout + method-2 preview (Task 5). ✔
- **Type consistency:** `ToolDoc`/`ToolParam` defined once in `src/toolCatalog.ts`; web mirrors the shape in `web/src/api.ts` (`ToolDoc`/`ConnectInfo`). `ApiDeps.authToken` added and threaded from `config.authToken`; the three test setups that construct `ApiDeps`/`DashboardDeps` are updated so the suite compiles.
- **Deferred (not this plan):** the tunnel provider + "Set up a tunnel" wiring (C); OAuth metadata/endpoints and a live method-2 (B).
