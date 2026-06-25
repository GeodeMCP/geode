const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const SHELL = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Geode — connect</title>
<style>
:root{--bg:#0b0f0e;--surface:#141917;--input:#080b0a;--text:#f2f2f2;--muted:#a3a3a3;--faint:#777;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.12);--green:#34d399;--emerald-300:#6ee7b7;--blue:#2563eb;--blue-500:#3b82f6;--blue-100:#dbeafe;}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
.name{font-weight:600;font-size:19px;margin-bottom:14px}
.card{width:460px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.17em;font-weight:600;color:var(--green)}
h2{font-size:21px;margin:6px 0 4px}.scope{display:inline-block;font-family:monospace;font-size:12.5px;color:var(--emerald-300);border:1px solid var(--border-strong);border-radius:999px;padding:4px 11px;margin:8px 0}
label{font-size:12.5px;color:var(--muted);display:block;margin:10px 0 6px}
input{width:100%;background:var(--input);border:1px solid var(--border-strong);border-radius:9px;padding:12px 13px;color:var(--text);font-size:14px}
.row{display:flex;gap:10px;margin-top:16px}.btn{flex:1;font-weight:500;font-size:14.5px;border-radius:8px;padding:12px 16px;cursor:pointer;border:1px solid}
.approve{background:var(--blue);border-color:var(--blue-500);color:var(--blue-100)}.deny{background:transparent;border-color:var(--border-strong);color:var(--muted)}
.err{color:#eaa;font-size:13px;margin:6px 0}.note{color:var(--faint);font-size:12.5px;line-height:1.5;margin:12px 0 0}
</style></head><body><div class="name">Geode</div>${body}</body></html>`;

/** Renders the OAuth consent HTML page, optionally including login fields and an error message when credentials are required or invalid. */
export function renderConsent(opts: { clientName: string; scope: string; action: string; req: string; needsLogin: boolean; error?: string }): string {
  const login = opts.needsLogin
    ? `<label>Email</label><input type="email" name="email" autocomplete="username" autofocus>
       <label>Password</label><input type="password" name="password" autocomplete="current-password">`
    : "";
  return SHELL(`<form class="card" method="post" action="${esc(opts.action)}">
    <span class="eyebrow">Connect</span>
    <h2>Allow ${esc(opts.clientName || "this client")} to access your vault?</h2>
    <span class="scope">scope: ${esc(opts.scope)}</span>
    <input type="hidden" name="req" value="${esc(opts.req)}">
    ${login}
    ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
    <div class="row">
      <button class="btn deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="btn approve" type="submit" name="decision" value="approve">Approve</button>
    </div>
    <p class="note">Approving lets this client read and write your vault and run integrations on your behalf, via the Model Context Protocol.</p>
  </form>`);
}
