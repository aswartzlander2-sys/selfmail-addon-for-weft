#!/usr/bin/env bash
# action "Restart": stop and start the app. A linked copy belongs to the host
# that runs it.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/service.sh"
find_node || { echo "Node.js 18+ is required."; exit 1; }
case "$(conf linked)" in True|true) echo "This copy is linked: restart it from the Weft host that runs it."; exit 1 ;; esac
node_service_start
wait_up && echo "restarted: $(url)" || { echo "it did not come back; see $LOG"; exit 1; }
