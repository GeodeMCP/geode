# Per-Client Connect Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Connect page's single, misleading local-connect snippet with a per-client picker (Claude Code, Cursor, VS Code, Claude Desktop, Other) that renders the correct MCP config for each client.

**Architecture:** Front-end only. `web/src/views/Connect.tsx` gains a small `CLIENTS` data array; each entry produces the right snippet(s) from the existing `GET /api/connect` values (`mcpUrl`, `authToken`). A segmented picker swaps which client's block is shown. The bearer token is pre-injected into every snippet, masked by default behind the existing reveal/copy control. The "Add with a URL" (remote OAuth) method and the right-hand tools rail are unchanged. No backend/API/type changes.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react (jsdom), CSS in `web/src/app.css`.

## Global Constraints

- **All UI strings English** (memory `english-only-app-strings`). No Dutch in the codebase.
- **Front-end only** — do NOT touch `src/`, the dashboard API, or the `ConnectInfo`/`ToolDoc` types. Snippets derive solely from `info.mcpUrl` and `info.authToken`.
- **Token hygiene:** the real token is pre-filled into snippets but **masked by default**; a single reveal toggle governs all snippets; `Copy` always copies the real (unmasked) text.
- **Reuse existing CSS language** (`.method`, `.code`, `.codebar`, `.copy`, `.divnote`, `.reveal`); new classes scoped under `.connect`.
- **Keep the URL method and the tools rail byte-for-byte** from the current `Connect.tsx`.
- Run web commands from `web/`: tests `npm test`, typecheck `npm run typecheck`, build `npm run build`.

---

### Task 1: Client picker + per-client snippets in `Connect.tsx` (with tests)

**Files:**
- Modify: `web/src/views/Connect.tsx` (full rewrite of the component; `CopyButton` unchanged)
- Test: `web/src/views/Connect.test.tsx` (add 5 tests; keep the existing 3)

**Interfaces:**
- Consumes: `api.connect(): Promise<ConnectInfo>` where `ConnectInfo = { mcpUrl: string; authToken: string; tools: ToolDoc[]; publicBaseUrl: string | null }` (unchanged).
- Produces: the `Connect` React component (default export via named `export function Connect()`), unchanged signature — App routing already imports it.

- [ ] **Step 1: Add the failing tests**

Append these tests to `web/src/views/Connect.test.tsx` (keep the three existing tests as-is):

```tsx
test("defaults to Claude Code with an http config and the one-liner", async () => {
  render(<Connect />);
  await screen.findByText("query");
  expect(screen.getAllByText(/"type": "http"/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/claude mcp add --transport http geode/).length).toBeGreaterThan(0);
});

test("VS Code uses the servers key", async () => {
  render(<Connect />);
  await screen.findByText("query");
  fireEvent.click(screen.getByRole("tab", { name: "VS Code" }));
  expect(screen.getAllByText(/"servers":/).length).toBeGreaterThan(0);
});

test("Claude Desktop shows the mcp-remote bridge with --allow-http", async () => {
  render(<Connect />);
  await screen.findByText("query");
  fireEvent.click(screen.getByRole("tab", { name: "Claude Desktop" }));
  expect(screen.getAllByText(/mcp-remote/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/--allow-http/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/AUTH_HEADER/).length).toBeGreaterThan(0);
});

test("Other shows the raw URL and both config shapes", async () => {
  render(<Connect />);
  await screen.findByText("query");
  fireEvent.click(screen.getByRole("tab", { name: "Other MCP client" }));
  expect(screen.getAllByText(/localhost:8794\/mcp/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/"type": "http"/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/mcp-remote/).length).toBeGreaterThan(0);
});

test("Copy sends the real (unmasked) config to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<Connect />);
  await screen.findByText("query");
  expect(screen.queryByText(/secret-token-123/)).toBeNull(); // masked on screen
  fireEvent.click(screen.getAllByText("Copy")[0]);
  expect(writeText).toHaveBeenCalled();
  expect(writeText.mock.calls[0][0]).toContain("secret-token-123");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test -- Connect`
