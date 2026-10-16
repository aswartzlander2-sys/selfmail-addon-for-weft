// Selfmail's mail engine: the store, MIME reading and writing, handing mail to
// the machine's own mail agent, and the DNS records that bring mail in.
//
// The message reading (parseHeaders / decodeWords / textPartOf / htmlPartOf) and
// the relay-mode record list are carried over from selfmail
// (https://github.com/alexd-aero/selfmail, MIT), which this addon wraps for
// Aegis × Burrow. Sending works the same way selfmail's does: the app never
// connects to the internet to deliver anything — it hands each message to the
// local mail agent (the sendmail binary, or the MTA listening on loopback),
// and that agent makes the outbound connection.
//
// Accounts and access: usernames with scrypt-hashed passwords (admin, user and
// service roles), HMAC-signed sessions, and API keys another program can use to
// reach one account's mail. Zero dependencies, Node 18+.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { accessSync, constants as fsConstants } from "node:fs";
import { spawn } from "node:child_process";
import { resolve as resolvePath, join, dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from "node:crypto";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { promises as dns } from "node:dns";   // checkDns's resolver, straight to public servers

export const BOXES = ["inbox", "drafts", "sent", "trash"];
const NL = String.fromCharCode(10);
const MAX_BODY = 512 * 1024;          // half a megabyte of body is plenty for one message

// --------------------------------------------------------------------- config
// data/config.json is written by the install script (weft/lib.sh conf_write);
// data/state.json by the Burrow extension (the linked domain, the tunnel it
// made). The app only reads them; the store is the app's own.
export function loadJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function appConfig(dataDir) {
  const conf = loadJson(join(dataDir, "config.json"));
  const state = loadJson(join(dataDir, "state.json"));
  const zone = String(conf.mail_domain || "").trim() || String(state.zone || "").trim();
  const mailbox = String(conf.mailbox || "me").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") || "me";
  return {
    id: conf.id || "selfmail",
    version: conf.version || "",
    bind: conf.bind || "127.0.0.1",
    port: Number(conf.port) || 0,
    host: conf.host || "",
    hostUrl: conf.host_url || "",
    mailbox,
    fromName: String(conf.from_name || "").trim(),
    domain: zone,
    address: zone ? `${mailbox}@${zone}` : "",
    webhookWanted: String(conf.webhook ?? "1") !== "0" && conf.webhook !== false,
    inboundSecret: String(conf.inbound_secret || "").trim(),
    tunnel: state.tunnel || null,
    zoneLinked: !!state.zone,
    // every domain this machine has: what the extension keeps fresh in
    // state.json, plus what the install script seeded into config.json
    domains: [...new Set([
      ...(Array.isArray(state.domains) ? state.domains : []).map((d) => String(d || "").trim().toLowerCase()).filter(Boolean),
      ...String(conf.mail_domains || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
    ])],
  };
}

// --------------------------------------------------------------------- store
// One JSON file, data/store.json (mode 600), written whole and atomically: the
// accounts, the API keys, the system settings and every message. The whole
// mailbox is small: this is personal mail, not an archive.
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export const ROLES = ["admin", "user", "service"];
export const defaultAutoReply = () => ({ enabled: false, subject: "Re: {subject}", text: "", cooldown: 60 });
export const defaultSystem = () => ({
  invalid: {
    mode: "off",                       // off | reply | catch: what happens to mail for an address no account has
    account: "subsystem",              // the service account that answers (mode "reply")
    catch: "",                         // the account that receives it instead (mode "catch")
    subject: "Undeliverable: {address}",
    text: "The address {address} does not exist at {domain}.\n\nYour message was not delivered.",
    keep: false,                       // keep a copy in the answering account's inbox
  },
  domains: {},                        // zone -> false: a domain the admin switched off (absent = served)
});

export class Store {
  constructor(dataDir) {
    this.file = join(dataDir, "store.json");
    this.data = loadJson(this.file, {});
    if (!Array.isArray(this.data.messages)) this.data.messages = [];
    if (!Array.isArray(this.data.users)) this.data.users = [];
    if (!Array.isArray(this.data.keys)) this.data.keys = [];
    if (this.data.spec !== 2) {
      // spec 1 was one flat mailbox with no accounts: everything stays, ownerless
      // until the first admin is created and claims it
      this.data.spec = 2;
      for (const m of this.data.messages) if (m.owner == null) m.owner = "";
    }
    this.data.system = { ...defaultSystem(), ...(this.data.system || {}), invalid: { ...defaultSystem().invalid, ...((this.data.system || {}).invalid || {}) } };
    if (!this.data.secret) this.data.secret = randomBytes(16).toString("hex");
    if (!this.data.sessionSecret) this.data.sessionSecret = randomBytes(24).toString("hex");
    // the subsystem account: what the machine itself speaks with
    if (!this.user("subsystem")) {
      this.data.users.push({ username: "subsystem", name: "The subsystem", role: "service", password: "", autoReply: defaultAutoReply(), autoLog: {}, created: Date.now() });
    }
    this.save();
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  get secret() { return String(this.data.secret || ""); }
  get sessionSecret() { return String(this.data.sessionSecret || ""); }
  // the secret a relay must know: the one from the settings if you set one
  secretOr(settingsSecret) { return String(settingsSecret || "").trim() || this.secret; }

  // ---- accounts
  user(username) { const u = String(username || "").toLowerCase(); return this.data.users.find((x) => x.username === u) || null; }
  accounts({ service = true } = {}) { return this.data.users.filter((u) => service || u.role !== "service"); }
  addUser({ username, name = "", role = "user", password = "" }) {
    const u = String(username || "").toLowerCase();
    if (!USERNAME_RE.test(u)) throw new Error("Account name: 1-32 letters, digits, dots, dashes (a letter or digit first).");
    if (this.user(u)) throw new Error("That account name is taken.");
    if (!ROLES.includes(role)) throw new Error("No such role.");
    const user = { username: u, name: String(name || "").slice(0, 60), role, password: password ? hashPassword(password) : "", autoReply: defaultAutoReply(), autoLog: {}, created: Date.now() };
    this.data.users.push(user);
    this.save();
    return user;
  }
  setUser(username, patch) {
    const u = this.user(username);
    if (!u) return null;
    if (patch.name !== undefined) u.name = String(patch.name).slice(0, 60);
    if (patch.role !== undefined && ROLES.includes(patch.role)) u.role = patch.role;
    if (patch.password !== undefined) u.password = patch.password ? hashPassword(patch.password) : "";
    if (patch.autoReply !== undefined) u.autoReply = { ...defaultAutoReply(), ...u.autoReply, ...patch.autoReply };
    this.save();
    return u;
  }
  deleteUser(username, mailMode = "drop") {
    const u = this.user(username);
    if (!u) return null;
    if (mailMode === "reassign") for (const m of this.data.messages) if (m.owner === u.username) m.owner = "";
    else if (mailMode === "drop") this.data.messages = this.data.messages.filter((m) => m.owner !== u.username);
    this.data.users = this.data.users.filter((x) => x.username !== u.username);
    this.data.keys = this.data.keys.filter((k) => k.owner !== u.username);
    this.save();
    return u;
  }
  claimMail(owner) { for (const m of this.data.messages) if (m.owner === "") m.owner = owner; this.save(); }

  // ---- messages
  get(id) { return this.data.messages.find((m) => m.id === id) || null; }
  add(msg) { this.data.messages.unshift(msg); this.trim(); this.save(); return msg; }
  update(id, patch) {
    const m = this.get(id);
    if (!m) return null;
    Object.assign(m, patch);
    this.save();
    return m;
  }
  remove(id) {
    const n = this.data.messages.length;
    this.data.messages = this.data.messages.filter((m) => m.id !== id);
    this.save();
    return this.data.messages.length < n;
  }
  list(box, owner = null) { return this.data.messages.filter((m) => m.box === box && (owner == null || m.owner === owner)); }
  counts(owner = null) {
    const out = { inbox: 0, drafts: 0, sent: 0, trash: 0, unread: 0 };
    for (const m of this.data.messages) {
      if (owner != null && m.owner !== owner) continue;
      if (out[m.box] != null) out[m.box]++;
      if (m.box === "inbox" && !m.read) out.unread++;
    }
    return out;
  }
  trim() {
    // nothing is silently thrown away; just keep the file from growing forever
    if (this.data.messages.length > 20000) this.data.messages.length = 20000;
  }

  // ---- API keys (the key itself is shown once; only its hash is kept)
  addKey({ name, owner, scope }) {
    if (!this.user(owner)) throw new Error("No such account.");
    if (!["read", "send", "admin"].includes(scope)) throw new Error("No such scope.");
    const key = newApiKey();
    const rec = { id: "k" + randomBytes(6).toString("hex"), name: String(name || "").slice(0, 60), owner, scope, hash: keyHash(key), created: Date.now(), lastUsed: 0 };
    this.data.keys.push(rec);
    this.save();
    return { rec, key };
  }
  keyByHash(hash) { return this.data.keys.find((k) => k.hash === hash) || null; }
  touchKey(id) { const k = this.data.keys.find((x) => x.id === id); if (k) { k.lastUsed = Date.now(); this.save(); } }
  removeKey(id) { const n = this.data.keys.length; this.data.keys = this.data.keys.filter((k) => k.id !== id); this.save(); return this.data.keys.length < n; }

  // ---- auto-reply bookkeeping (one reply per sender per cooldown)
  shouldAutoReply(user, sender) {
    const a = user.autoReply || defaultAutoReply();
    if (!a.enabled || !a.text) return false;
    const s = String(sender || "").toLowerCase();
    const last = (user.autoLog || {})[s] || 0;
    return Date.now() - last >= Math.max(0, Number(a.cooldown) || 0) * 60e3;
  }
  markAutoReplied(user, sender) {
    user.autoLog = user.autoLog || {};
    user.autoLog[String(sender || "").toLowerCase()] = Date.now();
    for (const [s, t] of Object.entries(user.autoLog)) if (Date.now() - t > 7 * 86400e3) delete user.autoLog[s];
    this.save();
  }
}

// ------------------------------------------------------------------ access
// Passwords: scrypt with a per-account salt. Sessions: an HMAC-signed token in
// a cookie. API keys: shown once, kept as a SHA-256 hash.
export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(String(pw), salt, 64).toString("hex")}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, salt, hash] = String(stored || "").split("$");
    if (alg !== "scrypt" || !salt || !hash) return false;
    const want = Buffer.from(hash, "hex");
    const got = scryptSync(String(pw), Buffer.from(salt, "hex"), want.length);
    return want.length === got.length && timingSafeEqual(want, got);
  } catch { return false; }
}
export const newApiKey = () => "sm_" + randomBytes(24).toString("hex");
export const keyHash = (key) => createHash("sha256").update(String(key)).digest("hex");
export function signToken(obj, secret) {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verifyToken(token, secret) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const want = createHmac("sha256", secret).update(body).digest();
    const got = Buffer.from(sig, "base64url");
    if (got.length !== want.length || !timingSafeEqual(want, got)) return null;
    const obj = JSON.parse(Buffer.from(body, "base64url"));
    if (!obj.exp || obj.exp < Date.now()) return null;
    return obj;
  } catch { return null; }
}
// the public view of an account (never the hash, never the auto-reply log)
export const userView = (u) => u && ({ username: u.username, name: u.name, role: u.role, service: u.role === "service", autoReply: { ...defaultAutoReply(), ...u.autoReply }, created: u.created, messages: 0 }) || null;

