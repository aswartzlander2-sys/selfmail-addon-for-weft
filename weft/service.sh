# weft/service.sh: Selfmail's own service helpers, for its Node app.
#
# weft/lib.sh (vendored, never edited) runs apps that are app/server.py; this
# file sits next to it and does the same job for app/server.mjs with Node:
# a systemd user service when there is one, else a background process with a
# pid file. Sourced by the scripts after lib.sh; nothing here runs on its own.
#
#   find_node            where Node.js 18+ is (BURROW_NODE, then PATH)
#   node_service_install write (or refresh) the unit
#   node_service_start   start or restart it
#   node_service_stop    stop it (and let it leave the mesh)
#   node_service_remove  stop it and take the unit away
#   node_service_how     "the user service …" or "a background process (pid …)"

NODE=""

find_node() {
  local n
  for n in "${BURROW_NODE:-}" "$(command -v node 2>/dev/null)" "$HOME"/.nvm/versions/node/*/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -n "$n" ] && [ -x "$n" ] || continue
    "$n" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null && { NODE="$n"; return 0; }
  done
  return 1
}

node_service_install() {  # the app is app/server.mjs, given config.json as its argument
  if has_systemd; then
    mkdir -p "$(dirname "$UNIT_FILE")"
    cat > "$UNIT_FILE" <<UNIT
[Unit]
Description=$ADDON_ID (a Weft addon, data in $DATA)
After=network-online.target

[Service]
Environment=MESH=$MESH
ExecStart=$NODE $DIR/app/server.mjs $CONF
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

node_service_start() {
  if [ -f "$UNIT_FILE" ] && has_systemd; then systemctl --user restart "$UNIT"; return; fi
  node_service_stop
  # its own session (a host stopping this script's process group won't take it
  # down), and the pid written from inside, after setsid's fork
  MESH="$MESH" PIDF="$PIDF" setsid -f bash -c 'echo $$ > "$PIDF"; exec "$2" "$0" "$1"' \
    "$DIR/app/server.mjs" "$CONF" "$NODE" >> "$LOG" 2>&1 < /dev/null
  local i; for i in $(seq 1 20); do [ -s "$PIDF" ] && break; sleep 0.05; done
}

node_service_stop() {
  if [ -f "$UNIT_FILE" ] && has_systemd; then systemctl --user stop "$UNIT" 2>/dev/null || true; fi
  if [ -f "$PIDF" ]; then
    local pid i; pid="$(cat "$PIDF")"
    kill "$pid" 2>/dev/null || true
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done   # let it leave the mesh
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PIDF"
  fi
}

node_service_remove() {
  node_service_stop
  if [ -f "$UNIT_FILE" ]; then
    systemctl --user disable "$UNIT" >/dev/null 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
}

node_service_how() { if [ -f "$UNIT_FILE" ] && has_systemd; then echo "the user service $UNIT"; else echo "a background process (pid $(cat "$PIDF" 2>/dev/null))"; fi; }
