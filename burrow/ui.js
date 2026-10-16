// Selfmail's card on the Burrow page. The host imports this module
// (forge-addon.json "burrow": {"ui"}) and calls card(ctx) on every paint and
// wire(el, ctx) after it. ctx.api talks to /__gate/api/x/selfmail/…, which the
// extension answers from what it knows and what the app says.

const S = { d: null, at: 0, loading: false, error: null };
const LOGO = '<svg viewBox="0 0 64 64" width="15" height="15" aria-hidden="true"><defs><linearGradient id="smlg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse"><stop stop-color="#ff7a45"/><stop offset="1" stop-color="#e5384f"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="#0b0c0e"/><rect x="4" y="4" width="56" height="56" rx="11" fill="url(#smlg)" opacity=".14"/><rect x="11" y="18" width="42" height="30" rx="5" fill="none" stroke="url(#smlg)" stroke-width="3.4" stroke-linejoin="round"/><path d="M13 21.5 32 36l19-14.5" fill="none" stroke="url(#smlg)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const style = document.createElement("style");
style.textContent = `
.sm { padding:0; overflow:hidden; border-color:rgba(255,106,61,.25); background:radial-gradient(120% 140% at 0% 0%, rgba(255,106,61,.07), transparent 55%), var(--card,#0f1012); margin-bottom:14px; }
.sm-head { display:flex; align-items:center; gap:13px; padding:16px 18px; flex-wrap:wrap; }
.sm-head .grow { flex:1; min-width:200px; }
.sm-name { font-weight:650; letter-spacing:-.01em; display:flex; gap:8px; align-items:center; }
.sm-sub { color:var(--muted); font-size:12.5px; margin-top:2px; }
.sm-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); border-top:1px solid var(--line); }
.sm-stat { background:var(--card,#0f1012); padding:11px 16px; }
.sm-stat b { font-size:17px; font-weight:700; display:block; letter-spacing:-.02em; }
.sm-stat span { font-size:11px; color:var(--faint); text-transform:uppercase; letter-spacing:.05em; }
.sm-note { display:flex; gap:10px; align-items:center; padding:10px 18px; border-top:1px solid rgba(242,193,78,.3); background:rgba(242,193,78,.06); font-size:13px; color:#ecdcb0; }
.sm-note svg { flex:none; width:15px; height:15px; }
@media (max-width:700px){ .sm-stats{grid-template-columns:repeat(2,1fr);} }`;
document.head.append(style);

const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>';

function load(ctx) {
  if (S.loading || Date.now() - S.at < 15000) return;
  S.loading = true;
  ctx.api("/state").then((d) => { S.d = d; S.error = null; })
    .catch((e) => { S.error = e.message; })
    .finally(() => { S.loading = false; S.at = Date.now(); ctx.render(); });
}

export function card(ctx) {
  load(ctx);
  const h = ctx.h, d = S.d;
  const c = d?.counts || {};
  const warn = d?.error || (!d?.domain && d?.running ? "No domain is linked yet, so the mailbox has no address: link one under Settings → Domain, then reinstall Selfmail." : null) || d?.note;
  const sub = S.error ? `The app isn't answering (${h(S.error)}).`
    : !d ? "Starting…"
    : d.address ? `${d.accounts > 1 ? `${d.accounts} accounts · ` : ""}${h(d.address)}${d.tunnel?.url ? ` · inbound ${h(d.tunnel.url.replace(/^https?:\/\//, ""))}` : ""}`
    : "no address yet";
  return `<section class="card sm">
    <div class="sm-head">${LOGO}
      <div class="grow"><div class="sm-name">Selfmail ${d?.version ? `<span class="pill">v${h(d.version)}</span>` : ""}</div>
        <div class="sm-sub">${sub}</div></div>
      <a class="btn sm primary" href="/__gate/selfmail/" target="_blank" rel="noopener">Open Selfmail</a>
      <a class="btn sm ghost" href="/__gate/selfmail/#compose" target="_blank" rel="noopener">Compose</a>
    </div>
    ${warn ? `<div class="sm-note">${WARN}<span>${h(warn)}</span></div>` : ""}
    ${d?.running ? `<div class="sm-stats">
      <div class="sm-stat"><b>${c.unread ?? 0}</b><span>unread</span></div>
      <div class="sm-stat"><b>${c.inbox ?? 0}</b><span>received</span></div>
      <div class="sm-stat"><b>${c.drafts ?? 0}</b><span>drafts</span></div>
      <div class="sm-stat"><b>${c.sent ?? 0}</b><span>sent</span></div>
    </div>` : ""}
  </section>`;
}

export function wire() { /* links only */ }
