#!/usr/bin/env bash
# Stop the loopback-only "live" ops slice started by ops/serve-live.sh.
# Mirror of ops/stop.sh, defaulting to PORT=3458 / SESSION=ai-ale-live.
# Never touches port 3457 or the "ai-ale-viewer" tmux session.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

PORT="${PORT:-3458}"
SESSION="${TMUX_SESSION:-ai-ale-live}"

kill_pid() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  kill "$pid" 2>/dev/null || true
  for _ in {1..10}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -9 "$pid" 2>/dev/null || true
}

# --- kill the tmux session (current deploy model) ---
if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Killing tmux session '${SESSION}' …"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
fi

# Catch the orphaned next-server child (or any leftover holder of PORT).
HOLDERS="$(fuser "${PORT}/tcp" 2>/dev/null | tr -s ' ' | xargs -n1 echo 2>/dev/null | grep -E '^[0-9]+$' || true)"
if [[ -n "${HOLDERS}" ]]; then
  echo "Killing leftover holders of port ${PORT}: ${HOLDERS}"
  for pid in ${HOLDERS}; do kill_pid "${pid}"; done
fi

if fuser "${PORT}/tcp" 2>/dev/null >/dev/null; then
  echo "WARNING: port ${PORT} is still held by someone else's process."
else
  echo "Stopped. Port ${PORT} is free."
fi
