"""weft/mesh.py: the Weft Architecture's shared helpers for addon apps.

Every example vendors an identical copy at <addon>/weft/mesh.py (an addon may
not reach outside its own folder); tools/weft-check.mjs keeps them identical
to tools/mesh.py. Standard library only.

The Weft mesh is a folder (~/.config/weft/mesh, or $MESH) with one JSON file
per running addon, written by the addon itself and refreshed every 30 s:

    {"spec": 1, "id": "beacon", "name": "Weft Beacon", "version": "1.0.0",
     "host": "burrow", "url": "http://127.0.0.1:8792/", "health": ".../health",
     "port": 8792, "provides": ["beacon"], "items": [], "routes": {},
     "updated": 1760000000}

An entry older than 90 s is stale: its addon stopped without saying so.
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SPEC = 1
STALE_AFTER = 90


def load_config(path):
    with open(path) as fh:
        return json.load(fh)


def mesh_dir(cfg=None):
    d = os.environ.get("MESH") or (cfg or {}).get("mesh") or os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config"), "weft", "mesh")
    os.makedirs(d, exist_ok=True)
    return d


def _host_for_url(bind):
    return "127.0.0.1" if bind in ("0.0.0.0", "::", "", None) else ("[%s]" % bind if ":" in bind else bind)


def base_url(cfg):
    return "http://%s:%d/" % (_host_for_url(cfg.get("bind")), int(cfg.get("port") or 0))


def write_json(path, obj):
    tmp = "%s.tmp.%d" % (path, os.getpid())
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def announce(cfg, name, provides, **extra):
    """Put (or refresh) this addon's entry on the mesh."""
    entry = {"spec": SPEC, "id": cfg["id"], "name": name, "version": cfg.get("version", ""),
             "host": cfg.get("host", ""), "provides": list(provides), "items": [], "routes": {},
             "updated": int(time.time())}
    if cfg.get("port"):
        entry.update(url=base_url(cfg), health=base_url(cfg) + "health", port=int(cfg["port"]))
    entry.update(extra)
    write_json(os.path.join(mesh_dir(cfg), cfg["id"] + ".json"), entry)
    return entry


def withdraw(cfg):
    try:
        os.remove(os.path.join(mesh_dir(cfg), cfg["id"] + ".json"))
    except OSError:
        pass


def peers(cfg=None, include_stale=False):
    """Every entry on the mesh, newest first, each with "stale": bool."""
    out, d, now = [], mesh_dir(cfg), time.time()
    for n in sorted(os.listdir(d)):
        if not n.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, n)) as fh:
                e = json.load(fh)
        except (OSError, ValueError):
            continue
        if not isinstance(e, dict) or e.get("spec") != SPEC or n != "%s.json" % e.get("id"):
            continue
        e["stale"] = now - float(e.get("updated") or 0) > STALE_AFTER
        if include_stale or not e["stale"]:
            out.append(e)
    return sorted(out, key=lambda e: -float(e.get("updated") or 0))


def heartbeat(fn, every=30):
    """Run fn() now and every `every` seconds, in the background."""
    def loop():
        while True:
            try:
                fn()
            except Exception as ex:      # never let a heartbeat kill the app
                print("heartbeat:", ex, flush=True)
            time.sleep(every)
    threading.Thread(target=loop, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    """A small JSON/HTML handler: subclass and fill ROUTES = {path: method name}."""
    ROUTES = {}
    cfg = {}

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body, indent=1) if ctype == "application/json" else body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/health":
            return self.send(200, {"app": self.cfg["id"], "ok": True, "version": self.cfg.get("version", "")})
        name = self.ROUTES.get(path)
        if not name:
            return self.send(404, {"error": "not found"})
        return getattr(self, name)()


def serve(cfg, handler):
    """Serve until stopped; on SIGTERM/SIGINT, leave the mesh first."""
    import signal
    import sys

    def bye(*_):
        withdraw(cfg)
        sys.exit(0)
    signal.signal(signal.SIGTERM, bye)
    signal.signal(signal.SIGINT, bye)
    handler.cfg = cfg
    bind = cfg.get("bind") or "127.0.0.1"
    srv = ThreadingHTTPServer((bind if bind not in ("::",) else "::", int(cfg["port"])), handler)
    print("%s %s on %s" % (cfg["id"], cfg.get("version", ""), base_url(cfg)), flush=True)
    srv.serve_forever()


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


CSS = """
:root{color-scheme:dark;--bg:#07080a;--card:#101216;--line:rgba(255,255,255,.08);--text:#eceef0;--muted:#8a8f97;--faint:#5a5f67;
--acc:#c9b8ff;--ok:#3ddc97;--warn:#f2c14e;--err:#ff6b6b;--mono:ui-monospace,'JetBrains Mono',Menlo,monospace}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){color-scheme:light;--bg:#f6f6f4;--card:#fff;--line:rgba(0,0,0,.09);--text:#16181c;--muted:#5d626b;--faint:#8b9097;--acc:#6a4bd6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,-apple-system,'Segoe UI',sans-serif}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:
repeating-linear-gradient(90deg,transparent 0 46px,rgba(201,184,255,.035) 46px 48px),repeating-linear-gradient(0deg,transparent 0 46px,rgba(255,255,255,.025) 46px 48px)}
main{position:relative;max-width:920px;margin:0 auto;padding:48px 16px 64px}
h1{margin:0;font-size:30px;letter-spacing:-.03em}h2{font-size:15px;margin:28px 0 10px;color:var(--muted);font-weight:600}
.sub{color:var(--muted);margin:6px 0 0}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:1px 9px;border-radius:99px;border:1px solid var(--line);font:11.5px var(--mono);color:var(--muted)}
.pill.ok{color:var(--ok);border-color:rgba(61,220,151,.35)}.pill.err{color:var(--err);border-color:rgba(255,107,107,.35)}.pill.warn{color:var(--warn);border-color:rgba(242,193,78,.35)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--faint);display:inline-block}.dot.ok{background:var(--ok);box-shadow:0 0 10px var(--ok)}.dot.err{background:var(--err)}
a{color:var(--acc)}.mono{font-family:var(--mono);font-size:12.5px}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}.brand svg{width:44px;height:44px}
footer{margin-top:40px;color:var(--faint);font-size:12.5px}
"""

MARK = ('<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="13" fill="#15121f"/>'
        '<path d="M10 16h28M10 24h28M10 32h28" stroke="#c9b8ff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>'
        '<path d="M17 10v28M24 10v28M31 10v28" stroke="#c9b8ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 4"/></svg>')


def page(cfg, title, subtitle, body, refresh=0):
    """A whole HTML page in the Weft look (dark and light)."""
    meta = '<meta http-equiv="refresh" content="%d">' % refresh if refresh else ""
    return ("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "%s<title>%s</title><style>%s</style></head><body><main><div class=brand>%s<div><h1>%s</h1><p class=sub>%s</p></div></div>%s"
            "<footer>%s %s · on %s · powered by the <a href='https://github.com/alexd-aero/weft'>Weft Architecture</a> · "
            "runs on <a href='https://github.com/adatskov-wcpss/animated-fiesta'>Selkies Forge</a> and "
            "<a href='https://github.com/alexd-aero/aegis-burrow'>Aegis × Burrow</a></footer></main></body></html>"
            % (meta, esc(title), CSS, MARK, esc(title), esc(subtitle), body, esc(cfg["id"]), esc(cfg.get("version", "")),
               esc({"burrow": "Aegis × Burrow", "selkies-forge": "Selkies Forge"}.get(cfg.get("host"), cfg.get("host") or "?"))))
