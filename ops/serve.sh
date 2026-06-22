#!/usr/bin/env bash
# Run the AI-ALE LIMS data viewer as a long-lived process inside tmux.
#
# Defaults to 0.0.0.0:3457 because this host (Poplar) sits behind ANL's
# firewall and Dan's nginx on modelseed.org proxies modelseed.org/projects/aiale
# to poplar:3457. Override HOST=127.0.0.1 to bind loopback-only (development).
#
# Process model: a detached tmux session named "ai-ale-viewer" runs
# `npm start` under the ai-ale-dev conda env (conda-provided Node 22).
# tmux keeps the server alive across SSH disconnects and lets you attach
# to watch live output: `tmux attach -t ai-ale-viewer`.
#
# Logs:  ops/server.log (tee'd from inside tmux)
# Stop:  ops/stop.sh
set -euo pipefail

PORT="${PORT:-3457}"
HOST="${HOST:-0.0.0.0}"
SESSION="${TMUX_SESSION:-ai-ale-viewer}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

mkdir -p ops

# --- tmux must be available ---
if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed or not on PATH. Install tmux or use systemd (see DEPLOY.md)."
  exit 1
fi

# --- log rotation: keep the last 3 logs ---
if [[ -f ops/server.log ]]; then
  for i in 2 1 0; do
    if [[ -f "ops/server.log.${i}" ]]; then mv "ops/server.log.${i}" "ops/server.log.$((i+1))"; fi
  done
  mv ops/server.log ops/server.log.0
fi

# --- refuse to start if our tmux session is already running ---
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' is already running. Stop it first with ops/stop.sh"
  echo "  (or attach to inspect:  tmux attach -t $SESSION )"
  exit 1
fi

# --- refuse to start if the port is occupied by something else ---
if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "Port ${PORT} is already in use by another process. Pick a different port:"
  echo "  PORT=XYZ ops/serve.sh"
  echo "Or stop the current viewer first:  ops/stop.sh"
  exit 1
fi

# --- build if .next is missing (build happens inside the conda env) ---
if [[ ! -d .next ]]; then
  echo "No .next build found; building first..."
  bash -lc "source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ${CONDA_ENV} && cd '${HERE}' && npm run build"
fi

# --- launch inside a detached tmux session ---
# A helper script (ops/_run.sh) does the conda activate + npm start so we avoid
# fragile nested-quote escaping. tmux pipe-pane mirrors the pane to the log file
# so `tail -F ops/server.log` works without attaching.
: > ops/server.log
PORT="${PORT}" HOST="${HOST}" CONDA_ENV="${CONDA_ENV}" \
  tmux new-session -d -s "$SESSION" "bash '${HERE}/ops/_run.sh'"
tmux set-option -t "$SESSION" remain-on-exit on 2>/dev/null || true
tmux pipe-pane -o -t "$SESSION" "cat >> '${HERE}/ops/server.log'" 2>/dev/null || true

# --- wait briefly for the server to come up ---
ok=0
for i in {1..80}; do
  if grep -qE "Ready|Local:|started server" ops/server.log 2>/dev/null; then ok=1; break; fi
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "tmux session exited unexpectedly. Last log lines:"
    tail -n 20 ops/server.log 2>/dev/null || true
    exit 1
  fi
  if [[ "$(tmux list-panes -t "$SESSION" -F '#{pane_dead}' 2>/dev/null)" == "1" ]]; then
    echo "Server process died on startup. Last log lines:"
    tail -n 25 ops/server.log 2>/dev/null || true
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    exit 1
  fi
  sleep 0.5
done

echo "Started in tmux session '$SESSION'.  HOST=${HOST}  PORT=${PORT}  ENV=${CONDA_ENV}"
if [[ "$ok" != "1" ]]; then
  echo "WARNING: did not see a readiness line within 40s; check ops/server.log"
fi
case "${HOST}" in
  127.0.0.1|localhost)
    echo "Access (on Poplar):    http://localhost:${PORT}"
    echo "Access (laptop SSH):   ssh -L ${PORT}:localhost:${PORT} ${USER}@poplar.cels.anl.gov  ->  http://localhost:${PORT}"
    ;;
  *)
    echo "Access (on Poplar):    http://localhost:${PORT}"
    echo "Access (ANL network):  http://poplar.cels.anl.gov:${PORT}"
    echo "Public access plan:    https://modelseed.org/projects/aiale  (Dan's nginx proxy -> poplar:${PORT})"
    ;;
esac
echo "Health:  curl http://localhost:${PORT}/api/health"
echo "Attach:  tmux attach -t ${SESSION}    (detach with Ctrl-b d)"
echo "Logs:    tail -F $(pwd)/ops/server.log"
echo "Stop:    $(pwd)/ops/stop.sh"