export const newId = () => "m" + randomBytes(9).toString("hex");

export function snippet(text, n = 140) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, n);
}

// one e-mail address, or a comma-separated list of them
export function splitAddresses(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}
const ADDR_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
export const goodAddress = (a) => ADDR_RE.test(a);

// --------------------------------------------------------------------- reading mail
// Carried over from selfmail's server.js: read a raw MIME message into headers
// and a body, decode =?UTF-8?B?...?= words, and pick out the text and the html
// part, including multipart/alternative and base64 / quoted-printable bodies.
export function parseHeaders(raw) {
  raw = String(raw).split(String.fromCharCode(13, 10)).join(NL);
  const split = raw.indexOf(NL + NL);
  const head = (split === -1 ? raw : raw.slice(0, split)).replace(/\n[ \t]+/g, " ");
  const body = split === -1 ? "" : raw.slice(split + 2);
  const h = {};
  head.split(NL).forEach(function (line) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!h[k]) h[k] = line.slice(i + 1).trim();
    }
  });
  return { h, body };
}

export function decodeWords(s) {
  if (!s) return "";
  return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, function (_, cs, enc, txt) {
    try {
      if (enc.toUpperCase() === "B") return Buffer.from(txt, "base64").toString("utf8");
      return Buffer.from(txt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, function (m, hx) {
        return String.fromCharCode(parseInt(hx, 16));
      }), "binary").toString("utf8");
    } catch { return txt; }
  });
}

