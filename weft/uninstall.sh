#!/usr/bin/env bash
# uninstall: stop and remove the service (a linked copy is left to its host),
# take this addon off the mesh, and park the inbound tunnel: paused while the
# data stays (a reinstall brings it back), removed with the data. The host
# deletes the data folder itself when ADDON_KEEP_DATA=0.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/service.sh"

sock="${BURROW_SOCKET:-}"
tunnel_port() { python3 -c 'import json,sys;
try: print(json.load(open(sys.argv[1])).get("tunnel", {}).get("port") or "")
except Exception: print("")' "$DATA/state.json" 2>/dev/null; }
burrow_api() {
  curl -sS --max-time 20 --unix-socket "$sock" -X "$1" -H 'Content-Type: application/json' \
       -H "X-Burrow-Client: $ADDON_ID/${ADDON_VERSION:-1}" -o /dev/null -w '%{http_code}' "http://burrow$2"
}

# the inbound tunnel this addon's extension made (it carries app: selfmail)
own_tunnels() {
  [ -n "$sock" ] && [ -S "$sock" ] || return 0
  curl -sS --max-time 20 --unix-socket "$sock" -H "X-Burrow-Client: $ADDON_ID/${ADDON_VERSION:-1}" \
       "http://burrow/tunnels" 2>/dev/null | python3 -c 'import json,sys
try:
    for t in json.load(sys.stdin).get("tunnels", []):
        if t.get("app") == "selfmail": print(t["port"])
except Exception: pass'
}

case "$(conf linked 2>/dev/null)" in
  True|true)
    echo "it was linked: the Weft host that runs it keeps running it"
    ;;
  *)
    node_service_remove
    mesh_withdraw
    echo "stopped and removed ${ADDON_NAME:-$ADDON_ID}"

    if [ -n "$sock" ] && [ -S "$sock" ]; then
      if [ "${ADDON_KEEP_DATA:-1}" = 0 ]; then
        echo "::phase Removing the inbound address"
        for tport in $(own_tunnels); do
          code="$(burrow_api DELETE "/tunnels/$tport")" || code=000
          [ "$code" -lt 400 ] && echo "removed the inbound tunnel $tport" || echo "::warn couldn't remove tunnel $tport (HTTP $code)."
        done
      else
        echo "::phase Pausing the inbound address (a reinstall brings it back)"
        : > "$DATA/paused"
        for tport in $(own_tunnels); do
          code="$(burrow_api PATCH "/tunnels/$tport" '{"enabled":false}')" || code=000
          if [ "$code" -lt 400 ]; then echo "$tport" >> "$DATA/paused"; echo "paused the inbound tunnel $tport"; else echo "::warn couldn't pause tunnel $tport (HTTP $code)."; fi
        done
      fi
    else
      echo "no Burrow control socket here, so no inbound tunnel to park"
    fi
    ;;
esac
