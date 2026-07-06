#!/usr/bin/env bash
# Refresh the indexed full LIMS DB from the upstream mirror when it changes, then
# restart the live server so port 3457 reflects the latest DB snapshot.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

SOURCE_DB="${SOURCE_DB:-/scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db}"
DEST_DB="${DEST_DB:-$HERE/data/lims_indexed.db}"
STAMP="${STAMP:-$HERE/ops/live-db-source.mtime}"
LOCK="${LOCK:-$HERE/ops/auto-refresh-live.lock}"
PORT="${PORT:-3457}"
HOST="${HOST:-0.0.0.0}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
LOG="${LOG:-$HERE/ops/auto-refresh-live.log}"

mkdir -p ops data

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(date -Is)] another refresh is already running" >> "$LOG"
  exit 0
fi

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "[$(date -Is)] source DB missing: $SOURCE_DB" >> "$LOG"
  exit 1
fi

source_mtime="$(stat -c %Y "$SOURCE_DB")"
last_mtime="$(cat "$STAMP" 2>/dev/null || true)"

if [[ "$source_mtime" == "$last_mtime" && -f "$DEST_DB" ]]; then
  echo "[$(date -Is)] no upstream DB change; source_mtime=$source_mtime" >> "$LOG"
  exit 0
fi

echo "[$(date -Is)] refreshing live DB from $SOURCE_DB source_mtime=$source_mtime" >> "$LOG"
bash ops/refresh-db.sh "$SOURCE_DB" "$DEST_DB" >> "$LOG" 2>&1

echo "[$(date -Is)] rebuilding server bundle" >> "$LOG"
bash -lc "source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate '${CONDA_ENV}' && cd '${HERE}' && npm run build" >> "$LOG" 2>&1

echo "[$(date -Is)] restarting live server on port $PORT" >> "$LOG"
PORT="$PORT" bash ops/stop.sh >> "$LOG" 2>&1 || true
PORT="$PORT" HOST="$HOST" CONDA_ENV="$CONDA_ENV" bash ops/serve.sh >> "$LOG" 2>&1

printf '%s\n' "$source_mtime" > "$STAMP"
echo "[$(date -Is)] live refresh complete" >> "$LOG"
