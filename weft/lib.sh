# weft/lib.sh: the Weft Architecture's shared helpers for addon scripts.
# Sourced by the scripts, never run. Every example vendors an identical copy at
# <addon>/weft/lib.sh (an addon may not reach outside its own folder), and
# tools/weft-check.mjs keeps the copies identical to tools/lib.sh.
#
# What it gives a script:
#   DATA DIR CONF LOG UNIT MESH           where things live
#   conf KEY / conf_write                 data/config.json (port, bind, settings)
#   service_install|start|stop|remove     a systemd user service, or a pid file
#   healthy / wait_up / url               is it answering, and where
#   mesh_withdraw                         take this addon off the Weft mesh
#   status_line STATE DETAIL              the one JSON line a status script prints
#
# It reads the universal names every Weft host sets (ADDON_*), and falls back
# to the older FORGE_ADDON_* names so it also runs under Selkies Forge < 1.10.8.

ADDON_ID="${ADDON_ID:-${FORGE_ADDON_ID:-}}"
ADDON_DIR="${ADDON_DIR:-${FORGE_ADDON_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
ADDON_DATA="${ADDON_DATA:-${FORGE_ADDON_DATA:-}}"
ADDON_VERSION="${ADDON_VERSION:-${FORGE_ADDON_VERSION:-}}"
ADDON_HOST="${ADDON_HOST:-selkies-forge}"
ADDON_BIND="${ADDON_BIND:-${FORGE_BIND:-127.0.0.1}}"
export ADDON_ID ADDON_DIR ADDON_DATA ADDON_VERSION ADDON_HOST ADDON_BIND
: "${ADDON_ID:?run me from a Weft host (Selkies Forge or Aegis × Burrow): ADDON_ID is not set}"
: "${ADDON_DATA:?run me from a Weft host: ADDON_DATA is not set}"

setting() {  # setting KEY [DEFAULT]: ADDON_SETTING_KEY, or FORGE_ADDON_SETTING_KEY, or DEFAULT
  local a="ADDON_SETTING_$1" b="FORGE_ADDON_SETTING_$1"
  printf '%s' "${!a:-${!b:-${2:-}}}"
}

DATA="$ADDON_DATA"
DIR="$ADDON_DIR"
CONF="$DATA/config.json"
LOG="$DATA/$ADDON_ID.log"
PIDF="$DATA/$ADDON_ID.pid"
# One unit per install: two hosts on one machine (or a test copy) never share one.
UNIT="weft-$ADDON_ID-$(printf '%s' "$DATA" | cksum | cut -d' ' -f1).service"
# The Weft mesh: one JSON file per running addon (see SPEC.md, "The mesh").
MESH="${WEFT_MESH:-${XDG_CONFIG_HOME:-$HOME/.config}/weft/mesh}"

# A host running as a system service (Aegis × Burrow can) has no session
# variables; find the user's own systemd anyway.
if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then export XDG_RUNTIME_DIR="/run/user/$(id -u)"; fi
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "${XDG_RUNTIME_DIR:-/nonexistent}/bus" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
fi
has_systemd() { [ "${WEFT_NO_SYSTEMD:-0}" != 1 ] && command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; }
# Where the user's systemd reads units: its own config folder, which is not
# always this script's (a host may run with another HOME or XDG_CONFIG_HOME).
unit_dir() {
  local env xdg home
  env="$(systemctl --user show-environment 2>/dev/null)"
  xdg="$(printf '%s\n' "$env" | sed -n 's/^XDG_CONFIG_HOME=//p')"
  home="$(printf '%s\n' "$env" | sed -n 's/^HOME=//p')"
  echo "${xdg:-${home:-$HOME}/.config}/systemd/user"
}
UNIT_FILE="$(has_systemd && unit_dir || echo "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user")/$UNIT"

conf() {  # conf KEY: a value from config.json
  python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2], ""); print(json.dumps(v) if isinstance(v,(dict,list)) else v)' "$CONF" "$1" 2>/dev/null
}

