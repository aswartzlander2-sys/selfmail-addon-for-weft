// Selfmail's page, in the Bulwark family: sign in to an account, your mail,
// your preset answers; admins get the accounts, the service accounts, the API
// keys and the system. Plain module, no build step, no inline handlers.
// Everything it asks the app for is relative, so the page works both at its
// own port and under the dashboard at /__gate/selfmail/.
"use strict";

if (location.pathname.startsWith("/__gate/") && !location.pathname.endsWith("/")) {
  history.replaceState(null, "", location.pathname + "/" + location.search + location.hash);
}
const UNDER_GATE = location.pathname.startsWith("/__gate/");
if (UNDER_GATE) { const b = document.getElementById("backHost"); if (b) b.hidden = false; }

// If the stylesheet never arrives (a broken update can lose app.css), the page
// still works but looks like a wreck. Say so plainly at the top instead.
const cssOk = () => !!getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
if (!cssOk()) {
  const warnNoCss = () => {
    if (cssOk()) return;
    const b = document.createElement("div");
    b.textContent = "Selfmail's stylesheet didn't load, so everything works but the page won't look right. Updating or reinstalling the addon brings it back (app.css is missing or not being served on this machine).";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#20050a;color:#ffd9df;font:13px/1.5 system-ui,sans-serif;padding:10px 14px;border-bottom:1px solid #f4587a";
    document.body.appendChild(b);
  };
  if (document.readyState === "complete") warnNoCss();
  else addEventListener("load", warnNoCss, { once: true });
}

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const h = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (t) => {
  const d = Date.now() - (t || 0);
  if (d < 0) return "soon";
  if (d < 60e3) return "just now";
  if (d < 3600e3) return `${Math.floor(d / 60e3)}m ago`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
};
const fmtTime = (t) => t ? new Date(t).toLocaleString() : "never";

const ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1Z"/></svg>',
  draft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  dns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1.5"/><rect x="2" y="16" width="20" height="5" rx="1.5"/><path d="M6 5.5h.01M6 18.5h.01M10 5.5h4M10 18.5h4"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
};
for (const i of document.querySelectorAll("[data-i]")) i.innerHTML = ICONS[i.dataset.i] || "";

