// Selfmail's app: the pages and the API, started by weft/service.sh with
// data/config.json as its argument. Zero dependencies, Node 18+.
//
//   /                     the mail page (also served under Aegis × Burrow at
//                         /__gate/selfmail/, behind its login), with its own
//                         account sign-in: pick an account, enter its password
//   /health               {"app":"selfmail","ok":true,"version":…}
//
//   Accounts (a session cookie, or an API key: "Authorization: Bearer sm_…")
//   /api/session          who is signed in, and the first-run state
//   /api/users            the sign-in list (the dropdown)
//   /api/first-run        create the first admin and claim the old mail
//   /api/login, /api/logout
//   /api/account/password change your own password
//   /api/auto-reply       the preset answer sent when someone contacts you
//
//   The mailbox (your account's; an admin can pass ?as=account for any other,
//   including service accounts)
//   /api/messages?box=…   inbox | drafts | sent | trash
//   /api/message/ID       one message whole
//   /api/draft            save (or update) a draft
//   /api/send             send now: hand it to the local mail agent
//   /api/resend           try a sent message again
//   /api/message/ID/read  mark read or unread
//   /api/message/ID/move  to trash, or back out of it
//   /api/message/ID       DELETE: gone for good
//   /api/dns, /api/dns-check, /api/mta, /api/state
//
//   Admin (an admin session, or an admin API key)
//   /api/admin/view       accounts, keys, system settings
//   /api/admin/users      POST new, PATCH /ID, DELETE /ID
//   /api/admin/keys       POST new (the key is shown once), DELETE /ID
//   /api/admin/system     what happens to mail for an address no account has
//
//   /inbound/SECRET       where a relay POSTs your incoming mail; it is routed
//                         to the account it names, auto-answered when a preset
//                         response is on, and answered by the subsystem when
//                         the address is nobody's
//
// While it runs it keeps this addon's entry on the Weft mesh fresh.

import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appConfig, Store, newId, snippet, splitAddresses, goodAddress, USERNAME_RE,
  messageFromRaw, messageFromJson, buildMime, sendViaLocalMta, mtaCheck,
  dnsRecords, checkDns, publicIp, hashPassword, verifyPassword, signToken, verifyToken, keyHash,
  userView, defaultAutoReply, defaultSystem,
} from "./mail.mjs";

const CONF = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..", "data", "config.json");
const DATA = dirname(CONF);
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const cfg = appConfig(DATA);
const store = new Store(DATA);
const started = Date.now();
const NAME = "Selfmail";

if (!cfg.port) { console.error("selfmail: no port in", CONF); process.exit(1); }

// ------------------------------------------------------------------ the mesh
// One JSON file per running addon, refreshed every 30 s and removed when this
// stops (SPEC.md, "The mesh").
const MESH_DIR = process.env.MESH || cfg.mesh ||
  join((process.env.XDG_CONFIG_HOME || join(process.env.HOME || "", ".config")), "weft", "mesh");
const hostForUrl = (bind) => (["0.0.0.0", "::", ""].includes(bind) ? "127.0.0.1" : bind.includes(":") ? `[${bind}]` : bind);
const baseUrl = () => `http://${hostForUrl(cfg.bind)}:${cfg.port}/`;
const meshFile = () => join(MESH_DIR, `${cfg.id}.json`);
function writeMesh() {
  try {
    const fresh = appConfig(DATA);         // the extension's state may have changed since boot
    const entry = {
      spec: 1, id: cfg.id, name: NAME, version: cfg.version, host: cfg.host,
      url: baseUrl(), health: baseUrl() + "health", port: cfg.port,
      provides: ["mail"],
      items: fresh.address ? [{ name: fresh.address, title: "The mailbox this addon serves", running: true, url: baseUrl() }] : [],
      routes: fresh.tunnel?.url ? { inbound: fresh.tunnel.url } : {},
      updated: Math.floor(Date.now() / 1000),
    };
    const tmp = `${meshFile()}.${process.pid}.tmp`;
    mkdirSync(MESH_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify(entry, null, 2), { mode: 0o644 });
    renameSync(tmp, meshFile());
  } catch (e) { console.error("mesh:", e.message); }
}
function withdraw() { try { rmSync(meshFile(), { force: true }); } catch { /* already gone */ } }

