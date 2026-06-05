#!/usr/bin/env bash
# Run the AI-ALE LIMS data viewer as a long-lived process.
#
# Defaults to 0.0.0.0:3457 because this host (Poplar) sits behind ANL's
# firewall and Dan's nginx on modelseed.org proxies modelseed.org/projects/aiale
# to poplar:3457. Override HOST=127.0.0.1 to bind loopback-only (development).
#
# Logs:  ops/server.log    PID: ops/server.pid
# Stop:  ops/stop.sh
set -euo pipefail

PORT="${PORT:-3457}"
HOST="${HOST:-0.0.0.0}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# --- conda environment ---
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh
conda activate ai-ale-dev

mkdir -p ops

# --- log rotation: keep the last 3 logs ---
if [[ -f ops/server.log ]]; then
  for i in 2 1 0; do
    if [[ -f "ops/server.log.${i}" ]]; then mv "ops/server.log.${i}" "ops/server.log.$((i+1))"; fi
  done
  mv ops/server.log ops/server.log.0
fi

# --- refuse to start if our own instance is already running ---
if [[ -f ops/server.pid ]] && kill -0 "$(cat ops/server.pid)" 2>/dev/null; then
  echo "Already running with pid $(cat ops/server.pid). Stop it first with ops/stop.sh."
  exit 1
fi

# --- refuse to start if the port is occupied by something else ---
if ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "Port ${PORT} is already in use by another process. Pick a different port:"
  echo "  PORT=XYZ ops/serve.sh"
  exit 1
fi

# --- build if .next is missing ---
if [[ ! -d .next ]]; then
  npm run build
fi

# --- launch under nohup so it survives the launching shell ---
nohup npm start -- -H "${HOST}" -p "${PORT}" > ops/server.log 2>&1 &
echo $! > ops/server.pid
disown || true

# --- wait briefly for the server to come up ---
for i in {1..60}; do
  if grep -qE "Ready|Local:|started server" ops/server.log 2>/dev/null; then break; fi
  sleep 0.5
done

echo "Started. PID=$(cat ops/server.pid)  HOST=${HOST}  PORT=${PORT}"
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
echo "Logs:    tail -F $(pwd)/ops/server.log"
echo "Stop:    $(pwd)/ops/stop.sh"