async function api(path, opts = {}) {
  const r = await fetch("api/" + path.replace(/^\//, ""), {
    headers: { "Content-Type": "application/json" }, ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 3200); }

// a pop-up, bulwark style: html in, the element out; closes on the backdrop
function modal(html) {
  const pop = $("#pop"), card = $("#popCard");
  card.innerHTML = html;
  pop.hidden = false;
  requestAnimationFrame(() => pop.classList.add("open"));
  const close = () => { pop.classList.remove("open"); setTimeout(() => { pop.hidden = true; }, 160); };
  pop.onclick = (e) => { if (e.target === pop) close(); };
  card.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  return { el: card, close };
}

const S = { session: null, view: null, as: null, editing: null, admin: null, pendingCompose: null };
const isAdmin = () => S.session?.user?.role === "admin";
const me = () => S.as || S.session?.user?.username;
const asParam = () => (S.as && S.as !== S.session?.user?.username ? `?as=${encodeURIComponent(S.as)}` : "");

// ------------------------------------------------------------------ boot
async function boot() {
  try { S.session = await api("session"); } catch { S.session = { user: null }; }
  if (!S.session.user) return signOutView();
  $("#shell").hidden = false;
  $("#loginHost").innerHTML = "";
  for (const el of document.querySelectorAll("[data-role=admin]")) el.hidden = !isAdmin();
  await refresh();
  route(location.hash);
}
async function refresh() {
  try { S.session = await api("session"); } catch { /* keep the old one */ }
  const u = S.session.user, c = u?.counts || {};
  $("#cInbox").textContent = c.unread ? String(c.unread) : "";
  $("#cInbox").className = "count" + (c.unread ? " alert" : "");
  $("#cDrafts").textContent = c.drafts ? String(c.drafts) : "";
  $("#railFoot").innerHTML = `
    <b>${h(u?.name || u?.username)}${u?.role === "admin" ? " · admin" : ""}</b>
    <span class="mono">${h(u?.address || "")}</span>
    <a href="#/account" class="row" style="gap:6px;color:var(--faint)">account</a>
    <button class="btn sm ghost" id="signOut" style="justify-content:center">Sign out</button>`;
  $("#signOut").addEventListener("click", async () => { try { await api("logout", { method: "POST" }); } catch {} location.hash = "#/"; location.reload(); });
  renderLens();
}

// ------------------------------------------------------------------ sign-in
// Sign-in and first-run are a page of their own: no sidebar, no mail list,
// nothing of the app but its colours — the brand, one card, a quiet foot.
async function signOutView() {
  document.title = "Selfmail · sign in";
  $("#shell").hidden = true;
  const host = $("#loginHost");
  let first = false, users = [];
  try { const s = await api("session"); first = !!s.firstRun; } catch {}
  const foot = `<div class="authfoot">Selfmail ${h(S.session?.version || "")} · a Weft addon · on Aegis × Burrow</div>`;
  if (first) {
    host.innerHTML = `<div class="authpage">
      <div class="authbrand"><img src="logo.svg" alt="">Selfmail</div>
      <div class="authsub">Create the first account — it becomes the admin.</div>
      <div class="card authcard">
        <div class="field"><span>Account name (its address: name@your-domain)</span><input class="input" id="lUser" placeholder="me" spellcheck="false" autocapitalize="none"></div>
        <div class="field"><span>Your name (optional)</span><input class="input" id="lName"></div>
        <div class="field"><span>Password (8+ characters)</span><input class="input" id="lPass" type="password"></div>
        <div class="field"><span>Again</span><input class="input" id="lPass2" type="password"></div>
        <button class="btn primary wide" id="lGo">Create the first account</button>
        <div class="note" id="lMsg" hidden></div>
      </div>
      ${foot}</div>`;
    $("#lGo").addEventListener("click", async () => {
      const msg = $("#lMsg"), u = $("#lUser").value.trim().toLowerCase(), p = $("#lPass").value;
      if (p !== $("#lPass2").value) { msg.hidden = false; msg.className = "note bad"; msg.textContent = "The two passwords differ."; return; }
      try { await api("first-run", { method: "POST", body: { username: u, name: $("#lName").value.trim(), password: p } }); location.reload(); }
      catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
    });
    ["lPass", "lPass2"].forEach((id) => $("#" + id).addEventListener("keydown", (e) => { if (e.key === "Enter") $("#lGo").click(); }));
    $("#lUser").focus();
    return;
  }
  try { users = await api("users"); } catch {}
  host.innerHTML = `<div class="authpage">
    <div class="authbrand"><img src="logo.svg" alt="">Selfmail</div>
    <div class="authsub">Sign in to the mailbox.</div>
    <div class="card authcard">
      <div class="field"><span>Account</span><div class="userpick"><select class="input" id="lUser">
        <option value="">Pick an account…</option>
        ${users.map((x) => `<option value="${h(x.username)}">${h(x.name || x.username)} · ${h(x.username)}${x.role === "admin" ? " (admin)" : ""}</option>`).join("")}
      </select></div></div>
      <div class="field" id="pwField" hidden><span>Password</span><input class="input" id="lPass" type="password"></div>
      <button class="btn primary wide" id="lGo" disabled>Sign in</button>
      <div class="note" id="lMsg" hidden></div>
    </div>
    ${foot}</div>`;
  const sel = $("#lUser"), go = $("#lGo"), pw = $("#lPass");
  const submit = async () => {
    if (!sel.value || !pw.value) return;
    try { await api("login", { method: "POST", body: { username: sel.value, password: pw.value } }); location.reload(); }
    catch (e) { pw.value = ""; pw.focus(); const msg = $("#lMsg"); msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
  };
  sel.addEventListener("change", () => {
    $("#pwField").hidden = !sel.value;
    go.disabled = !sel.value;
    if (sel.value) pw.focus();
  });
  pw.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  go.addEventListener("click", submit);
}

const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - Number(t || 0)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
};

// ------------------------------------------------------------------ routing
const VIEWS = {};
function route(hash) {
  const v = (/^#\/?([a-z]+)/.exec(hash || "") || [])[1];
  const allowed = S.session?.user ? (isAdmin() || !["users", "service", "keys", "system"].includes(v)) : false;
  S.view = v && VIEWS[v] && allowed ? v : (S.session?.user ? "inbox" : null);
  if (!S.view) return signOutView();
  for (const a of document.querySelectorAll("#nav a")) a.classList.toggle("on", a.dataset.v === S.view);
  // a reply/forward/edit hands its prefill to the composer through here: the
  // hash change and the direct call must not both run compose, or the empty
  // one renders last and quietly wipes the prefill
  const pre = S.pendingCompose; S.pendingCompose = null;
  VIEWS[S.view](pre);
  app.focus({ preventScroll: true });
}
window.addEventListener("hashchange", () => route(location.hash));

// ------------------------------------------------------------------ shared
const head = (title, sub, extra = "") => `<div class="head"><div><h1>${title}</h1><p>${sub}</p></div><div class="spacer"></div>${extra}</div>`;
function asBar() {
  if (!S.as || S.as === S.session?.user?.username) return "";
  return `<div class="asbar"><span class="pill auto">as ${h(S.as)}</span><span class="faint">admin view</span><span class="spacer" style="flex:1"></span><button class="btn sm" id="leaveAs">Back to my mail</button></div>`;
}
function wireAsBar() { const b = $("#leaveAs"); if (b) b.addEventListener("click", () => { S.as = null; route(location.hash); }); }
const EMPTY = {
  inbox: "Nothing here yet. Mail a relay forwards to this account lands here.",
  drafts: "No drafts.", sent: "Nothing sent yet.", trash: "The trash is empty.",
};

// ------------------------------------------------------------------ lists
async function drawList(box) {
  const host = $(`#list-${box}`);
  if (!host) return;
  host.innerHTML = `<div class="empty"><span class="spin"></span> Loading…</div>`;
  const lens = lensOn();
  let msgs;
  try { msgs = await api(`messages?box=${box}${lens ? `&all=1&domain=${encodeURIComponent(lens)}` : (S.as && S.as !== S.session.user.username ? `&as=${encodeURIComponent(S.as)}` : "")}`); }
  catch (e) { host.innerHTML = `<div class="empty">${h(e.message)}</div>`; return; }
  if (!msgs.length) { host.innerHTML = `<div class="empty">${lens ? EMPTY_LENS[box] : EMPTY[box]}</div>`; return; }
  host.innerHTML = msgs.map((m) => {
    const who = box === "sent" || box === "drafts" ? (m.to || "(no one)") : (m.from || "(someone)");
    const owner = lens && m.owner ? `<span class="pill" title="This sits in ${h(m.ownerName || m.owner)}'s mailbox">${h(m.ownerName || m.owner)}</span>` : "";
    const badge = m.box === "sent" && m.delivery
      ? m.delivery.ok === true ? `<span class="pill ok" title="The local mail agent accepted it; the actual delivery is its to do after that.">handed to the agent</span>`
        : m.delivery.ok == null ? '<span class="pill">saved</span>'
        : `<span class="pill bad" title="${h(m.delivery.error || m.delivery.stage || "failed")}">not delivered</span>`
      : "";
    const auto = m.auto ? '<span class="pill auto">auto</span>' : "";
    return `<button class="item${m.read ? "" : " unread"}" data-id="${m.id}">
      <span class="top"><span class="who">${h(who)}</span>${owner}${badge}${auto}<span class="when">${when(m.date)}</span></span>
      <span class="subj">${h(m.subject || "(no subject)")}</span>
      <span class="snip">${h(m.snippet || "")}</span>
    </button>`;
  }).join("");
  for (const el of host.querySelectorAll(".item")) el.addEventListener("click", () => {
    // a lens row belongs to one of the accounts: open it as that account, the
    // way an admin opens any mailbox — every action on it then just works
    const m = msgs.find((x) => x.id === el.dataset.id);
    if (lens && m && m.owner && m.owner !== S.session?.user?.username && isAdmin()) {
      S.as = m.owner;
      // the bar must appear at once — acting as someone is not a silent thing
      if (!app.querySelector(".asbar")) { app.insertAdjacentHTML("afterbegin", asBar()); wireAsBar(); }
    }
    openMessage(el.dataset.id);
  });
  if (lens && box === "inbox") {           // the rail badge counts the lens, not just me
    const n = msgs.filter((m) => !m.read).length;
    $("#cInbox").textContent = n ? String(n) : "";
    $("#cInbox").className = "count" + (n ? " alert" : "");
  }
}
// the domain chosen on the Inbox screen, kept for new mail ("Sending from" pick)
const savedDomain = () => { try { return localStorage.getItem("selfmail:domain") || ""; } catch { return ""; } };
// the domain lens (admins): flip a domain on in the rail and every mail view
// lists every account's mail for it — kept on the device, like the sending pick
const lensDomain = () => { try { return localStorage.getItem("selfmail:lens") || ""; } catch { return ""; } };
const setLensDomain = (d) => { try { d ? localStorage.setItem("selfmail:lens", d) : localStorage.removeItem("selfmail:lens"); } catch {} };
const lensOn = () => (isAdmin() && lensDomain() && (S.session?.user?.role === "admin") ? lensDomain() : "");
async function viewInbox() {
  if (lensOn()) return lensView("inbox", "Inbox");
  const dv = await api("domains").catch(() => ({ enabled: [], primary: "" }));
  const doms = (dv.enabled || []).slice();
  const saved = savedDomain();
  const cur = doms.includes(saved) ? saved : (dv.primary || doms[0] || "");
  // one pick, kept on this device: every new message starts as you@this-domain
  const pick = doms.length > 1
    ? `<div class="dompick"><span class="faint">Sending from</span><div class="selpick"><select class="input" id="homeDomain" title="The domain new mail is sent from" style="width:auto;padding:3px 26px 3px 8px;font-size:12px">${doms.map((z) => `<option value="${h(z)}" ${z === cur ? "selected" : ""}>${h(z)}</option>`).join("")}</select></div></div>`
    : "";
  app.innerHTML = asBar() + head("Inbox", "Mail a relay forwards to this account lands here.", pick) + `<div class="mail" id="list-inbox"></div>`;
  wireAsBar();
  const sel = $("#homeDomain");
  if (sel) sel.addEventListener("change", () => {
    try { localStorage.setItem("selfmail:domain", sel.value); } catch {}
    toast(`New mail will go out from ${sel.value}.`);
  });
  drawList("inbox");
}
async function viewDrafts() { if (lensOn()) return lensView("drafts", "Drafts"); app.innerHTML = asBar() + head("Drafts", "Saved half-written.") + `<div class="mail" id="list-drafts"></div>`; wireAsBar(); drawList("drafts"); }
async function viewSent() { if (lensOn()) return lensView("sent", "Sent"); app.innerHTML = asBar() + head("Sent", "Every message with its real fate, as the local mail agent reported it.") + `<div class="mail" id="list-sent"></div>`; wireAsBar(); drawList("sent"); }
async function viewTrash() { if (lensOn()) return lensView("trash", "Trash"); app.innerHTML = asBar() + head("Trash", "Deleted mail waits here until you remove it for good.") + `<div class="mail" id="list-trash"></div>`; wireAsBar(); drawList("trash"); }

// ------------------------------------------------------------- the domain lens
const EMPTY_LENS = {
  inbox: "No mail addressed to this domain has arrived for any account yet.",
  drafts: "No drafts on this domain for any account.",
  sent: "Nothing has been sent from this domain yet.",
  trash: "Nothing deleted on this domain.",
};
const LENS_SUB = {
  inbox: "Every account on this machine — mail addressed to this domain.",
  drafts: "Every account on this machine — drafts for this domain.",
  sent: "Every account on this machine — mail sent from this domain.",
  trash: "Every account on this machine — deleted mail on this domain.",
};
async function lensView(box, title) {
  const lens = lensOn();
  app.innerHTML = asBar() + head(`${title} — ${h(lens)}`, LENS_SUB[box]) + await lensStrip() + `<div class="mail" id="list-${box}"></div>`;
  wireAsBar();
  for (const b of app.querySelectorAll("[data-lensopen]")) b.addEventListener("click", () => {
    // into that account's own mail: the lens goes off, the "as" view takes over
    S.as = b.dataset.lensopen; setLensDomain(""); renderLens(); location.hash = "#/inbox"; route(location.hash);
  });
  drawList(box);
}
// every account this machine answers for, one click from their mail and one
// from managing them — the "see all of the accounts" half of the lens
async function lensStrip() {
  const d = await api("admin/view").catch(() => null);
  if (!d) return "";
  const users = (d.users || []).filter((u) => u.role !== "service");
  return `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px"><span class="faint small">Accounts:</span>`
    + users.map((u) => `<button class="btn sm ghost" data-lensopen="${h(u.username)}" title="Open ${h(u.name || u.username)}'s own mail">${h(u.name || u.username)}</button>`).join("")
    + `<a class="btn sm ghost" href="#/users">manage</a></div>`;
}
// the rail block: one row per domain, no domain favored over another, each
// carrying its own on/off switch (the machine's main domain is always served)
async function renderLens() {
  const host = $("#lensList");
  if (!host || !isAdmin()) return;
  const dv = await api("domains").catch(() => null);
  if (!dv) return;
  let cur = lensDomain();
  if (!dv.all.includes(cur)) { cur = ""; setLensDomain(""); }   // off is fine: its old mail remains
  // the row's name is a button and its switch sits beside it, not inside it —
  // a checkbox nested in a button never toggles in a browser
  host.innerHTML = `<div class="lensrow${cur ? "" : " on"}"><button class="lensname" data-lens="">My mail</button></div>`
    + dv.all.map((z) => `<div class="lensrow${cur === z ? " on" : ""}${dv.enabled.includes(z) ? "" : " off"}">`
        + `<button class="lensname mono" data-lens="${h(z)}" title="Every account's mail for ${h(z)}">${h(z)}</button>`
        + `<label class="switch" title="${z === dv.primary ? "The machine's main domain is always served" : "Serve " + h(z) + " or not"}"><input type="checkbox" data-dom="${h(z)}" ${dv.enabled.includes(z) ? "checked" : ""} ${z === dv.primary ? "disabled" : ""}><i></i></label></div>`).join("");
  for (const b of host.querySelectorAll("[data-lens]")) b.addEventListener("click", () => {
    if (!b.dataset.lens) S.as = null;          // "My mail" means mine: leave any as-view too
    setLensDomain(b.dataset.lens === lensDomain() ? "" : b.dataset.lens);
    renderLens();
    route(location.hash);
  });
  for (const sw of host.querySelectorAll("[data-dom]")) sw.addEventListener("change", async () => {
    try { await api("admin/domains", { method: "PUT", body: { domain: sw.dataset.dom, on: sw.checked } }); toast(`${sw.dataset.dom} ${sw.checked ? "served" : "off"}.`); }
    catch (e) { toast(e.message); }
    renderLens();
  });
}
Object.assign(VIEWS, { inbox: viewInbox, drafts: viewDrafts, sent: viewSent, trash: viewTrash });

// ------------------------------------------------------------------ reading
async function openMessage(id) {
  let m;
  try { m = await api(`message/${id}${asParam()}`); } catch (e) { toast(e.message); return; }
  if (m.box === "inbox" && !m.read) api(`message/${id}/read${asParam()}`, { method: "POST", body: { read: true } }).then(refresh).catch(() => {});
  const heads = [
    ["From", m.from], ["To", m.to], ...(m.cc ? [["Cc", m.cc]] : []), ["Subject", m.subject || "(no subject)"],
    ["Date", new Date(m.date).toLocaleString()],
  ];
  const d = m.delivery;
  const delivery = m.box === "sent" && d ? `<div class="card"><h3>Delivery</h3><div class="kv">
      <dt>Outcome</dt><dd>${d.ok === true ? '<span class="pill ok" title="The local mail agent accepted it; the actual delivery is its to do after that.">handed to the agent</span>' : d.ok == null ? '<span class="pill">saved</span>' : '<span class="pill bad">not delivered</span>'}</dd>
      <dt>Agent</dt><dd class="mono">${h(d.agent || d.via || "")}</dd>
      <dt>Says</dt><dd>${h(d.response || d.error || d.note || "")}</dd></div></div>` : "";
  const mine = !m.owner || m.owner === S.session?.user?.username;
  const inPill = !mine && isAdmin() ? `<span class="pill" title="You are acting on ${h(m.ownerName || m.owner)}'s mail">in ${h(m.ownerName || m.owner)}'s mailbox</span>` : "";
  const buttons = [
    d && d.ok === false ? `<button class="btn" data-act="retry">Try again</button>` : "",
    m.box === "drafts" ? `<button class="btn" data-act="edit">Edit draft</button>` : "",
    m.box === "inbox" || m.box === "sent" || m.box === "trash" ? `<button class="btn" data-act="reply">Reply</button>` : "",
    `<button class="btn" data-act="forward">Forward</button>`,
    `<button class="btn" data-act="unread">Mark unread</button>`,
    m.box === "trash" ? `<button class="btn" data-act="restore">Put back</button>` : `<button class="btn" data-act="trash">To trash</button>`,
    `<button class="btn danger" data-act="delete">Delete for good</button>`,
  ].join("");
  $("#drawerIn").innerHTML = `
    <div class="row"><button class="btn ghost" data-act="close">${ICONS.back} Close</button>${inPill}<span style="flex:1"></span>${m.auto ? '<span class="pill auto">auto</span>' : ""}</div>
    <h2>${h(m.subject || "(no subject)")}</h2>
    <div class="kv">${heads.map(([k, v]) => `<dt>${k}</dt><dd class="mono">${h(v || "")}</dd>`).join("")}</div>
    ${delivery}
    <pre>${h(m.text || "(no text)")}</pre>
    ${m.html ? `<div class="row"><button class="btn ghost" data-act="formatted">Show formatted</button></div><div id="formattedBox"></div>` : ""}
    <div class="actions">${buttons}</div>`;
  const drawer = $("#drawer");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  for (const b of $("#drawerIn").querySelectorAll("[data-act]")) b.addEventListener("click", () => act(b.dataset.act, m));
}
function closeDrawer() { const d = $("#drawer"); d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); }
async function act(what, m) {
  try {
    if (what === "close") return closeDrawer();
    if (what === "unread") { await api(`message/${m.id}/read${asParam()}`, { method: "POST", body: { read: false } }); await refresh(); closeDrawer(); return route(location.hash); }
    if (what === "trash") { await api(`message/${m.id}/move${asParam()}`, { method: "POST", body: { box: "trash" } }); await refresh(); closeDrawer(); return route(location.hash); }
    if (what === "restore") { await api(`message/${m.id}/move${asParam()}`, { method: "POST", body: { box: m.inbound ? "inbox" : "sent" } }); await refresh(); closeDrawer(); return route(location.hash); }
    if (what === "delete") {
      if (!confirm("Delete this message for good?")) return;
      await api(`message/${m.id}${asParam()}`, { method: "DELETE" }); await refresh(); closeDrawer(); return route(location.hash);
    }
    if (what === "retry") { const r = await api(`resend${asParam()}`, { method: "POST", body: { id: m.id } }); await refresh(); return openMessage(r.id); }
    if (what === "reply") {
      const quoted = (m.text || "").split("\n").map((l) => "> " + l).join("\n");
      // reply from the domain the mail actually arrived on — the envelope
      // knows (Bcc hides in no header), the To: header is only the fallback
      const arrDom = String(m.rcpt || m.to || "").split(",")[0].trim().split("@").pop().toLowerCase();
      const pre = { to: m.from || "", subject: /^re:/i.test(m.subject || "") ? m.subject : "Re: " + (m.subject || ""), text: quoted ? `\n\n${quoted}` : "", inReplyTo: m.messageId || "", domain: arrDom };
      if (m.html) { pre.mode = "html"; pre.html = `<p><br></p><blockquote>${sanitizeHtml(m.html)}</blockquote>`; }
      closeDrawer(); S.pendingCompose = pre;
      if (location.hash === "#/compose") return compose(pre);
      location.hash = "#/compose";
    }
    if (what === "forward") {
      const head = [`From: ${m.from || ""}`, `Date: ${new Date(m.date).toLocaleString()}`, `Subject: ${m.subject || ""}`, ...(m.to ? [`To: ${m.to}`] : [])].join("\n");
      const pre = { subject: /^fwd:/i.test(m.subject || "") ? m.subject : "Fwd: " + (m.subject || ""), text: `\n\n---------- Forwarded message ----------\n${head}\n\n${(m.text || "").split("\n").map((l) => "> " + l).join("\n")}` };
      if (m.html) { pre.mode = "html"; pre.html = `<p>---------- Forwarded message ----------</p><p>${h(head).replace(/\n/g, "<br>")}</p><blockquote>${sanitizeHtml(m.html)}</blockquote>`; }
      closeDrawer(); S.pendingCompose = pre;
      if (location.hash === "#/compose") return compose(pre);
      location.hash = "#/compose";
    }
    if (what === "edit") {
      closeDrawer(); S.pendingCompose = { id: m.id, to: m.to || "", cc: m.cc || "", subject: m.subject || "", text: m.text || "", inReplyTo: m.inReplyTo || "", mode: m.html ? "html" : "text", html: m.html || "", domain: m.domain || "" };
      if (location.hash === "#/compose") return compose(S.pendingCompose);
      location.hash = "#/compose";
    }
    if (what === "formatted") {
      const box = $("#formattedBox");
      box.innerHTML = '<iframe class="sandbox" sandbox title="The message, formatted"></iframe>';
      box.querySelector("iframe").srcdoc = m.html;
      return;
    }
  } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ compose
// the HTML a quoted message brings in, stripped of anything that runs: tags
// that script, style or embed, on* attributes, javascript: URLs. It goes into
// the editor (this page), so it is defanged before it ever gets there.
function sanitizeHtml(html) {
  return String(html || "")
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}
// plain text <-> simple html, so switching modes keeps what was written
const textToHtml = (t) => t.trim() ? t.split(/\n{2,}/).map((p) => `<p>${h(p).replace(/\n/g, "<br>")}</p>`).join("") : "";
function setMode(mode) {
  S.mode = mode;
  const ta = $("#fText"), ed = $("#fHtml");
  $("#segText").classList.toggle("on", mode === "text");
  $("#segHtml").classList.toggle("on", mode === "html");
  $("#fTextWrap").hidden = mode !== "text";
  $("#fHtmlWrap").hidden = mode !== "html";
  if (mode === "html") ed.innerHTML = ed.dataset.preload || textToHtml(ta.value);
  else ta.value = ed.innerText;
  if (mode === "html") { delete ed.dataset.preload; ed.focus(); } else ta.focus();
}
async function compose(inPrefill = {}) {
  const prefill = inPrefill || {};          // route() hands over null when nothing is pending
  S.editing = prefill.id || null;
  S.inReplyTo = prefill.inReplyTo || "";
  S.mode = prefill.html ? "html" : "text";
  const who = S.as && S.as !== S.session.user?.username ? S.as : (S.session.user?.username || "");
  S.editDomain = prefill.domain || "";
  const dv = await api("domains").catch(() => ({ enabled: [], primary: "" }));
  // a domain picked on the Inbox screen wins for new mail, unless this is an
  // edit or a reply, whose own From should not move under the user
  const saved = savedDomain();
  const lens = lensOn();
  const pd = dv.enabled.includes(prefill.domain) ? prefill.domain : "";   // headers can name any domain; only a served one counts
  const pick = pd || (lens && dv.enabled.includes(lens) ? lens : "") || (dv.enabled.includes(saved) ? saved : "") || dv.primary || dv.enabled[0] || "";
  const fromRow = `<div class="fromrow">From ${
    dv.enabled.length > 1
      ? `<div class="selpick"><select class="input" id="fDomain" style="width:auto;padding:3px 26px 3px 8px;font-size:12px">${dv.enabled.map((z) => `<option value="${h(z)}" ${z === pick ? "selected" : ""}>${h(who)}@${h(z)}</option>`).join("")}</select></div>`
      : `<span class="mono">${h(who ? who + "@" + (pick || "…") : "…")}</span>`
  }<span class="faint">through this machine's own mail agent.</span></div>`;
  app.innerHTML = `
    ${asBar()}${head(S.editing ? "Edit a draft" : "Write a message", "")}
    ${fromRow}
    <div class="note bad" id="mtaWarn" hidden></div>
    <div class="card">
      <div class="field"><span>To (comma-separated)</span><input class="input" id="fTo" placeholder="ada@example.org" spellcheck="false" autocapitalize="none"></div>
      <div class="field"><span>Cc</span><input class="input" id="fCc" spellcheck="false" autocapitalize="none"></div>
      <div class="field"><span>Subject</span><input class="input" id="fSubject"></div>
      <div class="field"><span>Message
        <span class="seg"><button type="button" id="segText" class="${S.mode === "text" ? "on" : ""}">Plain text</button><button type="button" id="segHtml" class="${S.mode === "html" ? "on" : ""}">HTML</button></span></span>
        <div id="fTextWrap" ${S.mode === "html" ? "hidden" : ""}><textarea id="fText"></textarea></div>
        <div id="fHtmlWrap" ${S.mode === "text" ? "hidden" : ""}>
          <div class="htools" id="hTools">
            <button type="button" class="ht" data-cmd="bold" style="font-weight:750">B</button>
            <button type="button" class="ht" data-cmd="italic" style="font-style:italic">I</button>
            <button type="button" class="ht" data-cmd="underline" style="text-decoration:underline">U</button>
            <button type="button" class="ht" data-cmd="strikeThrough" style="text-decoration:line-through">S</button>
            <span class="hsep"></span>
            <button type="button" class="ht" data-block="h3">Heading</button>
            <button type="button" class="ht" data-block="p">Text</button>
            <span class="hsep"></span>
            <button type="button" class="ht" data-cmd="insertUnorderedList">• List</button>
            <button type="button" class="ht" data-cmd="insertOrderedList">1. List</button>
            <button type="button" class="ht" data-block="blockquote">Quote</button>
            <span class="hsep"></span>
            <button type="button" class="ht" id="hLink">Link</button>
            <button type="button" class="ht" data-cmd="removeFormat">Clear</button>
          </div>
          <div class="htmled" id="fHtml" contenteditable="true" role="textbox" aria-multiline="true"></div>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" id="sendBtn">Send</button>
        <button class="btn" id="saveBtn">Save draft</button>
        <button class="btn ghost" id="discardBtn">Discard</button>
      </div>
      <div class="note" id="composeMsg" hidden></div>
    </div>`;
  wireAsBar();
  $("#fTo").value = prefill.to || "";
  $("#fCc").value = prefill.cc || "";
  $("#fSubject").value = prefill.subject || "";
  $("#fText").value = prefill.text || "";
  if (prefill.html) $("#fHtml").dataset.preload = sanitizeHtml(prefill.html);
  $("#segText").addEventListener("click", () => setMode("text"));
  $("#segHtml").addEventListener("click", () => setMode("html"));
  for (const b of $("#hTools").querySelectorAll("[data-cmd]")) b.addEventListener("mousedown", (e) => { e.preventDefault(); document.execCommand(b.dataset.cmd, false, null); });
  for (const b of $("#hTools").querySelectorAll("[data-block]")) b.addEventListener("mousedown", (e) => { e.preventDefault(); document.execCommand("formatBlock", false, b.dataset.block); });
  $("#hLink").addEventListener("mousedown", (e) => {
    e.preventDefault();
    const m = modal(`<h2>Link</h2>
      <div class="field"><span>Address</span><input class="input" id="linkUrl" placeholder="https://…" spellcheck="false"></div>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="linkGo">Insert</button></div>`);
    $("#linkUrl", m.el).focus();
    $("#linkGo", m.el).addEventListener("click", () => {
      const u = $("#linkUrl", m.el).value.trim(); if (!u) return;
      document.execCommand("createLink", false, u); m.close();
    });
  });
  if (S.mode === "html") setMode("html"); else $("#fText").focus();
  $("#sendBtn").addEventListener("click", send);
  $("#saveBtn").addEventListener("click", saveDraft);
  $("#discardBtn").addEventListener("click", () => compose());
  $("#fTo").focus();
  api("mta").then((d) => {
    const w = $("#mtaWarn"); if (!w) return;
    if (!d.ok) { w.hidden = false; w.textContent = "No local mail agent is answering — this machine has nothing to hand mail to, so sending will fail. Install Postfix (or any sendmail); the Status tab shows what it finds." + (d.detail ? ` ${d.detail}` : ""); return; }
    if (d.line && d.line.homeLine) {
      w.hidden = false;
      w.textContent = `The agent answers, but this machine's line looks like a home connection (PTR: ${d.line.ptr || "none"}) — other servers refuse or junk mail sent straight out from such lines, and home ISPs usually block the agent's own outbound port. This app only hands mail to the machine's agent, exactly as selfmail does; it never connects out to deliver anything, on any port. No DNS record changes what the line allows. Receiving is not affected.`;
    }
  }).catch(() => {});
}
const fields = () => ({
  to: $("#fTo").value.trim(), cc: $("#fCc").value.trim(), subject: $("#fSubject").value.trim(),
  domain: $("#fDomain") ? $("#fDomain").value : (S.editing ? S.editDomain || "" : ""),
  ...(S.mode === "html"
    ? { text: $("#fHtml").innerText.trim(), html: $("#fHtml").innerHTML }
    : { text: $("#fText").value, html: "" }),
});
function composeMsg(text, cls) {
  const el = $("#composeMsg"); if (!el) return;
  el.hidden = !text;
  el.className = "note" + (text ? " " + (cls || "") : "");
  el.textContent = text || "";
}
async function saveDraft() {
  try {
    const m = await api(`draft${asParam()}`, { method: "POST", body: { id: S.editing, ...fields(), inReplyTo: S.inReplyTo } });
    S.editing = m.id;
    composeMsg("Draft saved.");
    await refresh();
  } catch (e) { composeMsg(e.message, "bad"); }
}
async function send() {
  const b = $("#sendBtn");
  b.disabled = true; b.textContent = "Sending…";
  composeMsg("");
  try {
    const m = await api(`send${asParam()}`, { method: "POST", body: { id: S.editing, ...fields(), inReplyTo: S.inReplyTo } });
    await refresh();
    S.editing = null;
    location.hash = "#/sent";
    openMessage(m.id);
  } catch (e) { composeMsg(e.message, "bad"); }
  finally { b.disabled = false; b.textContent = "Send"; }
}
VIEWS.compose = compose;

// ------------------------------------------------------------------ auto-reply
// The answer editors (an account's preset, the not-found answer): plain text
// or HTML with the composer's own little toolbar, so a machine-sent reply can
// be as styled as a written one.
function editorField(id, a) {
  return `<div class="field"><span>Answer <span class="seg"><button type="button" id="${id}SegT" class="on">Plain text</button><button type="button" id="${id}SegH">HTML</button></span></span>
    <div id="${id}TextWrap"><textarea id="${id}Text" style="min-height:130px">${h(a.text || "")}</textarea></div>
    <div id="${id}HtmlWrap" hidden>
      <div class="htools" id="${id}Tools">
        <button type="button" class="ht" data-cmd="bold" style="font-weight:750">B</button>
        <button type="button" class="ht" data-cmd="italic" style="font-style:italic">I</button>
        <button type="button" class="ht" data-cmd="underline" style="text-decoration:underline">U</button>
        <button type="button" class="ht" data-cmd="strikeThrough" style="text-decoration:line-through">S</button>
        <span class="hsep"></span>
        <button type="button" class="ht" data-block="h3">Heading</button>
        <button type="button" class="ht" data-block="p">Text</button>
        <span class="hsep"></span>
        <button type="button" class="ht" data-cmd="insertUnorderedList">• List</button>
        <button type="button" class="ht" data-cmd="insertOrderedList">1. List</button>
        <button type="button" class="ht" data-block="blockquote">Quote</button>
        <span class="hsep"></span>
        <button type="button" class="ht" id="${id}Link">Link</button>
        <button type="button" class="ht" data-cmd="removeFormat">Clear</button>
      </div>
      <div class="htmled" id="${id}Html" contenteditable="true" role="textbox" aria-multiline="true"></div>
    </div>
  </div>`;
}
function wireEditor(id, a) {
  const show = (mode) => {
    const ta = $(`#${id}Text`), ed = $(`#${id}Html`);
    $(`#${id}SegT`).classList.toggle("on", mode === "text");
    $(`#${id}SegH`).classList.toggle("on", mode === "html");
    $(`#${id}TextWrap`).hidden = mode !== "text";
    $(`#${id}HtmlWrap`).hidden = mode !== "html";
    if (mode === "html") { ed.innerHTML = ed.dataset.preload || textToHtml(ta.value); delete ed.dataset.preload; }
    else ta.value = ed.innerText;
  };
  $(`#${id}SegT`).addEventListener("click", () => show("text"));
  $(`#${id}SegH`).addEventListener("click", () => show("html"));
  for (const b of $(`#${id}Tools`).querySelectorAll("[data-cmd]")) b.addEventListener("mousedown", (e) => { e.preventDefault(); document.execCommand(b.dataset.cmd, false, null); });
  for (const b of $(`#${id}Tools`).querySelectorAll("[data-block]")) b.addEventListener("mousedown", (e) => { e.preventDefault(); document.execCommand("formatBlock", false, b.dataset.block); });
  $(`#${id}Link`).addEventListener("mousedown", (e) => {
    e.preventDefault();
    const m = modal(`<h2>Link</h2>
      <div class="field"><span>Address</span><input class="input" id="linkUrl" placeholder="https://…" spellcheck="false"></div>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="linkGo">Insert</button></div>`);
    $("#linkUrl", m.el).focus();
    $("#linkGo", m.el).addEventListener("click", () => {
      const u = $("#linkUrl", m.el).value.trim(); if (!u) return;
      document.execCommand("createLink", false, u); m.close();
    });
  });
  if (a.html) $(`#${id}Html`).dataset.preload = sanitizeHtml(a.html);
}

async function viewAuto() {
  let d;
  try { d = await api(`auto-reply${asParam()}`); } catch (e) { app.innerHTML = head("Auto-reply", "") + `<div class="note bad">${h(e.message)}</div>`; return; }
  const a = d.autoReply;
  const cooldowns = [[0, "every message"], [10, "10 minutes"], [60, "1 hour"], [360, "6 hours"], [1440, "a day"]];
  app.innerHTML = asBar() + head("Auto-reply", `The preset answer sent from ${h(d.address || "this account")} when someone contacts it — plain text or HTML.`)
    + `<div class="card">
      <div class="switchrow"><div class="grow"><b>Send the preset answer</b><span class="faint small">one per sender, per cooldown; never to this domain's own accounts or to robots</span></div>
        <label class="switch"><input type="checkbox" id="aOn" ${a.enabled ? "checked" : ""}><i></i></label></div>
      <div class="field mt"><span>Subject — <span class="mono">{subject}</span> is the message's subject</span><input class="input" id="aSubject" value="${h(a.subject)}"></div>
      ${editorField("aEd", { text: a.text, html: a.html })}
      <div class="faint small" style="margin:-6px 0 10px"><span class="mono">{subject}</span>, <span class="mono">{sender}</span>, <span class="mono">{domain}</span> fill in on both sides.</div>
      <div class="field"><span>Cooldown</span><div class="selpick"><select class="input" id="aCool">${cooldowns.map(([v, l]) => `<option value="${v}" ${Number(a.cooldown) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="row">
        <button class="btn primary" id="aSave">Save</button>
        <button class="btn" id="aTest">Send a test…</button>
      </div>
      <div class="note" id="aMsg" hidden></div>
    </div>`;
  wireAsBar();
  wireEditor("aEd", a);
  $("#aSave").addEventListener("click", async () => {
    const msg = $("#aMsg");
    try {
      await api(`auto-reply${asParam()}`, { method: "PUT", body: { enabled: $("#aOn").checked, subject: $("#aSubject").value, text: $("#aEdText").value, html: $("#aEdHtml").innerHTML, cooldown: Number($("#aCool").value) } });
      msg.hidden = false; msg.className = "note ok"; msg.textContent = "Saved.";
    } catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
  });
  $("#aTest").addEventListener("click", () => {
    const m = modal(`<h2>Send a test</h2>
      <div class="field"><span>To</span><input class="input" id="tTo" placeholder="you@somewhere" spellcheck="false"></div>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="tGo">Send</button></div>`);
    $("#tGo", m.el).addEventListener("click", async () => {
      try {
        const r = await api(`auto-reply/test${asParam()}`, { method: "POST", body: { to: $("#tTo", m.el).value.trim() } });
        m.close();
        toast(r.delivery?.ok ? "Test sent." : `Test not delivered: ${r.delivery?.error || "the agent refused"}`);
      } catch (e) { toast(e.message); }
    });
  });
}
VIEWS.auto = viewAuto;

// ------------------------------------------------------------------ account
async function viewAccount() {
  const u = S.session.user;
  app.innerHTML = head("Account", h(u.name || u.username) + " · " + h(u.address || ""))
    + `<div class="card"><h3>Password</h3>
        <div class="field"><span>Current</span><input class="input" id="pCur" type="password"></div>
        <div class="field"><span>New (8+)</span><input class="input" id="pNext" type="password"></div>
        <div class="row"><button class="btn primary" id="pGo">Change</button></div>
        <div class="note" id="pMsg" hidden></div></div>`;
  $("#pGo").addEventListener("click", async () => {
    const msg = $("#pMsg");
    try { await api("account/password", { method: "POST", body: { current: $("#pCur").value, next: $("#pNext").value } }); msg.hidden = false; msg.className = "note ok"; msg.textContent = "Changed."; $("#pCur").value = $("#pNext").value = ""; }
    catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
  });
}
VIEWS.account = viewAccount;

// ------------------------------------------------------------------ dns + status
async function viewDns() {
  const st = await api("state").catch(() => ({}));
  const dv = await api("domains").catch(() => ({ enabled: [], all: [], primary: "" }));
  const admin = isAdmin();
  app.innerHTML = head("DNS", "The records that bring mail in, ready-made: the default relay domains are filled in. Every served domain is checked at once.")
    + (admin && dv.all.length ? `<div class="card" style="margin-bottom:14px"><h3>Served domains <span class="faint">— mail for any of these lands here</span></h3>
        ${dv.all.map((z) => `<div class="switchrow"><div class="grow"><b class="mono">${h(z)}</b>${z === dv.primary ? ' <span class="pill">primary</span>' : ""}</div>
          <label class="switch"><input type="checkbox" data-dom="${h(z)}" ${dv.enabled.includes(z) ? "checked" : ""} ${z === dv.primary ? "disabled" : ""}><i></i></label></div>`).join("")}
      </div>` : "")
    + (st.inbound ? "" : `<div class="note">The inbound address isn't published yet, so the <span class="mono">forward-email</span> record shows its placeholder.</div>`)
    + `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="dnsCheckBtn">Check every domain again</button><span class="faint small">against public DNS, and the inbound address itself</span></div>
       <div class="note" id="dnsMsg" hidden></div>
       <div id="dnsWrap"></div>`;
  $("#dnsCheckBtn").addEventListener("click", checkDns);
  for (const sw of app.querySelectorAll("[data-dom]")) sw.addEventListener("change", async () => {
    try { await api("admin/domains", { method: "PUT", body: { domain: sw.dataset.dom, on: sw.checked } }); toast(`${sw.dataset.dom} ${sw.checked ? "served" : "off"}.`); }
    catch (e) { toast(e.message); }
    renderLens(); viewDns();
  });
  checkDns();          // the truth on arrival, not only on request
}
async function checkDns() {
  const b = $("#dnsCheckBtn"), wrap = $("#dnsWrap");
  if (!b) return;
  if (wrap) wrap.innerHTML = `<div class="scroll"><table><tr><td><span class="spin"></span> Asking public DNS about every served domain…</td></tr></table></div>`;
  b.disabled = true; b.textContent = "Resolving…";
  try {
    const d = await api("dns-check");
    const p = d.inbound || { ok: false, url: "", detail: "not checked" };
    const doms = d.domains || [];
    // one section per served domain, so a domain nobody added records for is
    // obvious instead of hiding behind whichever one happens to be primary
    wrap.innerHTML = doms.map((x, i) => `
      <div class="card" style="margin-bottom:14px">
        <h3 class="mono" style="margin-bottom:10px">${h(x.domain)} ${x.ok === x.total ? '<span class="pill ok">ready</span>' : `<span class="pill bad">${x.ok} of ${x.total} in place</span>`}</h3>
        <div class="scroll"><table id="dnsTable-${i}"></table></div>
      </div>`).join("")
      + `<div class="card" style="margin-bottom:14px"><h3 style="margin-bottom:10px">The inbound address <span class="faint">— the one place every domain above hands its mail to</span></h3><div class="scroll"><table id="dnsTable-probe"></table></div></div>`;
    doms.forEach((x, i) => drawDns(x.records, $(`#dnsTable-${i}`)));
    // the probe row is not a DNS record: it is the inbound address, asked from
    // outside. Records being in place mean nothing if it stays silent.
    drawDns([{
      key: "probe", type: "Ping", name: "the inbound address",
      content: p.url || "(not published)", note: "The relay POSTs mail here; this row asks the address itself, across the internet.",
      ok: p.ok, found: p.ok ? "answers" : (p.detail || ""), detail: p.ok ? "" : (p.detail || ""),
    }], $("#dnsTable-probe"));
    const el = $("#dnsMsg");
    el.hidden = false;
    el.className = "note " + (d.allGood ? "ok" : "bad");
    const ready = doms.filter((x) => x.ok === x.total).map((x) => x.domain);
    const lagging = doms.filter((x) => x.ok < x.total);
    const lagText = lagging.map((x) => x.ok === 0 ? `${x.domain} has no records in DNS yet` : `${x.domain} is ${x.ok} of ${x.total} in place`).join("; ");
    el.textContent = !doms.length
      ? "No domains are served yet — mail for a served domain lands here, so turn one on first."
      : d.allGood
        ? `Every domain is ready (${d.ok}/${d.total} records) and the inbound address answers from the internet. Mail can flow.`
        : !p.url
          ? "There is no inbound address yet — the host hasn't published the tunnel, so nothing in DNS can bring mail in. Check the Status page."
          : !p.ok
            ? `The records are ${d.ok}/${d.total}, but the inbound address does not answer from outside (${p.detail}). Mail will not arrive until it does — the tunnel may be down.`
            : `${ready.length ? ready.join(", ") + (ready.length > 1 ? " are" : " is") + " ready. " : ""}${lagText}. Each domain needs its own records — paste the missing Values into your DNS panel for that domain. Records just added take a few minutes to show.`;
  } catch (e) { const el = $("#dnsMsg"); el.hidden = false; el.className = "note bad"; el.textContent = e.message; if (wrap) wrap.innerHTML = `<div class="scroll"><table><tr><td>${h(e.message)}</td></tr></table></div>`; }
  finally { b.disabled = false; b.textContent = "Check every domain again"; }
}
function drawDns(rows, table) {
  if (!table) return;
  table.innerHTML = `<tr><th>Type</th><th>Name</th><th>Value</th><th>Why</th><th>Public DNS says</th></tr>` +
    rows.map((r) => {
      const cell = r.ok == null
        ? `<span class="faint">—</span>${r.detail ? `<div class="faint small">${h(r.detail)}</div>` : ""}`
        : r.ok
          ? `<span class="dot ok"></span> <code>${h(r.found || "in place")}</code>${r.via === "DoH" ? '<span class="faint small"> (asked over DoH — plain DNS is blocked here)</span>' : ""}`
          : `<span class="dot bad"></span> <code>${h(r.found || "nothing")}</code>${r.detail ? `<div class="faint small">${h(r.detail)}</div>` : ""}`;
      const copy = r.content && !String(r.content).includes("YOUR-") && !String(r.content).startsWith("(") ? `<button class="btn sm ghost" data-copy="${h(r.content)}" title="Copy this value for your DNS panel">copy</button>` : "";
      return `<tr><td><b>${r.type}</b>${r.priority != null ? ` ${r.priority}` : ""}</td><td><code>${h(r.name)}</code></td><td><div class="row" style="gap:6px;flex-wrap:wrap"><code>${h(r.content)}</code>${copy}</div></td><td class="muted small">${h(r.note || "")}</td><td>${cell}</td></tr>`;
    }).join("");
  for (const b of table.querySelectorAll("[data-copy]")) b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied — paste it into your DNS panel."); }
    catch { toast("Couldn't copy from here — select the value and copy by hand."); }
  });
}
VIEWS.dns = viewDns;

async function viewStatus() {
  const st = await api("state").catch(() => ({}));
  const rows = [
    ["Domain", h(st.domain || "(none)")],
    ["Accounts", `${st.accounts ?? 0} (plus the service ones)`],
    ["Inbound", st.inbound ? `<span class="mono">${h(st.inbound)}</span>` : "not published"],
    ["Webhook", st.tunnel ? '<span class="dot ok"></span> live' : `<span class="dot warn"></span> no tunnel yet${st.publishError ? `<div class="faint small">${h(st.publishError)}</div>` : ""}`],
    ["Mail", `${st.counts?.inbox ?? 0} in · ${st.counts?.sent ?? 0} sent · ${st.counts?.unread ?? 0} unread, all accounts`],
    ["Version", h(st.version || "")],
  ];
  app.innerHTML = head("Status", "The service at a glance.")
    + `<div class="card"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>
       <div class="card"><h3>Update <span class="faint">— the app checks its own source every 3 hours</span></h3><div id="updBox"><span class="spin"></span> Reading the last check…</div></div>
       <div class="card"><h3>The local mail agent <span class="faint">— the thing that delivers what you send</span></h3>
         <div class="row"><button class="btn" id="mtaBtn">Check the local mail agent</button></div>
         <div class="note" id="mtaMsg" hidden></div></div>`;
  drawUpdate(await api("update").catch(() => null), st);
  $("#mtaBtn").addEventListener("click", async () => {
    const b = $("#mtaBtn"), m = $("#mtaMsg");
    b.disabled = true; b.textContent = "Probing…";
    try {
      const r = await api("mta");
      m.hidden = false;
      m.className = "note " + (r.ok ? "ok" : "bad");
      m.textContent = r.ok
        ? (r.sendmail ? `sendmail: ${r.sendmail}` : "sendmail: none") + (r.smtp ? ` · MTA: "${r.smtp}"` : " · nothing on 127.0.0.1") + (r.line ? ` · line: ${r.line.ptr || "no PTR"}` : "")
        : "No local mail agent. Install Postfix (or any sendmail) and this app hands mail to it; the app itself never connects out to deliver.";
      if (r.detail) m.textContent += ` — ${r.detail}`;
      if (r.ok && r.line && r.line.homeLine) {
        m.className = "note warn";
        m.textContent += ` — this looks like a home line: mail sent straight out from here mostly won't arrive (other servers refuse or junk consumer addresses, and home ISPs usually block the agent's own outbound port). The app hands mail to the machine's agent and never connects out itself, exactly as selfmail does; no DNS record changes what the line allows. Receiving is not affected.`;
      }
    } catch (e) { m.hidden = false; m.className = "note bad"; m.textContent = e.message; }
    finally { b.disabled = false; b.textContent = "Check the local mail agent"; }
  });
}

// The Update card: what the last self-check found, a Check-now for admins, and
// — when a newer build waits — the apply. The apply belongs to the dashboard
// (it owns these files); from inside the dashboard the page can press it on
// the app's behalf through the dashboard's own addons API.
function drawUpdate(u, st) {
  const el = $("#updBox");
  if (!el) return;
  const inDash = location.pathname.startsWith("/__gate/");
  if (!u) { el.innerHTML = '<span class="faint small">The update state is unavailable right now.</span>'; return; }
  const state = u.error
    ? `<span class="dot bad"></span> <code>${h(u.error)}</code>`
    : u.up_to_date === null
      ? `<span class="dot warn"></span> <code>${h(u.note || "no source to watch")}</code>`
      : u.up_to_date
        ? '<span class="dot ok"></span> <code>up to date</code>'
        : `<span class="dot bad"></span> <code>${h(u.remote?.version || "a newer build")} is out</code>${u.remote?.subject ? `<div class="faint small">${h(u.remote.subject)}</div>` : ""}`;
  el.innerHTML = `
    <dl class="kv">
      <dt>Running</dt><dd>${h(u.local?.version || st?.version || "")}</dd>
      <dt>Source</dt><dd>${state}</dd>
      <dt>Last check</dt><dd>${u.checked ? ago(u.checked) : "never"} — it checks itself every 3 hours</dd>
    </dl>
    <div class="row mt">
      ${isAdmin() ? '<button class="btn" id="updCheck">Check now</button>' : ""}
      ${isAdmin() && u.up_to_date === false
        ? (inDash
            ? '<button class="btn primary" id="updGo">Update now</button><span class="faint small">the app restarts, then this page reloads</span>'
            : `<span class="faint small">Apply it from the dashboard's Add-ons page${u.dashboard ? ` — <a href="${h(u.dashboard)}" target="_top">open the dashboard</a>` : ""}.</span>`)
        : ""}
    </div>`;
  const c = $("#updCheck");
  if (c) c.addEventListener("click", async () => {
    c.disabled = true; c.textContent = "Checking…";
    try { drawUpdate(await api("update/check", { method: "POST" }), st); }
    catch (e) { toast(e.message); c.disabled = false; c.textContent = "Check now"; }
  });
  const g = $("#updGo");
  if (g) g.addEventListener("click", async () => {
    g.disabled = true; g.textContent = "Updating…";
    try {
      // the dashboard takes its own mutating calls only from its own pages:
      // same-origin (this page is served by it) plus its X-Gate header
      const r = await fetch("/__gate/api/addons/selfmail/update", { method: "POST", headers: { "Content-Type": "application/json", "X-Gate": "1" }, body: "{}" });
      if (!r.ok) throw new Error(`the dashboard answered ${r.status}`);
      const j = await r.json();
      toast("Updating — this page reloads when it's done.");
      const id = j.job?.id;
      (async function poll(tries) {
        if (tries > 120) { location.reload(); return; }
        try {
          const p = await fetch(`/__gate/api/addons/jobs/${id}`);
          const pj = await p.json();
          if (pj.state === "running") return setTimeout(() => poll(tries + 1), 2000);
          if (pj.state === "done") return setTimeout(() => location.reload(), 1500);
          throw new Error(pj.error || pj.state || "the update job failed");
        } catch (e) {
          if (String(e.message).startsWith("the dashboard answered")) throw e;
          setTimeout(() => poll(tries + 1), 3000);   // the app itself may be mid-restart
        }
      })(0);
    } catch (e) { g.disabled = false; g.textContent = "Update now"; toast(e.message); }
  });
}
VIEWS.status = viewStatus;

// ------------------------------------------------------------------ admin: users
const rolePill = (r) => `<span class="pill role-${h(r)}">${h(r)}</span>`;
async function adminView() {
  try { return await api("admin/view"); } catch (e) { app.innerHTML = head("Admin", "") + `<div class="note bad">${h(e.message)}</div>`; return null; }
}
async function viewUsers() {
  const d = await adminView(); if (!d) return;
  app.innerHTML = head("Users", "Accounts with a password and their own mail. Admins can open any of them.")
    + `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="addUser">Add user</button></div>
       <div class="scroll"><table><thead><tr><th>Account</th><th>Role</th><th>Auto-reply</th><th>Mail</th><th>Created</th><th></th></tr></thead><tbody>
       ${d.users.filter((u) => u.role !== "service").map((u) => `<tr>
         <td><b>${h(u.name || u.username)}</b><div class="faint small mono">${h(u.username)} · ${h(u.address || "")}</div></td>
         <td><div class="selpick"><select class="input" data-role="${h(u.username)}" style="padding:3px 26px 3px 8px;font-size:12px">
           ${["user", "admin"].map((r) => `<option ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></div></td>
         <td>${u.autoReply.enabled ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>'}</td>
         <td class="mono">${u.counts.inbox}/${u.counts.sent}</td>
         <td class="faint small">${when(u.created)}</td>
         <td><div class="tbl-actions">
           <button class="btn sm" data-open="${h(u.username)}">Open</button>
           <button class="btn sm" data-pass="${h(u.username)}">Password</button>
           <button class="btn sm ghost danger" data-del="${h(u.username)}">Delete</button>
         </div></td></tr>`).join("")}
       </tbody></table></div>`;
  $("#addUser").addEventListener("click", () => userModal(d.domain));
  for (const s of app.querySelectorAll("[data-role]")) s.addEventListener("change", async () => {
    try { await api(`admin/users/${s.dataset.role}`, { method: "PATCH", body: { role: s.value } }); toast(`${s.dataset.role} is now ${s.value}.`); }
    catch (e) { toast(e.message); viewUsers(); }
  });
  for (const b of app.querySelectorAll("[data-open]")) b.addEventListener("click", () => { S.as = b.dataset.open; location.hash = "#/inbox"; route("#/inbox"); });
  for (const b of app.querySelectorAll("[data-pass]")) b.addEventListener("click", () => passModal(b.dataset.pass));
  for (const b of app.querySelectorAll("[data-del]")) b.addEventListener("click", async () => {
    const u = b.dataset.del;
    const m = modal(`<h2>Delete ${h(u)}?</h2>
      <div class="field"><span>The mail</span><div class="selpick"><select class="input" id="dMail" style="width:100%">
        <option value="keep">keep it — the first admin takes it over</option><option value="drop">delete it with the account</option></select></div></div>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="dGo">Delete</button></div>`);
    $("#dGo", m.el).addEventListener("click", async () => {
      try { await api(`admin/users/${u}?mail=${$("#dMail", m.el).value}`, { method: "DELETE" }); m.close(); toast(`${u} deleted.`); viewUsers(); }
      catch (e) { toast(e.message); }
    });
  });
}
function userModal(domain) {
  const m = modal(`<h2>Add an account</h2>
    <div class="field"><span>Name (its address: name@${h(domain || "your-domain")})</span><input class="input" id="nuUser" placeholder="ada" spellcheck="false" autocapitalize="none"></div>
    <div class="field"><span>Full name (optional)</span><input class="input" id="nuName"></div>
    <div class="field"><span>Password (8+)</span><input class="input" id="nuPass" type="password"></div>
    <div class="field"><span>Role</span><div class="selpick"><select class="input" id="nuRole" style="width:100%"><option value="user">user — their own mail</option><option value="admin">admin — manages everything</option><option value="service">service — no password, admins open it</option></select></div></div>
    <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nuGo">Add</button></div>
    <div class="note" id="nuMsg" hidden></div>`);
  $("#nuGo", m.el).addEventListener("click", async () => {
    const msg = $("#nuMsg", m.el);
    try {
      const r = await api("admin/users", { method: "POST", body: { username: $("#nuUser", m.el).value.trim().toLowerCase(), name: $("#nuName", m.el).value.trim(), role: $("#nuRole", m.el).value, password: $("#nuPass", m.el).value } });
      m.close(); toast(`${r.user.username} added.`); viewUsers();
    } catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
  });
}
function passModal(username) {
  const m = modal(`<h2>Set ${h(username)}'s password</h2>
    <div class="field"><span>New password (8+, or empty to remove it)</span><input class="input" id="npPass" type="password" autofocus></div>
    <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="npGo">Set</button></div>`);
  $("#npGo", m.el).addEventListener("click", async () => {
    try { await api(`admin/users/${username}`, { method: "PATCH", body: { password: $("#npPass", m.el).value } }); m.close(); toast("Password set."); }
    catch (e) { toast(e.message); }
  });
}
VIEWS.users = viewUsers;

// ------------------------------------------------------------------ admin: service accounts + system
async function viewService() {
  const d = await adminView(); if (!d) return;
  const inv = d.system.invalid;
  app.innerHTML = head("Service accounts", "The machine's own accounts: no password, admins open them, presets answer for them.")
    + `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="addSvc">Add service account</button></div>
       <div class="scroll" style="margin-bottom:14px"><table><thead><tr><th>Account</th><th>Auto-reply</th><th>Hands mail to</th><th>Mail</th><th></th></tr></thead><tbody>
       ${d.users.filter((u) => u.role === "service").map((u) => `<tr>
         <td><b>${h(u.name || u.username)}</b><div class="faint small mono">${h(u.address || u.username + "@" + (d.domain || "…"))}</div></td>
         <td>${u.autoReply.enabled ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>'}</td>
         <td><div class="selpick"><select class="input" style="width:auto" data-fwd="${h(u.username)}">
           <option value="">its own inbox</option>
           ${d.users.filter((x) => x.role !== "service").map((x) => `<option value="${h(x.username)}" ${u.forwardTo === x.username ? "selected" : ""}>${h(x.username)}</option>`).join("")}
         </select></div></td>
         <td class="mono">${u.counts.inbox}/${u.counts.sent}</td>
         <td><div class="tbl-actions">
           <button class="btn sm" data-open="${h(u.username)}">Open</button>
           <button class="btn sm" data-auto="${h(u.username)}">Auto-reply</button>
           <button class="btn sm ghost danger" data-del="${h(u.username)}">Delete</button>
         </div></td></tr>`).join("")}
       </tbody></table></div>
       <div class="faint small" style="margin:-6px 0 14px">Contacting a service account: the mail files into its inbox, and when it hands mail to someone, a copy lands with them too.</div>
       <div class="card"><h3>When an address is nobody's <span class="faint">— mail for a name no account has</span></h3>
         <div class="field"><span>What happens</span><div class="selpick"><select class="input" id="invMode" style="width:100%">
           <option value="off" ${inv.mode === "off" ? "selected" : ""}>drop it quietly</option>
           <option value="reply" ${inv.mode === "reply" ? "selected" : ""}>send the preset answer below</option>
           <option value="catch" ${inv.mode === "catch" ? "selected" : ""}>deliver it to a catch-all account — the first admin unless you pick one below</option>
         </select></div></div>
         <div class="field"><span>Answered by (service account)</span><div class="selpick"><select class="input" id="invAccount" style="width:100%">
           ${d.users.filter((u) => u.role === "service").map((u) => `<option value="${h(u.username)}" ${inv.account === u.username ? "selected" : ""}>${h(u.username)}</option>`).join("")}
         </select></div></div>
         <div class="field"><span>Catch-all account</span><div class="selpick"><select class="input" id="invCatch" style="width:100%">
           <option value="">—</option>
           ${d.users.map((u) => `<option value="${h(u.username)}" ${inv.catch === u.username ? "selected" : ""}>${h(u.username)}</option>`).join("")}
         </select></div></div>
         <div class="field"><span>Subject — <span class="mono">{address}</span>, <span class="mono">{domain}</span>, <span class="mono">{sender}</span></span><input class="input" id="invSubject" value="${h(inv.subject)}"></div>
         ${editorField("invEd", { text: inv.text, html: inv.html })}
         <div class="faint small" style="margin:-6px 0 10px">The same placeholders fill in on both sides; an HTML answer rides beside the text one.</div>
         <div class="switchrow"><div class="grow"><b>Keep a copy</b><span class="faint small">file the rejected mail into the answering account's inbox</span></div>
           <label class="switch"><input type="checkbox" id="invKeep" ${inv.keep ? "checked" : ""}><i></i></label></div>
         <div class="row"><button class="btn primary" id="invSave">Save</button></div>
         <div class="note" id="invMsg" hidden></div>
       </div>
       <div class="faint small" style="margin-top:10px">Machine-sent answers this hour: ${d.answers ? `${d.answers.cap - d.answers.left} of ${d.answers.cap} — past the cap, mail still files but nothing is answered` : "—"}</div>`;
  $("#addSvc").addEventListener("click", () => {
    const m = modal(`<h2>Add a service account</h2>
      <div class="field"><span>Name (its address: name@${h(d.domain || "your-domain")})</span><input class="input" id="nsUser" placeholder="billing" spellcheck="false" autocapitalize="none"></div>
      <div class="field"><span>Full name (optional)</span><input class="input" id="nsName"></div>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nsGo">Add</button></div>
      <div class="note" id="nsMsg" hidden></div>`);
    $("#nsGo", m.el).addEventListener("click", async () => {
      const msg = $("#nsMsg", m.el);
      try { const r = await api("admin/users", { method: "POST", body: { username: $("#nsUser", m.el).value.trim().toLowerCase(), name: $("#nsName", m.el).value.trim(), role: "service" } }); m.close(); toast(`${r.user.username} added.`); viewService(); }
      catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
    });
  });
  for (const b of app.querySelectorAll("[data-open]")) b.addEventListener("click", () => { S.as = b.dataset.open; location.hash = "#/inbox"; route("#/inbox"); });
  for (const b of app.querySelectorAll("[data-auto]")) b.addEventListener("click", () => { S.as = b.dataset.auto; location.hash = "#/auto"; route("#/auto"); });
  for (const b of app.querySelectorAll("[data-del]")) b.addEventListener("click", async () => {
    if (!confirm(`Delete ${b.dataset.del} and its mail?`)) return;
    try { await api(`admin/users/${b.dataset.del}?mail=drop`, { method: "DELETE" }); toast("Deleted."); viewService(); } catch (e) { toast(e.message); }
  });
  wireEditor("invEd", inv);
  for (const sel of app.querySelectorAll("[data-fwd]")) sel.addEventListener("change", async () => {
    try { await api(`admin/users/${sel.dataset.fwd}`, { method: "PATCH", body: { forwardTo: sel.value } }); toast(`${sel.dataset.fwd} hands its mail to ${sel.value || "its own inbox"}.`); viewService(); }
    catch (e) { toast(e.message); viewService(); }
  });
  $("#invSave").addEventListener("click", async () => {
    const msg = $("#invMsg");
    try {
      await api("admin/system", { method: "PUT", body: { invalid: {
        mode: $("#invMode").value, account: $("#invAccount").value, catch: $("#invCatch").value,
        subject: $("#invSubject").value, text: $("#invEdText").value, html: $("#invEdHtml").innerHTML, keep: $("#invKeep").checked,
      } } });
      msg.hidden = false; msg.className = "note ok"; msg.textContent = "Saved.";
    } catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
  });
}
VIEWS.service = viewService;

// ------------------------------------------------------------------ admin: keys
async function viewKeys() {
  const d = await adminView(); if (!d) return;
  app.innerHTML = head("API keys", "What another program uses to reach one account's mail: Authorization: Bearer sm_…")
    + `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="addKey">New key</button><span class="faint small">a program sends <span class="mono">Authorization: Bearer sm_…</span> to this app's /api/…</span></div>
       <div class="scroll"><table><thead><tr><th>Name</th><th>Account</th><th>Scope</th><th>Used</th><th>Created</th><th></th></tr></thead><tbody>
       ${d.keys.length ? d.keys.map((k) => `<tr>
         <td><b>${h(k.name)}</b><div class="faint small mono">${h(k.id)}</div></td>
         <td class="mono">${h(k.owner)}</td>
         <td><span class="pill ${k.scope === "admin" ? "warn" : k.scope === "send" ? "role-user" : ""}">${h(k.scope)}</span></td>
         <td class="faint small">${k.lastUsed ? when(k.lastUsed) : "never"}</td>
         <td class="faint small">${when(k.created)}</td>
         <td><div class="tbl-actions"><button class="btn sm ghost danger" data-revoke="${h(k.id)}">Revoke</button></div></td>
       </tr>`).join("") : `<tr><td colspan="6" class="empty">No keys yet.</td></tr>`}
       </tbody></table></div>`;
  $("#addKey").addEventListener("click", () => {
    const m = modal(`<h2>New API key</h2>
      <div class="field"><span>Name</span><input class="input" id="nkName" placeholder="backup script" autofocus></div>
      <div class="field"><span>Account</span><div class="selpick"><select class="input" id="nkOwner" style="width:100%">${d.users.map((u) => `<option value="${h(u.username)}">${h(u.username)}${u.role === "service" ? " (service)" : ""}</option>`).join("")}</select></div></div>
      <div class="field"><span>Scope</span><div class="selpick"><select class="input" id="nkScope" style="width:100%">
        <option value="read">read — list and read that account's mail</option>
        <option value="send">send — also write and send as it</option>
        <option value="admin">admin — everything, every account</option>
      </select></div></div>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="nkGo">Create</button></div>
      <div class="note" id="nkMsg" hidden></div>`);
    $("#nkGo", m.el).addEventListener("click", async () => {
      const msg = $("#nkMsg", m.el);
      try {
        const r = await api("admin/keys", { method: "POST", body: { name: $("#nkName", m.el).value.trim(), owner: $("#nkOwner", m.el).value, scope: $("#nkScope", m.el).value } });
        m.close();
        const k = modal(`<h2>${h(r.keyView.name)}</h2>
          <div class="keybox"><span class="faint small">Shown once — copy it now:</span><code>${h(r.key)}</code></div>
          <div class="row end"><button class="btn primary" data-close>Done</button></div>`);
        k.el.querySelector("code").addEventListener("click", () => {
          navigator.clipboard?.writeText(r.key).then(() => toast("Copied."), () => {});
        });
        viewKeys();
      } catch (e) { msg.hidden = false; msg.className = "note bad"; msg.textContent = e.message; }
    });
  });
  for (const b of app.querySelectorAll("[data-revoke]")) b.addEventListener("click", async () => {
    if (!confirm("Revoke this key? The program using it stops working.")) return;
    try { await api(`admin/keys/${b.dataset.revoke}`, { method: "DELETE" }); toast("Revoked."); viewKeys(); } catch (e) { toast(e.message); }
  });
}
VIEWS.keys = viewKeys;

// ------------------------------------------------------------------ admin: system (shortcuts to the pieces)
async function viewSystem() {
  const d = await adminView(); if (!d) return;
  const inv = d.system.invalid;
  app.innerHTML = head("System", "What the machine says for itself.")
    + `<div class="card"><h3>Invalid addresses <span class="faint">— ${inv.mode === "off" ? "dropped quietly" : inv.mode === "reply" ? `answered by ${h(inv.account)}` : `caught by ${h(inv.catch || "the first admin")}`}</span></h3>
        <div class="note">${h(inv.subject)}</div>
        <div class="row"><a class="btn" href="#/service">Change it under Service accounts</a></div></div>
       <div class="card"><h3>Accounts</h3>
        <div class="kv">
          <dt>Users</dt><dd>${d.users.filter((u) => u.role !== "service").length}</dd>
          <dt>Service</dt><dd>${d.users.filter((u) => u.role === "service").map((u) => h(u.username)).join(", ")}</dd>
          <dt>Keys</dt><dd>${d.keys.length}</dd>
        </div>
        <div class="row mt"><a class="btn" href="#/users">Users</a><a class="btn" href="#/service">Service accounts</a><a class="btn" href="#/keys">API keys</a></div></div>`;
}
VIEWS.system = viewSystem;

// ------------------------------------------------------------------ go
boot();
setInterval(async () => { if (S.session?.user) { await refresh(); } }, 20000);
