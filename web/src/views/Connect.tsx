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
