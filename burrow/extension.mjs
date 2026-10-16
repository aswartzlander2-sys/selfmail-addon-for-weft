// Selfmail inside Aegis × Burrow: the extension the host loads
// (forge-addon.json "burrow": {"extension"}), with its page mounted under the
// dashboard's login and its card on the Burrow page ("ui").
//
//   mount()      the mail app, under the dashboard's login at
//                /__gate/selfmail/ (like Bulwark), with a tile on the home page
//   handle()     /__gate/api/x/selfmail/state  (the card and the page's host
//                info) and /dns (the linked zone's records, read-only)
//   start(ctx)   publishes the inbound address: a public HTTPS tunnel a mail
//                relay POSTs your incoming mail to, on a name of your linked
//                domain. Everything it decides goes into data/state.json, which
//                the app reads; the app's own state stays in data/store.json.
//
// Nothing here removes anything on stop(): Burrow reloads extensions on every
// addon update, and the tunnel must survive that. The uninstall script pauses
// or removes the tunnel over the control socket, like Burrow Pages does.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let ctx = null, timer = null, stopped = true;
const ID = "selfmail";
const TUNNEL_BASE = 47800;                 // where our tunnel ports live (Burrow Pages takes 47600+)

const fail = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
const dataFile = (name) => join(ctx.dataDir, name);
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

// data/config.json is written by the install script (weft/lib.sh conf_write):
// port, bind, the settings, the version. data/store.json is the app's own.
function conf() {
  const c = readJson(dataFile("config.json"), null);
  if (!c) return null;
  return {
    port: Number(c.port) || 0,
    bind: String(c.bind || "127.0.0.1"),
    version: String(c.version || ""),
    mailbox: String(c.mailbox || "me"),
    mailDomain: String(c.mail_domain || "").trim(),
    sub: String(c.subdomain || "mail").trim().toLowerCase() || "mail",
    webhookWanted: String(c.webhook ?? "1") !== "0" && c.webhook !== false,
  };
}
function upstream(c) {
  const host = ["0.0.0.0", "::", ""].includes(c.bind) ? "127.0.0.1" : c.bind.includes(":") ? `[${c.bind}]` : c.bind;
  return `http://${host}:${c.port}`;
}
function secret() {
  const raw = readJson(dataFile("config.json"), {});
  const set = String(raw.inbound_secret || "").trim();
  if (set) return set;
  return String(readJson(dataFile("store.json"), {}).secret || "");
}

// ------------------------------------------------------------------ state.json
// What the extension knows, for the app's pages to read. The extension is the
// only writer; mode 600, written whole and atomically.
function state() { return readJson(dataFile("state.json"), {}); }
function saveState(patch) {
  const next = { ...state(), ...patch, at: Date.now() };
  const tmp = `${dataFile("state.json")}.${process.pid}.tmp`;
  mkdirSync(ctx.dataDir, { recursive: true });
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, dataFile("state.json"));
  return next;
}

// ------------------------------------------------------------------ the inbound address
const ownTunnel = () => ctx.tunnels.list().find((t) => t.app === ID) || null;

// ------------------------------------------------------------------ the domains
// Every domain this machine has: the main one and the "more domains" the
// dashboard links, read off the control socket's /overview (the same answer
// `aegis status` and the home screen get). Saved into state.json for the app,
// which serves mail for all of them unless an admin switches one off.
import { request as httpRequest } from "node:http";