function decodeBody(body, cte) {
  if (cte === "base64") { try { return Buffer.from(body, "base64").toString("utf8"); } catch { return body; } }
  if (cte === "quoted-printable") {
    return body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, function (m, hx) {
      return String.fromCharCode(parseInt(hx, 16));
    });
  }
  return body;
}

export function textPartOf(raw) {
  raw = String(raw).split(String.fromCharCode(13, 10)).join(NL);
  const p = parseHeaders(raw);
  const ct = p.h["content-type"] || "";
  let body = decodeBody(p.body, (p.h["content-transfer-encoding"] || "").toLowerCase());
  const m = /boundary="?([^";\s]+)"?/i.exec(ct);
  if (m) {
    const parts = body.split("--" + m[1]);
    for (let i = 0; i < parts.length; i++) {
      if (/content-type:\s*text\/plain/i.test(parts[i])) return textPartOf(parts[i].replace(/^\r?\n/, ""));
    }
    for (let i = 0; i < parts.length; i++) {
      if (/content-type:\s*text\/html/i.test(parts[i])) return textPartOf(parts[i].replace(/^\r?\n/, ""));
    }
  }
  return body;
}

export function htmlPartOf(raw) {
  raw = String(raw).split(String.fromCharCode(13, 10)).join(NL);
  const p = parseHeaders(raw);
  const ct = p.h["content-type"] || "";
  const m = /boundary="?([^";\s]+)"?/i.exec(ct);
  if (m) {
    const parts = p.body.split("--" + m[1]);
    for (let i = 0; i < parts.length; i++) {
      if (/content-type:\s*text\/html/i.test(parts[i])) return htmlPartOf(parts[i].replace(/^\r?\n/, ""));
    }
    return "";
  }
  if (!/text\/html/i.test(ct)) return "";
  return decodeBody(p.body, (p.h["content-transfer-encoding"] || "").toLowerCase());
}

