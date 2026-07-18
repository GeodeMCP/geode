const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Splits a secret ref `<tool>__<connection>__<KEY>` into its human-readable parts. Falls back to treating the whole ref as the key when it isn't composite. */
function parseRef(ref: string): { tool: string; connection: string; key: string } {
  const parts = ref.split("__");
  if (parts.length < 3) return { tool: "", connection: "", key: ref };
  return { tool: parts[0], connection: parts.slice(1, -1).join("__"), key: parts[parts.length - 1] };
}

const LOCK_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="3"/><path d="M8 10.5V7.2a4 4 0 0 1 7.6-1.9"/><circle cx="12" cy="15" r="1.5"/><path d="M12 16.5v2.1"/></svg>`;
const LOCK_CLOSED = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="3"/><path d="M8 10.5V7.2a4 4 0 0 1 8 0v3.3"/><circle cx="12" cy="15" r="1.5"/><path d="M12 16.5v2.1"/></svg>`;
const CLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 1.9"/></svg>`;
const INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg>`;

/** A tool · connection breadcrumb: which account this secret belongs to. Rendered only for composite refs. */
function breadcrumb(tool: string, connection: string): string {
  if (!tool && !connection) return "";
  return `<div class="ctx"><span class="tool">${esc(tool)}</span><span class="sep">·</span>${esc(connection)}</div>`;
}

const SHELL = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Geode — secret</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&family=Onest:wght@500&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0f0e;--surface:#141917;--input:#080b0a;--text:#f2f2f2;--muted:#a3a3a3;--faint:#777;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.12);--green:#34d399;--emerald-300:#6ee7b7;--amber:#e0a340;--blue:#2563eb;--blue-500:#3b82f6;--blue-100:#dbeafe;}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:"Geist",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.name{font-family:"Onest",sans-serif;font-weight:500;font-size:19px;letter-spacing:-.02em;margin-bottom:14px}
.card{width:460px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px}
.head{display:flex;gap:14px;align-items:flex-start;margin-bottom:2px}
.tile{width:42px;height:42px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center}
.tile svg{width:22px;height:22px}
.tile.unset{background:rgba(224,163,64,.10);border:1px solid rgba(224,163,64,.34);color:var(--amber)}
.tile.sealed{background:rgba(52,211,153,.10);border:1px solid rgba(52,211,153,.34);color:var(--emerald-300)}
.tile.dead{background:rgba(230,80,80,.10);border:1px solid rgba(230,80,80,.34);color:#eaa}
.meta{min-width:0;flex:1}
.eyebrow{font-family:"Instrument Sans";font-size:11px;text-transform:uppercase;letter-spacing:.15em;font-weight:600;color:var(--green)}
.eyebrow.dead{color:#eaa}
h2{font-family:"Geist Mono",monospace;font-weight:500;font-size:20px;letter-spacing:-.01em;margin:5px 0 0;overflow-wrap:anywhere}
.ctx{font-family:"Instrument Sans";font-size:12.5px;color:var(--muted);margin-top:5px}
.ctx .tool{font-family:"Geist Mono",monospace;color:var(--emerald-300)}
.ctx .sep{color:var(--faint);margin:0 7px}
.validity{display:inline-flex;gap:7px;align-items:center;font-family:"Instrument Sans";font-size:12.5px;color:var(--muted);border:1px solid var(--border-strong);border-radius:999px;padding:5px 12px 5px 10px;margin:18px 0 16px}
.validity svg{width:14px;height:14px;color:var(--faint)}
.field{display:block}
.field-label{font-family:"Instrument Sans";font-size:12px;font-weight:500;color:var(--faint);display:block;margin-bottom:7px}
input{width:100%;background:var(--input);border:1px solid var(--border-strong);border-radius:9px;padding:12px 13px;color:var(--text);font-family:"Geist Mono",monospace;font-size:14px}
input::placeholder{color:var(--faint)}
input:focus{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(52,211,153,.18)}
.note{display:flex;gap:9px;color:var(--faint);font-size:12.5px;line-height:1.5;margin:14px 0 18px}
.note svg{width:15px;height:15px;flex:none;margin-top:1px;color:var(--emerald-300);opacity:.8}
.btn{width:100%;font-family:"Instrument Sans";font-weight:500;font-size:14.5px;background:var(--blue);border:1px solid var(--blue-500);color:var(--blue-100);border-radius:8px;padding:12px 16px;cursor:pointer}
.btn:hover{background:#1d4ed8}
.err{color:#eaa;font-size:13px;margin:10px 0 0}
.result-msg{color:var(--muted);font-size:14px;line-height:1.55;margin:16px 0 0}
</style></head><body><div class="name">Geode</div>${body}</body></html>`;

/** Renders the HTML form that lets a user paste a secret value for the given ref into the broker. */
export function renderAuthScreen(opts: { ref: string; action: string; minutesLeft: number; error?: string }): string {
  const { tool, connection, key } = parseRef(opts.ref);
  return SHELL(`<form class="card" method="post" action="${esc(opts.action)}">
    <div class="head">
      <div class="tile unset">${LOCK_OPEN}</div>
      <div class="meta">
        <span class="eyebrow">Add secret</span>
        <h2>${esc(key)}</h2>
        ${breadcrumb(tool, connection)}
      </div>
    </div>
    <div class="validity">${CLOCK} Expires in ${opts.minutesLeft} min · single use</div>
    <label class="field">
      <span class="field-label">Secret value</span>
      <input type="password" name="value" placeholder="Paste the value…" autocomplete="off" autofocus>
    </label>
    ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
    <div class="note">${INFO}<span>Saved straight into the broker, encrypted at rest. The agent only ever receives the reference — never this value.</span></div>
    <button class="btn" type="submit">Save secret</button>
  </form>`);
}

/** Renders an HTML confirmation page indicating whether the secret was saved successfully or the link was invalid. */
export function renderAuthResult(opts: { ok: boolean; ref: string; message: string }): string {
  if (!opts.ok) {
    return SHELL(`<div class="card">
      <div class="head">
        <div class="tile dead">${LOCK_OPEN}</div>
        <div class="meta">
          <span class="eyebrow dead">Link unavailable</span>
          <h2>Expired or already used</h2>
        </div>
      </div>
      <p class="result-msg">${esc(opts.message)}</p>
    </div>`);
  }
  const { tool, connection, key } = parseRef(opts.ref);
  return SHELL(`<div class="card">
    <div class="head">
      <div class="tile sealed">${LOCK_CLOSED}</div>
      <div class="meta">
        <span class="eyebrow">Sealed</span>
        <h2>${esc(key)}</h2>
        ${breadcrumb(tool, connection)}
      </div>
    </div>
    <p class="result-msg">${esc(opts.message)}</p>
  </div>`);
}