Expected: FAIL — the new tests error (no `role="tab"` elements yet; default snippet has no `claude mcp add` line). The 3 existing tests still pass.

- [ ] **Step 3: Rewrite `Connect.tsx`**

Replace the entire contents of `web/src/views/Connect.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { api, type ConnectInfo } from "../api";

const MASK = "••••••••••••••••";

/** Button that copies the given text to the clipboard and briefly shows a "Copied" confirmation. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* ignore */ }
  };
  return <button className="copy" onClick={copy}>{done ? "Copied" : "Copy"}</button>;
}

/** A labelled config snippet shown in a code block. */
type Snippet = { lbl: string; text: string };
/** A supported MCP client and how to configure it against this kernel. */
type ClientDef = {
  id: string;
  label: string;
  hint: string;
  snippets: (url: string, token: string) => Snippet[];
  note?: string;
  check?: string;
};

/** Builds an HTTP-native MCP config (Pattern A) with a bearer header, under the client's config key. */
function httpConfig(key: "mcpServers" | "servers", url: string, token: string, withType: boolean): string {
  const server = { ...(withType ? { type: "http" } : {}), url, headers: { Authorization: `Bearer ${token}` } };
  return JSON.stringify({ [key]: { geode: server } }, null, 2);
}

/** Builds a stdio-bridge MCP config (Pattern B) via `npx mcp-remote`; token passed through env to avoid the space-in-arg bug. */
function bridgeConfig(url: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { geode: {
      command: "npx",
      args: ["-y", "mcp-remote", url, "--allow-http", "--header", "Authorization:${AUTH_HEADER}"],
      env: { AUTH_HEADER: `Bearer ${token}` },
    } } },
    null, 2,
  );
}

const CLIENTS: ClientDef[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    hint: "Add to ~/.claude.json (user) or .mcp.json (project) — or run the one-liner:",
    snippets: (url, token) => [
      { lbl: "mcp.json", text: httpConfig("mcpServers", url, token, true) },
      { lbl: "…or one line in your terminal", text: `claude mcp add --transport http geode ${url} --header "Authorization: Bearer ${token}"` },
    ],
    check: "Run `claude mcp list` — geode should say ✔ Connected.",
  },
  {
    id: "cursor",
    label: "Cursor",
    hint: "Add to ~/.cursor/mcp.json (global) or .cursor/mcp.json (project), then restart Cursor:",
    snippets: (url, token) => [{ lbl: "mcp.json", text: httpConfig("mcpServers", url, token, false) }],
    check: "Settings → MCP shows geode with a green dot.",
  },
  {
    id: "vscode",
    label: "VS Code",
    hint: "Add to .vscode/mcp.json (project) or your user mcp.json (Command Palette → “MCP: Open User Configuration”):",
    snippets: (url, token) => [{ lbl: "mcp.json", text: httpConfig("servers", url, token, true) }],
    note: "The top-level key is servers, not mcpServers.",
    check: "Reload the window; the Agent panel lists the geode tools.",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    hint: "Settings → Developer → Edit Config. The “Add custom connector” field is HTTPS-only — don’t use it for localhost.",
    snippets: (url, token) => [{ lbl: "claude_desktop_config.json", text: bridgeConfig(url, token) }],
    note: "Desktop only speaks stdio, so this bridges via mcp-remote. --allow-http is required for localhost. Restart Desktop fully.",
    check: "After restart, ask Desktop to list its tools — geode appears.",
  },
  {
    id: "other",
    label: "Other MCP client",
    hint: "Use your client’s MCP config. Most clients accept the HTTP form; if yours only takes a command server, use the bridge.",
    snippets: (url, token) => [
      { lbl: "server URL", text: url },
      { lbl: "HTTP (most clients)", text: httpConfig("mcpServers", url, token, true) },
      { lbl: "stdio bridge (mcp-remote)", text: bridgeConfig(url, token) },
    ],
    note: "Field names differ per client (VS Code uses servers). Check your client’s MCP docs for the config-file location.",
  },
];

/** Masks every occurrence of the token unless revealed. */
function mask(text: string, token: string, revealed: boolean): string {
  return revealed ? text : text.split(token).join(MASK);
}

/** Renders the Connect view: a per-client MCP config picker, the remote-URL connector, and a tools rail. */
export function Connect() {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [clientId, setClientId] = useState(CLIENTS[0].id);
  useEffect(() => { api.connect().then(setInfo).catch(() => setInfo(null)); }, []);
  if (!info) return null;

  const client = CLIENTS.find((c) => c.id === clientId) ?? CLIENTS[0];
  const snippets = client.snippets(info.mcpUrl, info.authToken);

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
                <h3>Add to your MCP client</h3>
                <p className="m-sub">Pick your client for the exact config — it reaches this kernel directly on this machine.</p>
              </div>
              <span className="works">Works now</span>
            </div>

            <div className="clientpicker" role="tablist">
              {CLIENTS.map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={c.id === clientId}
                  className={`clienttab${c.id === clientId ? " active" : ""}`}
                  onClick={() => setClientId(c.id)}
                >{c.label}</button>
              ))}
            </div>

            <p className="confighint">{client.hint}</p>

            {snippets.map((s) => (
              <div className="code" key={s.lbl}>
                <div className="codebar"><span className="lbl">{s.lbl}</span><CopyButton text={s.text} /></div>
                <pre>{mask(s.text, info.authToken, revealed)}</pre>
              </div>
            ))}

            {client.note ? <p className="mnote">{client.note}</p> : null}
            {client.check ? <p className="checkline">✓ {client.check}</p> : null}

            <div className="divnote">
              This is your kernel&apos;s bearer token — anyone with it can use your vault, so it&apos;s shown only here.
              <button className="reveal" onClick={() => setRevealed((r) => !r)}>{revealed ? "hide token" : "reveal token"}</button>
            </div>
          </div>

          <div className="ordiv"><span>or</span></div>

          <div className={`method${info.publicBaseUrl ? "" : " preview"}`}>
            <div className="m-top">
              <div className="m-body">
                <h3>Add with a URL</h3>
                <p className="m-sub">Paste one URL into Claude and sign in — no token to copy. Works from any Claude client, including claude.ai and mobile.</p>
              </div>
              <span className={info.publicBaseUrl ? "works" : "soon"}>{info.publicBaseUrl ? "Ready" : "Setup required"}</span>
            </div>
            {info.publicBaseUrl ? (
              <>
                <div className="code">
                  <div className="codebar"><span className="lbl">connector URL</span><CopyButton text={`${info.publicBaseUrl}/mcp`} /></div>
                  <pre>{`${info.publicBaseUrl}/mcp`}</pre>
                </div>
                <ol className="steps">
                  <li>In Claude → <b>Settings → Connectors → Add custom connector</b></li>
                  <li>Paste the URL above and click <b>Add</b></li>
                  <li>Click <b>Connect</b> and sign in to authorize Geode (OAuth)</li>
                </ol>
              </>
            ) : (
              <>
                <div className="m-preview">
                  <div className="urlbar">https://&lt;your-vault&gt;.geodemcp.com/mcp</div>
                  <ol className="steps">
                    <li>In Claude → <b>Settings → Connectors → Add custom connector</b></li>
                    <li>Paste the URL above and click <b>Add</b></li>
                    <li>Click <b>Connect</b> and sign in to authorize Geode (OAuth)</li>
                  </ol>
                </div>
                <div className="cta-row">
                  <button className="btn disabled" disabled>Use GeodeMCP&apos;s managed tunnel (premium)</button>
                  <span className="cta-note">Running on localhost — connect from claude.ai with our managed tunnel (coming soon), or set a public <code>GEODE_BASE_URL</code>.</span>
                </div>
              </>
            )}
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
        <div className="trust">Secrets stay server-side. The agent never reads them and never calls tools itself — your client runs <code>invoke</code> and the kernel injects the secret into the outbound request.</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd web && npm test -- Connect && npm run typecheck`
