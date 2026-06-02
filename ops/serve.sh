#!/usr/bin/env bash
# Run the LIMS data viewer in the background, persisting across logout.
# Logs: ops/server.log    PID: ops/server.pid
set -euo pipefail

PORT="${PORT:-34721}"
# Bind loopback-only by default. This keeps the viewer reachable from any
# process on this host (i.e. any Poplar user, including via SSH port-forward)
# while making it unreachable from off-host — no internet exposure at the
# socket level, regardless of any firewall config. To intentionally publish
# externally, set HOST=0.0.0.0 (NOT recommended on a shared box).
HOST="${HOST:-127.0.0.1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# Source conda + activate the project env (same env used for npm install).
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh
conda activate ai-ale-dev

mkdir -p ops

# Stop any previous instance we started.
if [[ -f ops/server.pid ]] && kill -0 "$(cat ops/server.pid)" 2>/dev/null; then
  echo "Already running with pid $(cat ops/server.pid). Stop it first with ops/stop.sh."
  exit 1
fi

if ! ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  : # port is free, good
else
  echo "Port ${PORT} is occupied by another process. Pick a different port: PORT=XYZ ops/serve.sh"
  exit 1
fi

# Build if needed (cheap when already built).
if [[ ! -d .next ]]; then
  npm run build
fi

# Run under nohup so it survives the launching shell.
nohup npm start -- -H "${HOST}" -p "${PORT}" > ops/server.log 2>&1 &
echo $! > ops/server.pid
disown || true

# Wait briefly for "Ready" to appear in the log.
for i in {1..30}; do
  if grep -q "Ready\|Local:" ops/server.log 2>/dev/null; then break; fi
  sleep 0.5
done

echo "Started. PID=$(cat ops/server.pid)  HOST=${HOST}  PORT=${PORT}"
if [[ "${HOST}" == "127.0.0.1" || "${HOST}" == "localhost" ]]; then
  echo "Access (on Poplar):   http://localhost:${PORT}"
  echo "Access (from laptop): ssh -L ${PORT}:localhost:${PORT} ${USER}@poplar.cels.anl.gov  →  http://localhost:${PORT}"
else
  echo "Access (warning: bound to ${HOST}, reachable beyond Poplar): http://poplar.cels.anl.gov:${PORT}"
fi
echo "Logs: tail -F $(pwd)/ops/server.log"
echo "Stop: $(pwd)/ops/stop.sh"