export function controlDomains(sockPath) {
  return new Promise((ok) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; ok(v); } };
    try {
      const req = httpRequest({ socketPath: sockPath, path: "/overview", method: "GET", timeout: 4000 }, (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; });
        res.on("end", () => {
          try {
            const o = JSON.parse(buf);
            const zones = [];
            for (const z of [o.domain?.zone, ...(Array.isArray(o.domains) ? o.domains : []).map((d) => d?.zone)]) {
              const s = String(z || "").trim().toLowerCase();
              if (s && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s) && !zones.includes(s)) zones.push(s);
            }
            finish(zones);
          } catch { finish(null); }
        });
      });
      req.on("timeout", () => { req.destroy(); finish(null); });
      req.on("error", () => finish(null));
      req.end();
    } catch { finish(null); }
  });
}
async function publish() {
  const c = conf();
  const d = ctx.domain();
  const base = { zone: d?.zone || "", mainHost: d?.mainHost || "", tunnel: null };
  if (!c) return;                                   // not installed properly; the mount says so too
  if (!c.webhookWanted) {
    const mine = ownTunnel();
    if (mine) { await ctx.tunnels.remove(mine.port).catch((e) => ctx.log("its tunnel:", e.message)); }
    saveState({ ...base, removed: false, note: "The inbound address is switched off (the Publish the inbound address setting)." });
    return;
  }
  if (!d) {
    saveState({ ...base, note: "No domain is linked yet: the inbound address would be a random one that changes. Link one under Settings → Domain and it becomes mail.your-domain." });
    return;
  }
  let mine = ownTunnel();
  if (!mine) {
    // if we had one and it is gone, that was you deleting it: leave it be
    if (state().removed) { saveState({ ...base, note: "Its address was removed from Burrow; reinstall Selfmail to publish one again." }); return; }
    const used = new Set(ctx.tunnels.list().map((t) => t.port));
    let port = 0;
    if (!used.has(c.port)) port = c.port;
    else for (let p = TUNNEL_BASE; p < TUNNEL_BASE + 400 && !port; p++) if (!used.has(p)) port = p;
    try {
      mine = await ctx.tunnels.create({
        port, targetHost: ["0.0.0.0", "::", ""].includes(c.bind) ? "127.0.0.1" : c.bind, targetPort: c.port,
        scheme: "http", name: "Selfmail inbound", sub: c.sub, access: "public",
        meta: { mode: "webhook", note: "Where a mail relay POSTs incoming mail" },
      });
      ctx.log(`inbound address published at ${mine.url || mine.sub || "its name"}`);
    } catch (e) {
      saveState({ ...base, error: `Couldn't publish the inbound address: ${e.message}` });
      return;
    }
  }
  saveState({
    ...base,
    tunnel: mine ? { port: mine.port, url: mine.url || "", sub: mine.sub || "", enabled: mine.enabled !== false } : null,
    error: null,
  });
}

async function tick() {
  try { await publish(); } catch (e) { ctx.log("publish:", e.message); }
  // the machine's domains, so the app can serve mail on all of them
  try {
    const sock = readJson(dataFile("config.json"), {}).burrow_socket;
    if (sock) {
      const zones = await controlDomains(sock);
      if (zones && JSON.stringify(zones) !== JSON.stringify(state().domains ?? null)) saveState({ domains: zones });
    }
  } catch { /* no socket: state.json keeps what it had */ }
  // notice our tunnel being deleted, so we don't bring it straight back
  const st = state();
  if (st.tunnel && !ownTunnel()) saveState({ removed: true, tunnel: null });
}

// ------------------------------------------------------------------ the host's hooks
export async function start(c) {
  ctx = c;
  stopped = false;
  await tick();
  timer = setInterval(() => { if (!stopped) tick(); }, 60 * 1000);
  timer.unref?.();
  ctx.log("running inside Burrow: the page is at /__gate/selfmail/");
}

export function stop() {
  stopped = true;
  clearInterval(timer);
}

// the mail app, under the dashboard's login (a "separate page", like Bulwark)
export function mount() {
  const c = conf();
  if (!c || !c.port) return null;
  return {
    prefix: "/__gate/selfmail",
    upstream: upstream(c),
    name: "Selfmail",
    tile: { text: "Accounts on your domain: sign in to write, send and read." },
  };
}

// /__gate/api/x/selfmail/… (signed in) and /x/selfmail/… (control socket):
// what the Burrow page's card and the app's host-info need.
export async function handle({ method, path }) {
  if (method !== "GET") return null;
  if (path === "/state") {
    const c = conf();
    const st = state();
    const d = ctx.domain();
    let app = null;
    if (c?.port) {
      try {
        const r = await fetch(`http://127.0.0.1:${c.port}/api/state`, { signal: AbortSignal.timeout(4000) });
        if (r.ok) app = await r.json();
      } catch { /* the app is down; the card says so */ }
    }
    const mine = ownTunnel();
    return {
      status: 200,
      json: {
        app: ID, version: c?.version || "", running: !!app,
        mailbox: app?.mailbox || c?.mailbox || "me",
        address: app?.address || (c ? (c.mailDomain || d?.zone ? `${c.mailbox}@${c.mailDomain || d.zone}` : "") : ""),
        accounts: app?.accounts ?? null,
        domain: d ? { zone: d.zone, mainHost: d.mainHost } : null,
        tunnel: mine ? { port: mine.port, url: mine.url || "", sub: mine.sub || "", enabled: mine.enabled !== false } : null,
        note: st.note || null, error: st.error || null,
        counts: app?.counts || null, inbound: app?.inbound || "",
      },
    };
  }
  if (path === "/dns") {
    const d = ctx.domain();
    let records = [], error = null;
    try { records = await ctx.dns(); } catch (e) { error = e.message; }
    return { status: 200, json: { domain: d ? { zone: d.zone, mainHost: d.mainHost } : null, records, error } };
  }
  return null;
}
