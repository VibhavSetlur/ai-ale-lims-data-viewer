#!/usr/bin/env bash
# Dynamic companion for the static-first LIMS release controller.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DB="${SOURCE_DB:-/scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db}"
DEST_DB="${DEST_DB:-$HERE/data/lims_indexed.db}"
STATE_DIR="${STATE_DIR:-$HERE/.local/auto-refresh-release}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/dynamic.lock}"
PORT="${PORT:-3457}"
HOST="${HOST:-0.0.0.0}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
DYNAMIC_ONLY=0
ACCEPTED_SNAPSHOT=""

usage() {
  cat <<'USAGE'
Usage: ops/auto-refresh-release.sh --dynamic-only --accepted-snapshot FILE

This companion is intentionally not a standalone publisher. It consumes validation
proof emitted by the successful static controller, independently stages the current
source, and refuses to restart the dynamic server unless its SHA-256 and table
counts match that accepted snapshot.
USAGE
}
while (($#)); do
  case "$1" in
    --dynamic-only) DYNAMIC_ONLY=1 ;;
    --accepted-snapshot) ACCEPTED_SNAPSHOT="${2:-}"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
[[ "$DYNAMIC_ONLY" == 1 && -n "$ACCEPTED_SNAPSHOT" ]] || { usage >&2; exit 2; }
[[ -r "$ACCEPTED_SNAPSHOT" && -f "$ACCEPTED_SNAPSHOT" ]] || { echo "accepted snapshot is unreadable: $ACCEPTED_SNAPSHOT" >&2; exit 1; }
[[ -r "$SOURCE_DB" && -f "$SOURCE_DB" ]] || { echo "source is unreadable or missing: $SOURCE_DB" >&2; exit 1; }

log() { printf '[dynamic-release] %s %s\n' "$(date -Is)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }
source_identity() { stat -c '%Y:%s' "$1"; }
cleanup() { local status=$?; [[ -n "${STAGE_DIR:-}" ]] && rm -rf "$STAGE_DIR"; exit "$status"; }
trap cleanup EXIT INT TERM

mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || { log "another dynamic refresh is already running"; exit 0; }
mkdir -p "${TMPDIR:-/tmp/opencode}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp/opencode}/aiale-dynamic-release.XXXXXX")"
STAGED_DB="$STAGE_DIR/lims-source.db"
BEFORE="$(source_identity "$SOURCE_DB")"
cp --reflink=auto "$SOURCE_DB" "$STAGED_DB"
AFTER="$(source_identity "$SOURCE_DB")"
[[ "$BEFORE" == "$AFTER" ]] || fail "source changed while copied ($BEFORE -> $AFTER)"
python3 "$HERE/ops/validate-snapshot.py" "$STAGED_DB" > "$STAGE_DIR/source-validation.json"
python3 - "$ACCEPTED_SNAPSHOT" "$STAGE_DIR/source-validation.json" <<'PY'
import json, sys
accepted, staged = (json.load(open(path)) for path in sys.argv[1:])
if accepted['sha256'] != staged['sha256']:
    raise SystemExit('current source hash differs from static accepted snapshot')
if accepted['tables'] != staged['tables']:
    raise SystemExit('current source table counts differ from static accepted snapshot')
PY

log "refreshing indexed dynamic database from accepted snapshot"
bash "$HERE/ops/refresh-db.sh" "$STAGED_DB" "$DEST_DB"
python3 "$HERE/ops/validate-snapshot.py" "$DEST_DB" > "$STAGE_DIR/indexed-validation.json"
python3 - "$ACCEPTED_SNAPSHOT" "$STAGE_DIR/indexed-validation.json" <<'PY'
import json, sys
accepted, indexed = (json.load(open(path)) for path in sys.argv[1:])
if accepted['tables'] != indexed['tables']:
    raise SystemExit('indexed dynamic database table counts differ from accepted snapshot')
PY

log "building and restarting dynamic server on port $PORT"
bash -lc "source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate '$CONDA_ENV' && cd '$HERE' && npm run build"
PORT="$PORT" bash "$HERE/ops/stop.sh"
PORT="$PORT" HOST="$HOST" CONDA_ENV="$CONDA_ENV" bash "$HERE/ops/serve.sh"
for _ in {1..60}; do
  if curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/health" >/dev/null || fail "dynamic health endpoint did not recover"
curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/mutations" > /dev/null || fail "dynamic mutations endpoint did not recover"
log "dynamic release verified"
