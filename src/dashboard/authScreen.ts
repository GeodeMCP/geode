const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const SHELL = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Geode — secret</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Instrument+Sans:wght@400;500;600;700&family=Onest:wght@500&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0f0e;--surface:#141917;--input:#080b0a;--text:#f2f2f2;--muted:#a3a3a3;--faint:#777;--border:rgba(255,255,255,.07);--border-strong:rgba(255,255,255,.12);--green:#34d399;--emerald-300:#6ee7b7;--amber:#d9a13a;--blue:#2563eb;--blue-500:#3b82f6;--blue-100:#dbeafe;}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font-family:"Geist",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;-webkit-font-smoothing:antialiased}
.name{font-family:"Onest",sans-serif;font-weight:500;font-size:19px;letter-spacing:-.02em;margin-bottom:14px}
.card{width:460px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px}
.eyebrow{font-family:"Instrument Sans";font-size:11px;text-transform:uppercase;letter-spacing:.17em;font-weight:600;color:var(--green)}
h2{font-family:"Instrument Sans";font-weight:600;font-size:21px;letter-spacing:-.02em;margin:6px 0 4px}
.validity{display:inline-flex;gap:8px;align-items:center;font-family:"Instrument Sans";font-size:12.5px;color:var(--muted);border:1px solid var(--border-strong);border-radius:999px;padding:5px 12px;margin:12px 0 16px}
.label{font-family:"Geist Mono",monospace;font-size:12.5px;color:var(--emerald-300);display:block;margin-bottom:7px}
input{width:100%;background:var(--input);border:1px solid var(--border-strong);border-radius:9px;padding:12px 13px;color:var(--text);font-family:"Geist Mono",monospace;font-size:14px}
.note{display:flex;gap:9px;color:var(--faint);font-size:12.5px;line-height:1.5;margin:14px 0 18px}
.btn{width:100%;font-family:"Instrument Sans";font-weight:500;font-size:14.5px;background:var(--blue);border:1px solid var(--blue-500);color:var(--blue-100);border-radius:8px;padding:12px 16px;cursor:pointer}
.err{color:#eaa;font-size:13px;margin:6px 0}
.ok{color:var(--green)}
</style></head><body><div class="name">Geode</div>${body}</body></html>`;

export function renderAuthScreen(opts: { ref: string; action: string; minutesLeft: number; error?: string }): string {
  const ref = esc(opts.ref);
  return SHELL(`<form class="card" method="post" action="${esc(opts.action)}">
    <span class="eyebrow">Add secret</span>
    <h2>${ref}</h2>
    <div class="validity">Expires in ${opts.minutesLeft} min · single use</div>
    <label class="label">${ref}</label>
    <input type="password" name="value" placeholder="Paste the value…" autocomplete="off" autofocus>
    ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
    <div class="note">Goes straight into the broker, encrypted at rest. The agent never sees this value — only the reference ${ref}.</div>
    <button class="btn" type="submit">Save to broker</button>
  </form>`);
}

export function renderAuthResult(opts: { ok: boolean; ref: string; message: string }): string {
  return SHELL(`<div class="card">
    <span class="eyebrow">${opts.ok ? "Done" : "Failed"}</span>
    <h2 class="${opts.ok ? "ok" : ""}">${opts.ok ? esc(opts.ref) : "Invalid link"}</h2>
    <p style="color:var(--muted);font-size:14px">${esc(opts.message)}</p>
  </div>`);
}