// a raw message (what a relay posts) -> one of our stored messages
export function messageFromRaw(raw, toAddress) {
  const p = parseHeaders(String(raw).slice(0, 2 * 1024 * 1024));
  const bodyRaw = String(raw);
  let text = "", html = "";
  try { text = textPartOf(bodyRaw).slice(0, MAX_BODY); } catch { /* unparseable */ }
  try { html = htmlPartOf(bodyRaw).slice(0, MAX_BODY); } catch { /* unparseable */ }
  const date = Date.parse(p.h.date || "") || Date.now();
  return {
    id: newId(), box: "inbox", read: false, inbound: true,
    from: decodeWords(p.h.from || "") || "unknown@unknown",
    to: decodeWords(p.h.to || "") || toAddress,
    cc: decodeWords(p.h.cc || ""),
    subject: decodeWords(p.h.subject || "(no subject)"),
    messageId: String(p.h["message-id"] || "").trim(),
    text, html, date,
    snippet: snippet(text || html.replace(/<[^>]+>/g, " ")),
  };
}

// a JSON body a relay could post instead of raw MIME (selfmail accepts both)
export function messageFromJson(o, toAddress) {
  const h = [];
  const addr = (v) => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(addr).join(", ");
    return v.text || v.address || (v.value ? addr(v.value) : "");
  };
  h.push("From: " + (addr(o.from) || "unknown@unknown"));
  h.push("To: " + (addr(o.to) || toAddress));
  if (o.cc) h.push("Cc: " + addr(o.cc));
  if (o.subject) h.push("Subject: " + o.subject);
  h.push("Date: " + (o.date || new Date().toUTCString()));
  const isHtml = !o.text && o.html;
  h.push("Content-Type: text/" + (isHtml ? "html" : "plain") + "; charset=utf-8");
  return messageFromRaw(h.join(NL) + NL + NL + (o.text || o.html || ""), toAddress);
}