Expected: all 8 Connect tests PASS; `tsc --noEmit` reports no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Connect.tsx web/src/views/Connect.test.tsx
git commit -m "feat(connect): per-client MCP config picker

Claude Code / Cursor / VS Code / Claude Desktop / Other, each with the correct
snippet (VS Code servers key; Desktop mcp-remote --allow-http bridge). Token
pre-injected, masked with reveal, Copy sends the real config. Front-end only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Picker styling in `app.css`

**Files:**
- Modify: `web/src/app.css` (append after line 265; new rules scoped under `.connect`)

**Interfaces:**
- Consumes: the class names emitted by Task 1 — `.clientpicker`, `.clienttab`, `.clienttab.active`, `.confighint`, `.mnote`, `.checkline`.
- Produces: nothing consumed by other tasks (pure styling).

- [ ] **Step 1: Append the styles**

Add to the end of `web/src/app.css`:

```css
.connect .clientpicker{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0 2px;}
.connect .clienttab{font-family:"Instrument Sans",sans-serif;font-size:12.5px;font-weight:500;color:var(--muted);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;padding:6px 12px;cursor:pointer;}
.connect .clienttab:hover{color:var(--neutral-200);border-color:var(--faint);}
.connect .clienttab.active{color:var(--emerald-300);background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.5);}
.connect .confighint{color:var(--muted);font-size:12.5px;line-height:1.5;margin:12px 0 0;}
.connect .mnote{color:var(--faint);font-size:12.5px;line-height:1.5;margin:11px 0 0;}
.connect .checkline{color:var(--emerald-300);font-size:12.5px;line-height:1.5;margin:9px 0 0;}
```