// ------------------------------------------------------------------ helpers
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const send = (res, status, body, type = "application/json; charset=utf-8", extra = {}) => {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
  res.end(data);
};
const deny = (status, error) => ({ status, json: { error } });   // for helpers; the caller sends it
const readBody = (req, limit = 3 * 1024 * 1024) => new Promise((ok, no) => {
  let size = 0; const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > limit) { no(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => ok(Buffer.concat(chunks)));
  req.on("error", no);
});
const parseCookies = (header) => Object.fromEntries(String(header || "").split(";").map((p) => p.split("=")).filter((x) => x.length > 1).map(([k, ...v]) => [k.trim(), v.join("=")]));

// the webhook URL, when Burrow has published one (the extension writes
// data/state.json; the secret is the one from your settings, or the one the
// store made on first run)
function inboundUrl() {
  const fresh = appConfig(DATA);
  const url = fresh.tunnel?.url;
  return url ? `${url.replace(/\/$/, "")}/inbound/${encodeURIComponent(store.secretOr(fresh.inboundSecret))}` : "";
}

// the first interactive account (the admin who was created first) — mail that
// names no local account at our domain lands with them rather than being lost
const primaryAccount = () => store.accounts({ service: false }).find((u) => u.role === "admin") || store.accounts({ service: false })[0] || null;

// The machine's domains: the mail-domain setting first, then every domain the
// host has linked (the extension lists them in state.json as it finds them).
// All of them are served unless an admin switched one off — the switches live
// in system.domains, and the mail-domain setting is always served (it is the
// address the app was installed with).
function allDomains() {
  const fresh = appConfig(DATA);
  const out = [];
  for (const z of [fresh.domain, ...fresh.domains]) {
    const d = String(z || "").trim().toLowerCase();
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}
const primaryDomain = () => allDomains()[0] || "";
const enabledDomains = () => {
  const off = store.data.system.domains || {};
  const on = allDomains().filter((z) => z !== primaryDomain() && off[z] === false ? false : true);
  return on.length ? on : allDomains();
};
const domainView = () => ({ all: allDomains(), enabled: enabledDomains(), primary: primaryDomain() });
const addressOf = (username, domain) => {
  const d = String(domain || "").trim().toLowerCase() || primaryDomain();
  return d ? `${username}@${d}` : "";
};

async function stateView() {
  const fresh = appConfig(DATA);           // pick up the extension's state as soon as it writes it
  const primary = primaryAccount();
  return {
    app: fresh.id, version: cfg.version, started,
    mailbox: primary?.username || fresh.mailbox, domain: primaryDomain(),
    address: primary ? addressOf(primary.username) : fresh.address,
    domains: enabledDomains(),
    accounts: store.accounts({ service: false }).length,
    zoneLinked: fresh.zoneLinked, webhookWanted: fresh.webhookWanted,
    inbound: inboundUrl(),
    tunnel: fresh.tunnel,
    counts: store.counts(),
  };
}

// ------------------------------------------------------------------ access
const COOKIE = "selfmail_session";
const SESSION_DAYS = 7;
const sessionCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
const sessionOf = (username) => signToken({ u: username, exp: Date.now() + SESSION_DAYS * 86400e3 }, store.sessionSecret);

// a signed-in browser, or a program holding one of the API keys
function authOf(req) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
  if (bearer) {
    const rec = store.keyByHash(keyHash(bearer[1]));
    if (rec) {
      const u = store.user(rec.owner);
      if (u) { store.touchKey(rec.id); return { user: u, via: "key", scope: rec.scope }; }
    }
    return null;
  }
  const tok = verifyToken(parseCookies(req.headers.cookie)[COOKIE], store.sessionSecret);
  if (tok) {
    const u = store.user(tok.u);
    if (u) return { user: u, via: "session", scope: u.role === "admin" ? "admin" : "send" };
  }
  return null;
}
const isAdminAuth = (auth) => !!auth && (auth.via === "session" ? auth.user.role === "admin" : auth.scope === "admin");
const scopeAllows = (auth, method) => {
  if (!auth) return false;
  if (auth.scope === "admin") return true;
  if (method === "GET" || method === "HEAD") return ["read", "send", "admin"].includes(auth.scope);
  return ["send", "admin"].includes(auth.scope);
};

