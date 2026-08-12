#!/usr/bin/env bash
# Inner runner executed inside the tmux session by ops/serve-live.sh.
# Mirror of ops/_run.sh for the loopback-only "live" ops slice (port 3458).
# Kept as a separate file to avoid fragile nested-quote escaping in tmux.
set -uo pipefail

PORT="${PORT:-3458}"
HOST="${HOST:-127.0.0.1}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-live}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh
conda activate "${CONDA_ENV}"
cd "${HERE}"

# Load .env.live if present. Never echoed: `set -a` only marks vars for
# export, it does not print them, and we never `cat`/log this file.
if [[ -f .env.live ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.live
  set +a
fi

if [[ "${PORT}" == "3457" || "${NEXT_DIST_DIR}" == ".next" ]]; then
  echo "[serve-live] refusing to bind port 3457 or use .next; that is the existing viewer."
  exit 1
fi

export NEXT_DIST_DIR

echo "[serve-live] node=$(node -v) env=${CONDA_ENV} host=${HOST} port=${PORT} distDir=${NEXT_DIST_DIR} $(date)"
exec npm start -- -H "${HOST}" -p "${PORT}"
