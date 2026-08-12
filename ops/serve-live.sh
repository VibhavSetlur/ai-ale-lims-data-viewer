#!/usr/bin/env bash
# Run the operational (MySQL + ORCID) live slice as a second, loopback-only
# process alongside the existing 3457 viewer. Mirror of ops/serve.sh.
#
# Isolation from the primary 3457 instance:
#   - separate tmux session "ai-ale-live" (does not touch "ai-ale-viewer")
#   - separate build dir .next-live via NEXT_DIST_DIR (does not touch .next)
#   - separate log ops/live.log (does not touch ops/server.log)
#   - defaults to HOST=127.0.0.1 (loopback only, not exposed by nginx)
#
# Logs:  ops/live.log
# Stop:  ops/stop-live.sh
set -euo pipefail

PORT="${PORT:-3458}"
HOST="${HOST:-127.0.0.1}"
SESSION="${TMUX_SESSION:-ai-ale-live}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-live}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${PORT}" == "3457" || "${SESSION}" == "ai-ale-viewer" || "${NEXT_DIST_DIR}" == ".next" ]]; then
  echo "Refusing to run: PORT/TMUX_SESSION/NEXT_DIST_DIR collide with the existing viewer on 3457."
  exit 1
fi

cd "$HERE"

mkdir -p ops

# --- tmux must be available ---
if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed or not on PATH."
  exit 1
fi

# --- log rotation: keep the last 3 logs ---
if [[ -f ops/live.log ]]; then
  for i in 2 1 0; do
    if [[ -f "ops/live.log.${i}" ]]; then mv "ops/live.log.${i}" "ops/live.log.$((i+1))"; fi
  done
  mv ops/live.log ops/live.log.0
fi

# --- refuse to start if our tmux session is already running ---
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' is already running. Stop it first with ops/stop-live.sh"
  echo "  (or attach to inspect:  tmux attach -t $SESSION )"
  exit 1
fi

# --- refuse to start if the port is occupied by something else ---
if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "Port ${PORT} is already in use by another process. Pick a different port:"
  echo "  PORT=XYZ ops/serve-live.sh"
  echo "Or stop the current live slice first:  ops/stop-live.sh"
  exit 1
fi

# --- build into NEXT_DIST_DIR if missing OR is a stale static-export build ---
# Never touches .next (the 3457 build directory).
if [[ ! -d "${NEXT_DIST_DIR}" ]]; then
  echo "No ${NEXT_DIST_DIR} build found; building first..."
  bash -lc "source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ${CONDA_ENV} && cd '${HERE}' && NEXT_DIST_DIR='${NEXT_DIST_DIR}' npm run build"
elif grep -q '"exportTrailingSlash": true' "${NEXT_DIST_DIR}/export-marker.json" 2>/dev/null; then
  echo "Detected a static-export build in ${NEXT_DIST_DIR}; rebuilding clean..."
  rm -rf "${NEXT_DIST_DIR}"
  bash -lc "source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ${CONDA_ENV} && cd '${HERE}' && NEXT_DIST_DIR='${NEXT_DIST_DIR}' npm run build"
fi

# --- launch inside a detached tmux session ---
: > ops/live.log
# Use tmux -e (tmux 3.4+) to set session env directly: the shared tmux
# server's global environment (e.g. PORT=3457 HOST=0.0.0.0 from the primary
# viewer session) overrides a plain client env prefix, so an env prefix here
# would silently be ignored in favor of the global values.
tmux new-session -d -s "$SESSION" \
  -e PORT="${PORT}" \
  -e HOST="${HOST}" \
  -e CONDA_ENV="${CONDA_ENV}" \
  -e NEXT_DIST_DIR="${NEXT_DIST_DIR}" \
  "bash '${HERE}/ops/_run-live.sh'"
tmux set-option -t "$SESSION" remain-on-exit on 2>/dev/null || true
tmux pipe-pane -o -t "$SESSION" "cat >> '${HERE}/ops/live.log'" 2>/dev/null || true

# --- wait briefly for the server to come up ---
ok=0
for i in {1..80}; do
  if grep -qE "Ready|Local:|started server" ops/live.log 2>/dev/null; then ok=1; break; fi
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux session exited unexpectedly. Last log lines:"
    tail -n 20 ops/live.log 2>/dev/null || true
    exit 1
  fi
  if [[ "$(tmux list-panes -t "$SESSION" -F '#{pane_dead}' 2>/dev/null)" == "1" ]]; then
    echo "Server process died on startup. Last log lines:"
    tail -n 25 ops/live.log 2>/dev/null || true
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    exit 1
  fi
  sleep 0.5
done

echo "Started in tmux session '$SESSION'.  HOST=${HOST}  PORT=${PORT}  ENV=${CONDA_ENV}  DIST=${NEXT_DIST_DIR}"
if [[ "$ok" != "1" ]]; then
  echo "WARNING: did not see a readiness line within 40s; check ops/live.log"
fi
echo "Access (loopback only): http://127.0.0.1:${PORT}"
echo "Health:  curl http://127.0.0.1:${PORT}/api/health"
echo "Status:  curl http://127.0.0.1:${PORT}/api/ops/status"
echo "Attach:  tmux attach -t ${SESSION}    (detach with Ctrl-b d)"
echo "Logs:    tail -F $(pwd)/ops/live.log"
echo "Stop:    $(pwd)/ops/stop-live.sh"
