#!/usr/bin/env bash
# Stop the LIMS data viewer started by ops/serve.sh.
# Kills the recorded PID *and* anything still listening on PORT, because
# `npm start` forks a `next-server` child that outlives the npm parent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

PORT="${PORT:-3457}"

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

if [[ -f ops/server.pid ]]; then
  RECORDED="$(cat ops/server.pid)"
  echo "Stopping recorded pid ${RECORDED} …"
  kill_pid "${RECORDED}"
  rm -f ops/server.pid
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