// --------------------------------------------------------------------- writing mail
function quotedPrintable(str) {
  // ASCII stays readable; everything else (and long lines) is escaped. A line
  // starting with a dot is left alone: the SMTP layer dot-stuffs it on the wire.
  const bytes = Buffer.from(String(str || ""), "utf8");
  let out = "", line = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    const safe = (b >= 32 && b <= 126 && c !== "=") || c === "\n" || c === "\t";
    const piece = safe ? c : "=" + b.toString(16).toUpperCase().padStart(2, "0");
    if (c === "\n") { out += line + NL; line = ""; continue; }
    if (line.length + piece.length >= 75) { out += line + "=" + NL; line = ""; }
    line += piece;
  }
  return out + line;
}

function encodedWord(str) {
  return /[^\x00-\x7f]/.test(str) ? `=?UTF-8?B?${Buffer.from(str, "utf8").toString("base64")}?=` : str;
}

export function buildMime({ from, fromName, to, cc, subject, text, html, domain, inReplyTo, headers: extra = [] }) {
  const headers = [];
  headers.push(`From: ${fromName ? encodedWord(fromName) + " " : ""}<${from}>`);
  headers.push(`To: ${to.join(", ")}`);
  if (cc.length) headers.push(`Cc: ${cc.join(", ")}`);
  headers.push(`Subject: ${encodedWord(String(subject || ""))}`);
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push(`Message-ID: <${randomBytes(12).toString("hex")}@${domain || "selfmail.local"}>`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  headers.push("MIME-Version: 1.0");
  headers.push(...extra);                  // e.g. Auto-Submitted: auto-replied
  let body;
  if (html) {
    const b = "=_selfmail_" + randomBytes(6).toString("hex");
    headers.push(`Content-Type: multipart/alternative; boundary="${b}"`);
    body = [
      "This is a multipart message in MIME format.",
      `--${b}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      quotedPrintable(text || ""),
      `--${b}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(String(html), "utf8").toString("base64").replace(/(.{76})/g, "$1" + NL),
      `--${b}--`,
      "",
    ].join(NL);
  } else {
    headers.push("Content-Type: text/plain; charset=utf-8");
    headers.push("Content-Transfer-Encoding: quoted-printable");
    body = quotedPrintable(text || "") + NL;
  }
  return headers.join(NL) + NL + NL + body;
}

// --------------------------------------------------------------------- sending
// Like selfmail: the app itself never connects to the internet to deliver
// mail. Each message is handed to the machine's own mail agent — the sendmail
// binary first (postdrop → pickup → cleanup: no port involved at all, and it
// still works while smtpd is stalled, as selfmail's README notes), then the
// MTA listening on loopback, which selfmail's app talks to the same way. The
// agent makes the outbound connection; when there is no agent, the failure is
// reported as it happened, never papered over.
const CRLF = "\r\n";
const smtpRead = (sock, timeoutMs) => new Promise((ok, no) => {
  let buf = "", done = false;
  const onData = (d) => {
    buf += d.toString("utf8");
    const lines = buf.split(CRLF);
    // a reply is done when a line ends with "NNN " (not "NNN-", which continues)
    if (lines.length > 1 && /^\d{3} /.test(lines[lines.length - 2] || "")) finish({ lines: lines.slice(0, -1) });
  };
  const onErr = (e) => { if (!done) { done = true; cleanup(); no(e); } };
  const onClose = () => { if (!done) { done = true; cleanup(); ok({ lines: buf.split(CRLF) }); } };
  const timer = setTimeout(() => { if (!done) { done = true; cleanup(); ok({ timeout: true, lines: [buf] }); } }, timeoutMs);
  function cleanup() { clearTimeout(timer); sock.off("data", onData); sock.off("error", onErr); sock.off("close", onClose); }
  function finish(r) { done = true; cleanup(); ok(r); }
  sock.on("data", onData);
  sock.on("error", onErr);
  sock.on("close", onClose);
});
const code = (r) => (r.lines && r.lines.length ? Number(r.lines[r.lines.length - 1].slice(0, 3)) : 0);
const text = (r) => (r.lines || []).filter(Boolean).join(" / ").slice(0, 400);

// the sendmail binary, exactly where selfmail looks for it
const SENDMAIL_CANDIDATES = ["/usr/sbin/sendmail", "/usr/lib/sendmail", "/usr/bin/sendmail"];
export function findSendmail(candidates = SENDMAIL_CANDIDATES) {
  for (const p of candidates) {
    try { accessSync(p, fsConstants.X_OK); return p; } catch { /* next */ }
  }
  return "";
}

// Hand the whole message (its headers carry To and Cc) to the sendmail binary.
// -t reads the recipients from the headers, -i keeps a lone dot from ending
// the message early; newlines are unix, the way a local agent expects.
function sendViaSendmail(message, bin) {
  return new Promise((ok) => {
    let child;
    try { child = spawn(bin, ["-i", "-t"], { stdio: ["pipe", "ignore", "pipe"] }); }
    catch (e) { return ok({ ok: false, stage: "sendmail", error: `could not run ${bin}: ${e.message}` }); }
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString("utf8"); });
    child.on("error", (e) => ok({ ok: false, stage: "sendmail", error: `could not run ${bin}: ${e.code || e.message}` }));
    child.on("close", (c, signal) => {
      const diag = err.trim().split("\n").filter(Boolean).slice(-2).join(" / ").slice(0, 300);
      if (c === 0) return ok({ ok: true, via: "sendmail", agent: bin, response: `handed to ${bin} (exit 0)` });
      ok({ ok: false, stage: "sendmail", agent: bin, error: diag || `${bin} exited ${signal || c}` });
    });
    child.stdin.on("error", () => {});          // a closed pipe reports through the exit code
    child.stdin.end(message.replace(/\r\n/g, "\n"), "utf8");
  });
}

