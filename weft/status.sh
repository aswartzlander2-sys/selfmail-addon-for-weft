#!/usr/bin/env bash
# status: one JSON line, quickly: {"state", "url", "port", "version", "detail"}.
# Read-only; never starts anything.
set -u
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/service.sh"

if [ ! -f "$CONF" ]; then echo '{"state":"error","detail":"no settings: install it again"}'; exit 0; fi
port="$(conf port)"

# under Aegis × Burrow the page is the dashboard's own, behind its login
if [ "${ADDON_HOST:-}" = burrow ] && [ -n "${ADDON_HOST_URL:-}" ]; then
  page="${ADDON_HOST_URL}__gate/selfmail/"
else
  page="$(url)"
fi

how="its own service"; case "$(conf linked)" in True|true) how="run by another Weft host" ;; esac

if ! healthy; then
  printf '{"state":"stopped","url":"%s","port":%s,"version":"%s","detail":"not answering on port %s (%s)"}\n' \
    "$page" "$port" "$(conf version)" "$port" "$how"
  exit 0
fi

summary="$(curl -fs -m 3 "http://$(host_for_url "$(conf bind)"):$port/api/state" 2>/dev/null)" || summary=""
detail="$(LIST="$summary" python3 -c 'import json, os, sys
try:
    s = json.loads(os.environ["LIST"])
    c = s.get("counts", {})
    print("%d unread, %d in, %d drafts, %d sent, mailbox %s" % (
        c.get("unread", 0), c.get("inbox", 0), c.get("drafts", 0), c.get("sent", 0), s.get("address") or "unset"))
except Exception:
    print("answering")')"
printf '{"state":"running","url":"%s","port":%s,"version":"%s","detail":"%s, %s"}\n' \
  "$page" "$port" "$(conf version)" "$detail" "$how"