// the account whose mailbox a request is about: your own, or — for an admin —
// any account at all, service accounts included (?as=name)
function effectiveUser(req, u) {
  const auth = authOf(req);
  if (!auth) return { deny: deny(401, "login required") };
  if (!scopeAllows(auth, req.method)) return { deny: deny(403, "This key may only read.") };
  const wantAs = u.searchParams.get("as");
  if (wantAs) {
    if (!isAdminAuth(auth)) return { deny: deny(403, "Only an admin can open another account.") };
    const as = store.user(wantAs);
    if (!as) return { deny: deny(404, "No such account.") };
    return { auth, user: as };
  }
  return { auth, user: auth.user };
}

// ------------------------------------------------------------------ sending
// Send as one account. Returns {status, json}; the message lands in that
// account's Sent with the agent's honest verdict.
async function doSend(body, fromDraft, account, { auto = false } = {}) {
  const fresh = appConfig(DATA);
  const chosen = String(body.domain || "").trim().toLowerCase();
  const from = addressOf(account.username, chosen && enabledDomains().includes(chosen) ? chosen : "");
  if (!from) return deny(409, "No mail domain: link one in Aegis × Burrow (Settings → Domain), or set the Mail domain setting.");
  const to = splitAddresses(body.to).map((s) => s.replace(/^<|>$/g, ""));
  const cc = splitAddresses(body.cc).map((s) => s.replace(/^<|>$/g, ""));
  const all = [...to, ...cc];
  if (!to.length || !all.every(goodAddress)) return deny(400, "Every address must look like name@domain.tld.");
  const subject = String(body.subject || "").trim();
  const text = String(body.text || "").slice(0, 512 * 1024);
  if (!subject && !text) return deny(400, "Nothing to send: give it a subject or a body.");

  const message = buildMime({
    from, fromName: account.name || fresh.fromName, to, cc, subject, text,
    html: body.html ? String(body.html).slice(0, 512 * 1024) : "",
    domain: fresh.domain, inReplyTo: body.inReplyTo || "",
    headers: auto ? ["Auto-Submitted: auto-replied", "X-Selfmail-Auto: 1"] : [],
  });
  let delivery = { ok: false, stage: "local", error: "not attempted" };
  if (body.outboxOnly) {
    delivery = { ok: null, stage: "outbox", error: "", note: "Saved without trying to deliver." };
  } else {
    delivery = await sendViaLocalMta({ from, to: all, message, helo: fresh.domain || "selfmail.local" });
  }
  const msg = {
    id: newId(), box: "sent", read: true, owner: account.username, auto: auto || undefined,
    from, to: to.join(", "), cc: cc.join(", "), subject, text,
    html: body.html ? String(body.html) : "", date: Date.now(), delivery: { ...delivery, at: Date.now() },
    snippet: snippet(text), inReplyTo: String(body.inReplyTo || "").slice(0, 500),
  };
  if (fromDraft) store.remove(fromDraft);
  store.add(msg);
  return { status: 200, json: msg };
}

// ------------------------------------------------------------------ inbound
// One message arrives for the domain: route it to the accounts it names, let
// each preset response answer, and let the subsystem answer for addresses
// that are nobody's — all exactly as the admin set it up.
// every To/Cc address on a domain this mailbox serves: its local part, and the
// domain it came in on (the preset answers {domain} with that one)
const routesAt = (msg) => {
  const enabled = enabledDomains();
  const out = [];
  for (const addr of [...splitAddresses(msg.to), ...splitAddresses(msg.cc)]) {
    const a = String(addr).replace(/^<|>$/g, "").toLowerCase();
    const at = a.lastIndexOf("@");
    const d = at > 0 ? a.slice(at + 1) : "";
    if (d && enabled.includes(d)) out.push({ local: a.slice(0, at), domain: d });
  }
  return out;
};
const looksAuto = (raw) => /(^|\n)(Auto-Submitted:\s*auto|X-Selfmail-Auto:\s*1)/i.test(String(raw || ""));

// A small machine can be buried by answering a spam wave (a dictionary attack on
// one of the domains fills the mail agent's queue with retries). The machine
// answers at most this many per rolling hour; the mail itself is still filed.
const AUTO_CAP = 30;
const autoSpent = [];
const autoBudget = () => {
  const now = Date.now();
  while (autoSpent.length && autoSpent[0] <= now - 3600e3) autoSpent.shift();
  return { left: AUTO_CAP - autoSpent.length, spent: autoSpent.length, cap: AUTO_CAP, hour: 3600 };
};
const autoSpend = () => { autoSpent.push(Date.now()); };