// Speak SMTP to the machine's own agent on loopback — the same hop selfmail's
// app makes to Postfix. STARTTLS when it is offered; only ever loopback.
async function smtpTalk({ host, port, from, to, message, helo, timeout }) {
  const out = { ok: false, agent: `${host}:${port}` };
  let sock = tcpConnect({ host, port });
  sock.setNoDelay(true);
  let completed = false;
  try {
    const waitConnect = () => new Promise((ok, no) => { sock.once("connect", ok); sock.once("error", no); });
    await waitConnect();

    const say = (line) => sock.write(line + CRLF, "utf8");
    let r = await smtpRead(sock, timeout);
    if (code(r) !== 220) return { ...out, stage: "greeting", code: code(r), error: text(r) };

    say(`EHLO ${helo}`);
    r = await smtpRead(sock, timeout);
    if (code(r) !== 250) {
      say(`HELO ${helo}`);
      r = await smtpRead(sock, timeout);
      if (code(r) !== 250) return { ...out, stage: "helo", code: code(r), error: text(r) };
    }
    const caps = (r.lines || []).join(CRLF).toLowerCase();
    if (caps.includes("starttls")) {
      say("STARTTLS");
      r = await smtpRead(sock, timeout);
      if (code(r) === 220) {
        sock = tlsConnect({ socket: sock, servername: host, rejectUnauthorized: false });
        sock.setNoDelay(true);
        await new Promise((ok, no) => { sock.once("secureConnect", ok); sock.once("error", no); });
        say(`EHLO ${helo}`);
        r = await smtpRead(sock, timeout);
        if (code(r) !== 250) return { ...out, stage: "tls", code: code(r), error: text(r) };
      }
    }
    say(`MAIL FROM:<${from}>`);
    r = await smtpRead(sock, timeout);
    if (code(r) !== 250) return { ...out, stage: "from", code: code(r), error: text(r) };
    for (const rcpt of to) {
      say(`RCPT TO:<${rcpt}>`);
      r = await smtpRead(sock, timeout);
      if (code(r) !== 250 && code(r) !== 251) return { ...out, stage: "rcpt", rcpt, code: code(r), error: text(r) };
    }
    say("DATA");
    r = await smtpRead(sock, timeout);
    if (code(r) !== 354) return { ...out, stage: "data", code: code(r), error: text(r) };
    // CRLF line endings and dot-stuffing, then the end of data
    sock.write(message.replace(/\r?\n/g, CRLF).replace(/(^|\r\n)\./g, "$1..") + CRLF + "." + CRLF, "utf8");
    r = await smtpRead(sock, 30000);
    if (code(r) !== 250) return { ...out, stage: "body", code: code(r), error: text(r) };
    say("QUIT");
    completed = true;
    try { sock.end(); } catch { /* gone */ }
    return { ...out, ok: true, via: "smtp", response: text(r) };
  } finally {
    // never leave a socket behind on a path that didn't finish politely
    if (!completed) { try { sock.destroy(); } catch { /* already gone */ } }
  }
}

