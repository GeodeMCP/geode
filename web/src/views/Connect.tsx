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

/** Renders the Connect view showing the kernel's bearer token, JSON config snippet, and optional URL-based connector for remote MCP clients. */
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
        <div className="trust">Secrets stay server-side. The agent never reads them and never calls integrations itself — your client runs <code>invoke</code> and the kernel injects the secret into the outbound request.</div>
      </div>
    </div>
  );
}
