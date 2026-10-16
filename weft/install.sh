#!/usr/bin/env bash
# install (and update): run the mail app as a service, or link the copy another
# Weft host already runs. Talks back with ::phase, ::progress, ::open, ::warn.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/service.sh"

port="$(setting PORT 8796)"
find_node || { echo "Selfmail needs Node.js 18 or newer (Burrow sets BURROW_NODE from 2.8.0 on)."; exit 1; }

# over Burrow's control socket: bring back the inbound tunnel an uninstall
# paused (a plain `curl --unix-socket` to $BURROW_SOCKET, as Burrow Pages does)
sock="${BURROW_SOCKET:-}"
burrow_api() {
  curl -sS --max-time 20 --unix-socket "$sock" -X "$1" -H 'Content-Type: application/json' \
       -H "X-Burrow-Client: $ADDON_ID/${ADDON_VERSION:-1}" ${3:+--data "$3"} -o /dev/null -w '%{http_code}' "http://burrow$2"
}

linked() { [ "$(conf linked)" = True ] || [ "$(conf linked)" = true ]; }

if [ "${ADDON_ADOPT:-0}" = 1 ] && [ "${ADDON_UPDATE:-0}" != 1 ] && [ ! -f "$UNIT_FILE" ] && [ ! -f "$PIDF" ]; then
  # Another host runs it: point at that one, start nothing (see SPEC.md, "Linking").
  echo "::phase Linking the ${ADDON_NAME:-$ADDON_ID} already running"
  conf_write "$port"
  python3 -c 'import json,sys; p=sys.argv[1]; c=json.load(open(p)); c["linked"]=True; json.dump(c,open(p,"w"),indent=2)' "$CONF"
  healthy || { echo "It stopped answering on port $port while linking."; exit 1; }
  echo "linked: $(url) is run by another Weft host; this one shows it and leaves it alone"
  echo "::open $(url)"
  exit 0
fi
if [ -f "$CONF" ] && linked; then
  echo "::phase Updating the link"
  conf_write "$(conf port)"
  echo "still linked to $(url)"
  echo "::open $(url)"
  exit 0
fi

if [ "${ADDON_UPDATE:-0}" = 1 ]; then echo "::phase Updating ${ADDON_NAME:-$ADDON_ID}"; else echo "::phase Installing ${ADDON_NAME:-$ADDON_ID}"; fi
echo "::progress 15 Checking port $port"
if port_taken "$port"; then
  echo "Port $port is used by something else. Pick another one in the addon's settings."
  exit 1
fi
echo "::progress 40 Writing the settings"
conf_write "$port"
echo "settings in $CONF"

# No mail domain is asked for: the machine's own domains, straight off the
# dashboard's control socket, go into the settings — every one of them is served
if [ -n "$sock" ] && [ -S "$sock" ]; then
  curl -sS --max-time 10 --unix-socket "$sock" -H "X-Burrow-Client: $ADDON_ID/${ADDON_VERSION:-1}" \
    http://burrow/overview 2>/dev/null \
    | python3 -c '
import json, sys
try:
    o = json.load(sys.stdin)
    zones = [(o.get("domain") or {}).get("zone")] + [d.get("zone") for d in o.get("domains") or []]
    seen, out = set(), []
    for z in zones:
        z = (z or "").strip().lower()
        if z and z not in seen:
            seen.add(z); out.append(z)
    print(",".join(out))
except Exception:
    pass' > "$DATA/.domains.tmp" 2>/dev/null || true
  if [ -s "$DATA/.domains.tmp" ] && [ "$(head -c 200 "$DATA/.domains.tmp")" != "" ]; then
    python3 - "$CONF" "$DATA/.domains.tmp" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg["mail_domains"] = open(sys.argv[2]).read().strip()
json.dump(cfg, open(sys.argv[1], "w"), indent=2)
PY
    echo "serving mail for: $(cat "$DATA/.domains.tmp")"
  fi
  rm -f "$DATA/.domains.tmp"
fi
echo "::progress 65 Starting it"
node_service_install
node_service_start
if ! wait_up; then
  echo "It did not start. The last lines of its log:"
  tail -n 20 "$LOG" 2>/dev/null || journalctl --user -u "$UNIT" -n 20 --no-pager 2>/dev/null || true
  exit 1
fi
echo "running as $(node_service_how), on $(url)"

# the tunnel the last uninstall paused: a reinstall brings it back
if [ -n "$sock" ] && [ -S "$sock" ] && [ -s "$DATA/paused" ]; then
  echo "::phase Bringing the inbound address back"
  while IFS= read -r tport; do
    [ -n "$tport" ] || continue
    code="$(burrow_api PATCH "/tunnels/$tport" '{"enabled":true}')" || code=000
    if [ "$code" -lt 400 ]; then echo "inbound tunnel $tport answers again"; else echo "::warn couldn't re-enable inbound tunnel $tport (HTTP $code)."; fi
  done < "$DATA/paused"
  rm -f "$DATA/paused"
fi
# the extension (which publishes the inbound address) reloads on its own; the
# first state it writes is due within a minute of this install

if [ "${ADDON_HOST:-}" = burrow ] && [ -n "${ADDON_HOST_URL:-}" ]; then
  echo "::progress 100 Ready"
  echo "::open ${ADDON_HOST_URL}__gate/selfmail/"
  echo "it is on the dashboard, behind your login: ${ADDON_HOST_URL}__gate/selfmail/"
else
  echo "::progress 100 Ready"
  echo "::open $(url)"
  echo "it answers on $(url); under Aegis × Burrow it is a page of the dashboard"
fi
