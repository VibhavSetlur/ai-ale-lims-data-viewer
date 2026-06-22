#!/usr/bin/env bash
# Inner runner executed inside the tmux session by ops/serve.sh.
# Kept as a separate file to avoid fragile nested-quote escaping in tmux.
set -uo pipefail

PORT="${PORT:-3457}"
HOST="${HOST:-0.0.0.0}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh
conda activate "${CONDA_ENV}"
cd "${HERE}"

echo "[serve] node=$(node -v) env=${CONDA_ENV} host=${HOST} port=${PORT} $(date)"
exec npm start -- -H "${HOST}" -p "${PORT}"