async function autoAnswer(msg, account, domain) {
  const a = { ...defaultAutoReply(), ...account.autoReply };
  if (!a.enabled || !a.text) return null;
  if (!msg.from || !goodAddress(msg.from)) return null;
  if (enabledDomains().some((d) => String(msg.from).toLowerCase().endsWith("@" + d))) return null;  // never answer ourselves
  if (msg.robot) return null;                                                                   // nor robots
  if (!store.shouldAutoReply(account, msg.from)) return null;                                   // nor twice in one cooldown
  if (autoBudget().left <= 0) { console.log("auto-reply: hourly cap reached, not answered"); return null; }  // nor a spam wave
  const fill = (s) => String(s || "")
    .replaceAll("{subject}", msg.subject || "(no subject)")
    .replaceAll("{sender}", msg.from)
    .replaceAll("{address}", msg.from)
    .replaceAll("{domain}", domain || primaryDomain());
  store.markAutoReplied(account, msg.from);
  autoSpend();
  const r = await doSend({ to: msg.from, subject: fill(a.subject), text: fill(a.text), inReplyTo: msg.messageId || "" }, null, account, { auto: true });
  return r.status === 200 ? r.json : null;
}

async function handleInbound(raw) {
  const fresh = appConfig(DATA);
  let msg;
  if (raw.charAt(0) === "{") {
    try { msg = messageFromJson(JSON.parse(raw), fresh.address || "you@your-domain"); } catch { msg = null; }
  }
  if (!msg) msg = messageFromRaw(raw, fresh.address || "you@your-domain");
  msg.robot = looksAuto(raw);
  const delivered = [];
  const routes = routesAt(msg);
  const accounts = [];
  for (const r of routes) {
    const u = store.user(r.local);
    if (u && !accounts.some((a) => a.user === u)) accounts.push({ user: u, domain: r.domain });
  }
  if (accounts.length) {
    for (const { user: account, domain } of accounts) {
      store.add({ ...msg, owner: account.username });
      delivered.push(account.username);
      const reply = await autoAnswer(msg, account, domain);        // the preset response, if one is on
      if (reply) console.log(`auto-reply: ${account.username} -> ${msg.from}`);
    }
    return { delivered };
  }
  // one of our domains, but no account has the address: the admin's call
  if (routes.length) {
    const inv = store.data.system.invalid;
    const sender = msg.from && goodAddress(msg.from) ? msg.from : "";
    const localSender = enabledDomains().some((d) => sender.toLowerCase().endsWith("@" + d));
    if (inv.mode === "catch" && inv.catch && store.user(inv.catch)) {
      store.add({ ...msg, owner: inv.catch });
      return { delivered: [inv.catch] };
    }
    if (inv.mode === "reply" && inv.account && store.user(inv.account) && sender && !localSender && !msg.robot) {
      const account = store.user(inv.account);
      const fill = (s) => String(s || "")
        .replaceAll("{address}", routes.map((r) => r.local + "@" + r.domain).join(", "))
        .replaceAll("{domain}", routes[0].domain)
        .replaceAll("{sender}", sender);
      if (inv.keep) store.add({ ...msg, owner: account.username });
      if (autoBudget().left <= 0) { console.log("invalid: hourly cap reached, not answered (a copy is kept)"); }
      else {
        autoSpend();
        const r = await doSend({ to: sender, subject: fill(inv.subject), text: fill(inv.text) }, null, account, { auto: true });
        if (r.status === 200) {
          console.log(`invalid: ${routes.map((x) => x.local + "@" + x.domain).join(", ")} -> told ${sender}`);
          return { delivered: [], answered: account.username };
        }
        return { delivered: [], answerFailed: r.json?.error || "the answer could not be sent" };
      }
    }
    console.log(`invalid: ${routes.map((r) => r.local + "@" + r.domain).join(", ")} -> dropped (${inv.mode})`);
    return { delivered: [] };
  }
  // addressed elsewhere entirely: nothing is silently lost — the primary admin keeps it
  const primary = primaryAccount();
  if (primary) { store.add({ ...msg, owner: primary.username }); return { delivered: [primary.username] }; }
  store.add(msg);
  return { delivered: ["(unclaimed)"] };
}

