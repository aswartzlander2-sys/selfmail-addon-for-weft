#!/usr/bin/env bash
# detect: is this addon already running on this machine (installed by another
# Weft host, or by hand)? Read-only and quick. Exit 0 with one JSON line if so,
# else exit 1.
set -u
. "$(dirname "$0")/lib.sh"
port="$(setting PORT 8796)"
[ -n "$port" ] || exit 1
for h in 127.0.0.1 "$(host_for_url "$ADDON_BIND")"; do
  info="$(curl -fs -m 2 "http://$h:$port/health" 2>/dev/null)" || continue
  printf '%s' "$info" | grep -q "\"app\": *\"$ADDON_ID\"" || continue
  ver="$(printf '%s' "$info" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p')"
  printf '{"version":"%s","url":"http://%s:%s/","detail":"%s %s answering on port %s"}\n' "$ver" "$h" "$port" "$ADDON_ID" "$ver" "$port"
  exit 0
done
exit 1