# config.json for the app: port and bind, every setting (lowercased keys), and
# what the app needs to know about its host. Keeps keys the app added itself.
conf_write() {  # conf_write DEFAULT_PORT
  mkdir -p "$DATA"
  WEFT_DEFAULT_PORT="${1:-0}" python3 - "$CONF" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    cfg = json.load(open(path))
except Exception:
    cfg = {}
env = os.environ
# every setting, newest names first: ADDON_SETTING_X wins over FORGE_ADDON_SETTING_X
for prefix in ("FORGE_ADDON_SETTING_", "ADDON_SETTING_"):
    for k, v in env.items():
        if k.startswith(prefix):
            cfg[k[len(prefix):].lower()] = v
try:
    cfg["port"] = int(cfg.get("port") or env.get("WEFT_DEFAULT_PORT") or 0)
except ValueError:
    cfg["port"] = int(env.get("WEFT_DEFAULT_PORT") or 0)
cfg.update({
    "id": env.get("ADDON_ID", ""), "version": env.get("ADDON_VERSION", ""),
    "bind": env.get("ADDON_BIND") or "127.0.0.1", "host": env.get("ADDON_HOST", ""),
    "host_url": env.get("ADDON_HOST_URL", ""), "mesh": env.get("MESH", ""),
    "forge_api": env.get("FORGE_API", ""), "burrow_socket": env.get("BURROW_SOCKET", ""),
    # where a host drops its own descriptor when the manifest says
    # "integration": {"dir": "~/.config/weft/integrations"} (hosts expand ~ with HOME)
    "integrations": os.path.join(os.path.expanduser("~"), ".config", "weft", "integrations"),
})
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(cfg, fh, indent=2)
os.replace(tmp, path)
PY
}
export MESH

host_for_url() { case "${1:-127.0.0.1}" in 0.0.0.0|::|"") echo 127.0.0.1 ;; *:*) echo "[$1]" ;; *) echo "$1" ;; esac; }
url() { echo "http://$(host_for_url "$(conf bind)"):$(conf port)/"; }
healthy() { curl -fs -m 2 "$(url)health" 2>/dev/null | grep -q "\"app\": *\"$ADDON_ID\""; }
wait_up() { local i; for i in $(seq 1 40); do healthy && return 0; sleep 0.25; done; return 1; }

port_taken() {  # by something that is not this addon
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || return 1
  ! curl -fs -m 2 "http://127.0.0.1:$1/health" 2>/dev/null | grep -q "\"app\": *\"$ADDON_ID\""
}

service_install() {  # service_install: the app is app/server.py, given config.json
  if has_systemd; then
    mkdir -p "$(dirname "$UNIT_FILE")"
    cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=$ADDON_ID (a Weft addon, data in $DATA)

[Service]
Environment=MESH=$MESH
ExecStart=$(command -v python3) $DIR/app/server.py $CONF
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    if systemctl --user cat "$UNIT" >/dev/null 2>&1; then
      systemctl --user enable "$UNIT" >/dev/null 2>&1 || true
    else
      rm -f "$UNIT_FILE"                     # systemd can't see it: run as a plain process instead
    fi
  fi
}
service_start() {
  if [ -f "$UNIT_FILE" ] && has_systemd; then systemctl --user restart "$UNIT"; return; fi
  service_stop
  # its own session (a host stopping this script's process group won't take it
  # down), and the pid written from inside, after setsid's fork
  MESH="$MESH" PIDF="$PIDF" setsid -f bash -c 'echo $$ > "$PIDF"; exec python3 "$0" "$1"' \
    "$DIR/app/server.py" "$CONF" >> "$LOG" 2>&1 < /dev/null
  local i; for i in $(seq 1 20); do [ -s "$PIDF" ] && break; sleep 0.05; done
}
service_stop() {
  if [ -f "$UNIT_FILE" ] && has_systemd; then systemctl --user stop "$UNIT" 2>/dev/null || true; fi
  if [ -f "$PIDF" ]; then
    local pid i; pid="$(cat "$PIDF")"
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done   # let it leave the mesh
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PIDF"
  fi
}
service_remove() {
  service_stop
  if [ -f "$UNIT_FILE" ]; then
    systemctl --user disable "$UNIT" >/dev/null 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
}
service_how() { if [ -f "$UNIT_FILE" ] && has_systemd; then echo "the user service $UNIT"; else echo "a background process (pid $(cat "$PIDF" 2>/dev/null))"; fi; }

mesh_withdraw() { rm -f "$MESH/$ADDON_ID.json"; }

# status_line STATE DETAIL: what a status script prints (url and port when it has them)
status_line() {
  local port; port="$(conf port)"
  if [ -n "$port" ] && [ "$port" != 0 ]; then
    printf '{"state":"%s","url":"%s","port":%s,"version":"%s","detail":"%s"}\n' "$1" "$(url)" "$port" "$(conf version)" "$2"
  else
    printf '{"state":"%s","version":"%s","detail":"%s"}\n' "$1" "$(conf version)" "$2"
  fi
}
