#!/usr/bin/env bash
# Start the viewer's own Argo pass-through proxy in tmux session
# "ai-ale-argo" on 127.0.0.1:3459. This is independent of the reference
# proxy on 127.0.0.1:4000 and never touches it or its process.
#
# This script must never source .env.live and must never export any Argo
# credential. The proxy takes the caller's key from the Authorization
# header on each request; it holds no key of its own.
set -euo pipefail

SESSION="ai-ale-argo"
PORT="${VIEWER_ARGO_PORT:-3459}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_SCRIPT="$SCRIPT_DIR/viewer_argo_proxy.py"

if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "refusing to start: tmux session '$SESSION' already exists" >&2
    exit 1
fi

port_is_listening() {
    python3 - "$PORT" <<'PY'
import socket
import sys

port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.3)
try:
    result = s.connect_ex(("127.0.0.1", port))
finally:
    s.close()
sys.exit(0 if result == 0 else 1)
PY
}

if port_is_listening; then
    echo "refusing to start: port $PORT is already listening" >&2
    exit 1
fi

tmux new-session -d -s "$SESSION" "VIEWER_ARGO_PORT=$PORT python3 $PROXY_SCRIPT"

echo "started tmux session '$SESSION' on port $PORT"
echo "health check: curl -s http://127.0.0.1:$PORT/health"