// ------------------------------------------------------------------ the server
const server = createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://x");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  try {
    // the inbound webhook: authorized by the secret in the path, like selfmail
    if (path.startsWith("/inbound/")) {
      const m = /^\/inbound\/([^/]+)(\/ping)?$/.exec(path);
      const secret = store.secretOr(cfg.inboundSecret);
      if (!m || decodeURIComponent(m[1]) !== secret) return send(res, 403, { error: "forbidden" });
      if (m[2]) return send(res, 200, { ok: true, ready: true, app: "selfmail" });
      if (req.method !== "POST") return send(res, 405, { error: "POST the message here." });
      const raw = (await readBody(req, 30 * 1024 * 1024)).toString("utf8");
      if (!raw.trim()) return send(res, 400, { error: "empty body" });
      const r = await handleInbound(raw);
      console.log(`inbound: from the relay -> ${r.delivered?.join(", ") || "nobody"}${r.answered ? ` (answered by ${r.answered})` : ""}`);
      return send(res, 200, { ok: true, ...r, bytes: raw.length });
    }

    if (path === "/health") return send(res, 200, { app: "selfmail", ok: true, version: cfg.version });

    // the pages
    if (req.method === "GET" || req.method === "HEAD") {
      const known = { "/": "/index.html", "/app.js": "/app.js", "/app.css": "/app.css", "/logo.svg": "/logo.svg" };
      const file = known[path];
      if (file && existsSync(join(PUBLIC, file))) {
        return send(res, 200, readFileSync(join(PUBLIC, file)), TYPES[extname(file)], { "Cache-Control": "no-cache" });
      }
    }

    // the API
    if (path.startsWith("/api/")) {
      const body = async () => JSON.parse((await readBody(req)).toString("utf8") || "{}");

      // ---- open: the sign-in screen and the status feeds
      if (path === "/api/state" && req.method === "GET") return send(res, 200, await stateView());
      if (path === "/api/users" && req.method === "GET")
        return send(res, 200, store.accounts({ service: false }).map((x) => ({ username: x.username, name: x.name, role: x.role })));
      if (path === "/api/session" && req.method === "GET") {
        const auth = authOf(req);
        const firstRun = store.accounts({ service: false }).length === 0;
        if (!auth) return send(res, 200, { user: null, firstRun, version: cfg.version });
        return send(res, 200, { user: { ...userView(auth.user), via: auth.via, scope: auth.scope, address: addressOf(auth.user.username), counts: store.counts(auth.user.username) }, firstRun: false, version: cfg.version });
      }
      if (path === "/api/first-run" && req.method === "POST") {
        if (store.accounts({ service: false }).length) return send(res, 409, { error: "The first account already exists." });
        const f = await body();
        if (String(f.password || "").length < 8) return send(res, 400, { error: "Use at least 8 characters." });
        let user;
        try { user = store.addUser({ username: f.username, name: f.name || "", role: "admin", password: f.password }); }
        catch (e) { return send(res, 400, { error: e.message }); }
        store.claimMail(user.username);
        return send(res, 200, { user: { ...userView(user), address: addressOf(user.username) }, setCookie: sessionCookie(sessionOf(user.username)) }, "application/json; charset=utf-8", { "Set-Cookie": sessionCookie(sessionOf(user.username)) });
      }
      if (path === "/api/login" && req.method === "POST") {
        const f = await body();
        const user = store.user(f.username);
        if (!user || user.role === "service" || !user.password || !verifyPassword(f.password || "", user.password))
          return send(res, 403, { error: "That name and password do not match." });
        return send(res, 200, { user: userView(user) }, "application/json; charset=utf-8", { "Set-Cookie": sessionCookie(sessionOf(user.username)) });
      }
      if (path === "/api/logout" && req.method === "POST")
        return send(res, 200, { ok: true }, "application/json; charset=utf-8", { "Set-Cookie": clearCookie });

      // ---- from here on: signed in, or a valid API key
      const gate = (u2, admin = false) => {
        const auth = authOf(req);
        if (!auth) return { deny: deny(401, "login required") };
        if (admin && !isAdminAuth(auth)) return { deny: deny(403, "Admins only.") };
        if (!admin && !scopeAllows(auth, req.method)) return { deny: deny(403, auth.scope === "read" ? "This key may only read." : "This key cannot do that.") };
        return { auth };
      };

      if (path === "/api/account/password" && req.method === "POST") {
        const g = gate(); if (g.deny) return send(res, g.deny.status, g.deny.json);
        if (g.auth.via !== "session") return send(res, 403, { error: "Sign in with the page to change a password." });
        const f = await body();
        if (!verifyPassword(f.current || "", g.auth.user.password)) return send(res, 403, { error: "The current password is wrong." });
        if (String(f.next || "").length < 8) return send(res, 400, { error: "Use at least 8 characters." });
        store.setUser(g.auth.user.username, { password: f.next });
        return send(res, 200, { ok: true });
      }

      if (path === "/api/auto-reply" && req.method === "GET") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        return send(res, 200, { username: g.user.username, address: addressOf(g.user.username), autoReply: { ...defaultAutoReply(), ...g.user.autoReply } });
      }
      if (path === "/api/auto-reply" && req.method === "PUT") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        store.setUser(g.user.username, { autoReply: {
          enabled: !!f.enabled, subject: String(f.subject || "").slice(0, 200), text: String(f.text || "").slice(0, 32 * 1024),
          cooldown: Math.max(0, Math.min(1440, Number(f.cooldown) || 0)),
        } });
        return send(res, 200, { ok: true, autoReply: { ...defaultAutoReply(), ...store.user(g.user.username).autoReply } });
      }
      if (path === "/api/auto-reply/test" && req.method === "POST") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        if (!goodAddress(String(f.to || ""))) return send(res, 400, { error: "Give an address to send the test to." });
        const a = { ...defaultAutoReply(), ...g.user.autoReply };
        const r = await doSend({ to: f.to, subject: a.subject || "Auto-reply test", text: a.text || "(empty)" }, null, g.user, { auto: true });
        return send(res, r.status, r.json);
      }

      if (path === "/api/messages" && req.method === "GET") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const box = u.searchParams.get("box") || "inbox";
        if (!["inbox", "drafts", "sent", "trash"].includes(box)) return send(res, 400, { error: "No such folder." });
        const msgs = store.list(box, g.user.username).map(({ html, text, ...rest }) => ({ ...rest, bytes: (text || "").length + (html || "").length }));
        return send(res, 200, msgs);
      }

      const one = /^\/api\/message\/([a-z0-9]+)(\/(read|move))?$/.exec(path);
      if (one) {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const msg = store.get(one[1]);
        if (!msg || msg.owner !== g.user.username) return send(res, 404, { error: "No such message." });
        if (!one[2] && req.method === "GET") return send(res, 200, msg);
        if (one[3] === "read" && req.method === "POST") {
          const f = await body();
          store.update(msg.id, { read: !!f.read });
          return send(res, 200, store.get(msg.id));
        }
        if (one[3] === "move" && req.method === "POST") {
          const f = await body();
          const box = String(f.box || "");
          const back = msg.inbound ? "inbox" : "sent";
          if (!["trash", back].includes(box)) return send(res, 400, { error: `Move it to trash, or back to ${back}.` });
          store.update(msg.id, { box });
          return send(res, 200, store.get(msg.id));
        }
        if (!one[2] && req.method === "DELETE") {
          store.remove(msg.id);
          return send(res, 200, { ok: true });
        }
      }

      if (path === "/api/draft" && req.method === "POST") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        const to = splitAddresses(f.to).map((s) => s.replace(/^<|>$/g, ""));
        const cc = splitAddresses(f.cc).map((s) => s.replace(/^<|>$/g, ""));
        if (![...to, ...cc].every(goodAddress)) return send(res, 400, { error: "Every address must look like name@domain.tld." });
        const draft = {
          id: f.id || newId(), box: "drafts", read: true, owner: g.user.username,
          from: addressOf(g.user.username), to: to.join(", "), cc: cc.join(", "),
          subject: String(f.subject || "").slice(0, 500), text: String(f.text || "").slice(0, 512 * 1024),
          html: String(f.html || "").slice(0, 512 * 1024), date: Date.now(), snippet: snippet(f.text), inReplyTo: String(f.inReplyTo || "").slice(0, 500),
          domain: enabledDomains().includes(String(f.domain || "").toLowerCase()) ? String(f.domain).toLowerCase() : "",
        };
        const existing = f.id ? store.get(f.id) : null;
        if (existing && existing.owner === g.user.username && existing.box === "drafts") store.update(f.id, { to: draft.to, cc: draft.cc, subject: draft.subject, text: draft.text, html: draft.html, date: draft.date, snippet: draft.snippet, inReplyTo: draft.inReplyTo, domain: draft.domain });
        else store.add(draft);
        return send(res, 200, store.get(draft.id));
      }

      if (path === "/api/send" && req.method === "POST") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        const fromDraft = f.id && store.get(f.id)?.box === "drafts" && store.get(f.id)?.owner === g.user.username ? f.id : null;
        const r = await doSend(f, fromDraft, g.user);
        return send(res, r.status, r.json);
      }

      if (path === "/api/resend" && req.method === "POST") {
        const g = effectiveUser(req, u); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        const msg = store.get(f.id || "");
        if (!msg || msg.box !== "sent" || msg.owner !== g.user.username) return send(res, 404, { error: "No such sent message." });
        const fresh = appConfig(DATA);
        const all = [...splitAddresses(msg.to), ...splitAddresses(msg.cc)].map((s) => s.replace(/^<|>$/g, "")).filter(goodAddress);
        if (!all.length) return send(res, 400, { error: "No usable address on that message." });
        const message = buildMime({ from: msg.from, fromName: g.user.name || fresh.fromName, to: all.filter((a) => splitAddresses(msg.to).map((s) => s.replace(/^<|>$/g, "")).includes(a)), cc: [], subject: msg.subject, text: msg.text, html: msg.html, domain: fresh.domain });
        const delivery = await sendViaLocalMta({ from: msg.from, to: all, message, helo: fresh.domain || "selfmail.local" });
        store.update(msg.id, { delivery: { ...delivery, at: Date.now() } });
        return send(res, 200, store.get(msg.id));
      }

      const dnsDomain = () => {
        const want = String(u.searchParams.get("domain") || "").trim().toLowerCase();
        return enabledDomains().includes(want) ? want : primaryDomain();
      };
      if (path === "/api/dns" && req.method === "GET") {
        const g = gate(); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const ip = await publicIp();
        const d = dnsDomain();
        return send(res, 200, { domain: d, records: dnsRecords({ domain: d, webhookUrl: inboundUrl(), publicIp: ip, mailbox: appConfig(DATA).mailbox }), publicIp: ip });
      }
      if (path === "/api/dns-check" && req.method === "GET") {
        const g = gate(); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const ip = await publicIp();
        const d = dnsDomain();
        const records = dnsRecords({ domain: d, webhookUrl: inboundUrl(), publicIp: ip, mailbox: appConfig(DATA).mailbox });
        const rows = await checkDns(records);
        const ok = rows.filter((r) => r.ok).length;
        return send(res, 200, { domain: d, records: rows, ok, total: rows.length, allGood: ok === rows.length });
      }
      if (path === "/api/mta" && req.method === "GET") {
        const g = gate(); if (g.deny) return send(res, g.deny.status, g.deny.json);
        return send(res, 200, { ...(await mtaCheck()), checked: Date.now() });
      }
      if (path === "/api/domains" && req.method === "GET") {
        const g = gate(); if (g.deny) return send(res, g.deny.status, g.deny.json);
        return send(res, 200, domainView());
      }

      // ---- admin: accounts, keys, and what the subsystem does
      if (path === "/api/admin/view" && req.method === "GET") {
        // (the answer budget rides along, so an admin can see why nothing answers)
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        return send(res, 200, {
          users: store.accounts().map((x) => ({ ...userView(x), address: addressOf(x.username), messages: store.data.messages.filter((m) => m.owner === x.username).length, counts: store.counts(x.username) })),
          keys: store.data.keys.map(({ hash, ...k }) => k),
          system: store.data.system,
          domain: primaryDomain(),
          answers: autoBudget(),          // the machine-sent answers left this hour
        });
      }
      const adminUser = /^\/api\/admin\/users\/([a-z0-9._-]+)$/.exec(path);
      if (path === "/api/admin/users" && req.method === "POST") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        if (f.role !== "service" && String(f.password || "").length < 8) return send(res, 400, { error: "Use at least 8 characters (or make it a service account)." });
        try {
          const user = store.addUser({ username: f.username, name: f.name, role: f.role || "user", password: f.role === "service" ? "" : f.password });
          return send(res, 200, { user: { ...userView(user), address: addressOf(user.username) } });
        } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if (adminUser && req.method === "PATCH") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const user = store.user(adminUser[1]);
        if (!user) return send(res, 404, { error: "No such account." });
        const f = await body();
        const admins = store.accounts({ service: false }).filter((x) => x.role === "admin");
        if (f.role && f.role !== user.role && user.role === "admin" && admins.length <= 1) return send(res, 409, { error: "The last admin stays an admin." });
        if (f.password !== undefined && user.role !== "service" && String(f.password).length < 8) return send(res, 400, { error: "Use at least 8 characters." });
        store.setUser(user.username, { name: f.name, role: f.role, password: f.password === undefined ? undefined : (f.password || ""), autoReply: f.autoReply });
        return send(res, 200, { user: { ...userView(store.user(user.username)), address: addressOf(user.username) } });
      }
      if (adminUser && req.method === "DELETE") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const user = store.user(adminUser[1]);
        if (!user) return send(res, 404, { error: "No such account." });
        if (user.role === "admin" && store.accounts({ service: false }).filter((x) => x.role === "admin").length <= 1)
          return send(res, 409, { error: "The last admin stays." });
        const mode = u.searchParams.get("mail") === "drop" ? "drop" : "keep";
        if (mode === "keep") {
          const firstAdmin = store.accounts({ service: false }).find((x) => x.role === "admin" && x.username !== user.username);
          store.deleteUser(user.username, "drop");
          if (firstAdmin) { for (const m of store.data.messages) if (m.owner === user.username) m.owner = firstAdmin.username; store.save(); }
        } else store.deleteUser(user.username, "drop");
        return send(res, 200, { ok: true, deleted: user.username, mail: mode });
      }
      const adminKey = /^\/api\/admin\/keys\/([a-z0-9]+)$/.exec(path);
      if (path === "/api/admin/keys" && req.method === "POST") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        try {
          const { rec, key } = store.addKey({ name: f.name, owner: f.owner, scope: f.scope || "read" });
          return send(res, 200, { key, keyView: { id: rec.id, name: rec.name, owner: rec.owner, scope: rec.scope } });
        } catch (e) { return send(res, 400, { error: e.message }); }
      }
      if (adminKey && req.method === "DELETE") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        return send(res, store.removeKey(adminKey[1]) ? 200 : 404, { ok: true });
      }
      if (path === "/api/admin/domains" && req.method === "PUT") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        const zone = String(f.domain || "").trim().toLowerCase();
        if (!allDomains().includes(zone)) return send(res, 404, { error: "Not one of this machine's domains." });
        const sys = store.data.system;
        sys.domains = { ...(sys.domains || {}) };
        if (zone === primaryDomain()) return send(res, 400, { error: "The mail domain itself is always served — reinstall with another if you mean to change it." });
        if (f.on === false) sys.domains[zone] = false;
        else delete sys.domains[zone];
        store.save();
        return send(res, 200, domainView());
      }
      if (path === "/api/admin/system" && req.method === "PUT") {
        const g = gate(u, true); if (g.deny) return send(res, g.deny.status, g.deny.json);
        const f = await body();
        const inv = f.invalid || {};
        const cur = store.data.system;
        cur.invalid = {
          mode: ["off", "reply", "catch"].includes(inv.mode) ? inv.mode : cur.invalid.mode,
          account: store.user(inv.account) ? inv.account : cur.invalid.account,
          catch: store.user(inv.catch) ? inv.catch : (inv.catch === "" ? "" : cur.invalid.catch),
          subject: String(inv.subject || "").slice(0, 200), text: String(inv.text || "").slice(0, 32 * 1024),
          keep: !!inv.keep,
        };
        store.save();
        return send(res, 200, { system: cur });
      }

      return send(res, 404, { error: "not found" });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(`${req.method} ${path}:`, e.message);
    return send(res, e.message === "too large" ? 413 : 500, { error: e.message });
  }
});

server.listen(cfg.port, cfg.bind, () => {
  console.log(`selfmail ${cfg.version} on ${baseUrl()} (domain ${cfg.domain || "unset"}, ${store.accounts({ service: false }).length} accounts)`);
  writeMesh();
});
const meshTimer = setInterval(writeMesh, 30 * 1000);
meshTimer.unref?.();

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { withdraw(); clearInterval(meshTimer); process.exit(0); });
}