// Send one message through the machine's own mail agent, as selfmail does:
// the sendmail binary first (no port at all), then SMTP on loopback. The
// agent makes the outbound connection — this app never does.
export async function sendViaLocalMta({ from, to, message, helo, host = "127.0.0.1", port = 25, timeout = 15000 }) {
  const failures = [];
  const bin = findSendmail();
  if (bin) {
    const r = await sendViaSendmail(message, bin);
    if (r.ok) return r;
    failures.push(r);
  }
  try {
    const r = await smtpTalk({ host, port, from, to, message, helo, timeout });
    if (r.ok) return r;
    failures.push(r);
    // a 5xx from the agent is a real answer for this recipient; no need to try more
    if (/^5/.test(String(r.code))) return r;
  } catch (e) {
    failures.push({ ok: false, stage: "connect", agent: `${host}:${port}`, error: `${e.code || e.message}` });
  }
  if (failures.length) {
    // nothing there at all: say it plainly, with the reason underneath
    if (!bin && failures.every((f) => f.stage === "connect")) {
      return { ok: false, stage: "local", error: `No local mail agent: no sendmail binary, and nothing is listening on ${host}:${port} (${failures.map((f) => f.error).join(", ")}). Install Postfix (or any sendmail) and Selfmail hands mail to it, as selfmail does — the app itself never connects out to deliver.` };
    }
    // the last, most specific failure is the honest one to report
    const last = failures[failures.length - 1];
    return { ...last, tried: failures.map((f) => f.agent || f.stage) };
  }
  return { ok: false, stage: "local", error: "No local mail agent: no sendmail binary and nothing listening on 127.0.0.1:25. Install Postfix (or any sendmail) and Selfmail hands mail to it, as selfmail does — the app itself never connects out to deliver." };
}

// Is there a local mail agent at all? The one question to ask before wondering
// why nothing arrives. Distinguishes the sendmail binary from a loopback MTA,
// and reads the agent's greeting, like selfmail's Status tab does.
export function mtaCheck({ host = "127.0.0.1", port = 25, timeout = 6000 } = {}) {
  return new Promise((ok) => {
    const sendmail = findSendmail();
    const s = tcpConnect({ host, port });
    const done = (smtp) => { try { s.destroy(); } catch { /* */ } ok({ sendmail: sendmail || null, smtp: smtp || null, ok: !!(sendmail || smtp) }); };
    let buf = "";
    s.setTimeout(timeout, () => done(buf.trim().split("\n")[0] || null));
    s.once("connect", () => { /* the greeting decides, not the connect */ });
    s.once("data", (d) => { buf += d.toString("utf8"); if (/^220/.test(buf)) done(buf.split(CRLF)[0].trim()); });
    s.once("error", () => done(null));
    s.once("close", () => done(buf.trim() ? buf.trim().split("\n")[0] : null));
  });
}