- [ ] **Step 2: Build the SPA to confirm it compiles**

Run: `cd web && npm run build`
Expected: `tsc -b && vite build` succeeds, writes `web/dist/`.

- [ ] **Step 3: Commit**

```bash
git add web/src/app.css
git commit -m "style(connect): client picker + hint/note/check styling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Live validation

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full web test suite and typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 2: Build and run the kernel from the worktree**

The worktree has no `.env` (gitignored). Reuse the main checkout's env and a free port:

```bash
# from the worktree root
cd web && npm run build && cd ..
GEODE_PORT=8788 npx tsx --env-file=/Users/robbertvermeulen/Projects/geodemcp-2/.env src/index.ts
```
Expected: `Geode kernel listening on http://localhost:8788/mcp`.

- [ ] **Step 3: Click through the Connect page**

Open `http://localhost:8788/` → log in → **Connect**. Verify:
- The picker shows five tabs; **Claude Code** is selected by default and shows the `mcp.json` + `claude mcp add …` one-liner.
- **VS Code** tab → snippet's top-level key is `servers`.
- **Claude Desktop** tab → snippet is the `npx mcp-remote … --allow-http` bridge with `AUTH_HEADER` in `env`, and the "custom-connector field is HTTPS-only" hint shows.
- **Other** tab → raw server URL + both shapes.
- `reveal token` shows the real token in the visible snippet; `Copy` on the Claude Code block puts the real (unmasked) config on the clipboard.
- The **Add with a URL** card and the right-hand tools rail are unchanged.

- [ ] **Step 4: Stop the validation kernel**

Stop the port-8788 kernel (Ctrl-C / kill the background process). Leave the original :8787 kernel running.

---

## Self-Review

- **Spec coverage:** picker with 5 clients (Task 1) ✓; per-client correct snippets incl. VS Code `servers` + Desktop `mcp-remote --allow-http` + env token (Task 1) ✓; generic "Other" fallback (Task 1) ✓; pre-injected masked token + reveal + real-copy (Task 1) ✓; URL method + rail unchanged (Task 1, verbatim) ✓; no backend change (constraints + Task 1 uses only `mcpUrl`/`authToken`) ✓; styling (Task 2) ✓; live validation incl. re-verified Claude Code path (Task 3) ✓. Deferred items (deeplinks, test-connection, rotation) intentionally absent.
- **Placeholder scan:** none — all code and commands are literal.
- **Type consistency:** `httpConfig(key, url, token, withType)`, `bridgeConfig(url, token)`, `mask(text, token, revealed)`, `ClientDef.snippets(url, token) → Snippet[]`, `Snippet = {lbl, text}` — used consistently across the component and referenced class names match Task 2's CSS.