// --------------------------------------------------------------------- the records
// Relay mode, as in selfmail: a free relay owns port 25 for your domain and
// POSTs each message to your public HTTPS address — the one Burrow publishes.
// The list is ready the moment the extension is installed: the default relay
// domains are already in it, and nothing has to be typed.
export function dnsRecords({ domain, webhookUrl, publicIp, mailbox }) {
  if (!domain) return [];
  const recs = [
    { key: "mx1", type: "MX", name: domain, content: "mx1.forwardemail.net", priority: 10,
      note: "The default relay domain: it takes delivery on port 25 for you and forwards to your inbound address." },
    { key: "mx2", type: "MX", name: domain, content: "mx2.forwardemail.net", priority: 20,
      note: "The relay's backup domain." },
    { key: "hook", type: "TXT", name: domain,
      content: "forward-email=" + (webhookUrl || "https://YOUR-INBOUND-ADDRESS/inbound/SECRET"),
      note: "Tells the relay where to deliver; it fills itself in once the inbound address is published. A separate TXT record from SPF: do not merge them." },
    { key: "spf", type: "TXT", name: domain,
      content: "v=spf1 ip4:" + (publicIp || "YOUR-PUBLIC-IP") + " -all",
      note: "Authorises this machine's mail agent to send as @" + domain + ". Sending goes through it, not through the relay." },
    { key: "dmarc", type: "TXT", name: "_dmarc." + domain, content: "v=DMARC1; p=none",
      note: "Reports only; tighten it once your mail arrives where it should." },
  ];
  return recs;
}

// Straight to public resolvers, not the system one: a local stub caches the
// "no such record" answer long after you have added it (as in selfmail).
const pubdns = new dns.Resolver({ timeout: 4000, tries: 1 });
try { pubdns.setServers(["1.1.1.1", "8.8.8.8", "9.9.9.9"]); } catch { /* fall back */ }

export async function checkDns(records) {
  const out = [];
  for (const r of records) {
    const row = { key: r.key, type: r.type, name: r.name, expected: r.content, ok: false, found: "", detail: "" };
    try {
      if (r.type === "MX") {
        const v = await pubdns.resolveMx(r.name);
        row.found = v.map((x) => x.priority + " " + x.exchange).join(", ");
        row.ok = v.some((x) => x.exchange.replace(/\.$/, "").toLowerCase() === r.content.toLowerCase());
        if (!row.ok && v.length) row.detail = "MX answers for this name, but not this host.";
      } else {
        const v = await pubdns.resolveTxt(r.name);
        const joined = v.map((x) => x.join(""));
        row.found = joined.join(" | ");
        if (r.key === "spf") {
          row.ok = joined.some((x) => x.trim() === r.content);
          if (!row.ok && joined.some((x) => x.indexOf("v=spf1") === 0)) row.detail = "An SPF record exists but does not match exactly.";
        } else if (r.key === "hook") {
          row.ok = joined.some((x) => x.trim() === r.content);
          if (!row.ok && joined.some((x) => x.trim().indexOf("forward-email=") === 0)) row.detail = "A forward-email record exists but points elsewhere — the inbound address may have changed since it was added. Paste the value in the Value column over it.";
        } else if (r.key === "dmarc") {
          row.ok = joined.some((x) => x.indexOf("v=DMARC1") === 0);
        }
      }
    } catch (e) {
      if (e.code === "ENOTFOUND" || e.code === "ENODATA") row.detail = "No such record found yet — one just added takes a few minutes to spread; try again shortly.";
      else if (e.code === "ETIMEOUT" || e.code === "ESERVFAIL" || e.code === "ECONNREFUSED" || e.code === "EAI_AGAIN") row.detail = `Could not ask (${e.code}): this network may block direct DNS to 1.1.1.1/8.8.8.8 — the check needs it, the mail does not.`;
      else row.detail = String(e.code || e.message);
    }
    out.push(row);
  }
  return out;
}

// --------------------------------------------------------------------- public IP
let ipCache = { at: 0, ip: "" };
export async function publicIp() {
  if (ipCache.ip && Date.now() - ipCache.at < 30 * 60 * 1000) return ipCache.ip;
  for (const u of ["https://api.ipify.org", "https://icanhazip.com"]) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "selfmail/1 (a Weft addon)" } });
      if (r.ok) {
        const ip = (await r.text()).trim();
        if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) { ipCache = { at: Date.now(), ip }; return ip; }
      }
    } catch { /* try the next */ }
  }
  return "";
}

export { resolvePath };
