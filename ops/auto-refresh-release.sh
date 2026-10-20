#!/usr/bin/env bash
# Atomically validate and publish one LIMS snapshot. Static release is the default.
# This script never writes the upstream source. Its state is accepted only after all
# selected release stages, including the public HTTPS checks, have succeeded.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DB="${SOURCE_DB:-/scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db}"
STATIC_ROOT="${STATIC_ROOT:-$HERE}"
DYNAMIC_ROOT="${DYNAMIC_ROOT:-/scratch/vsetlur/tmp/aiale-refresh-dynamic}"
WEBROOT="${WEBROOT:-/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev}"
PUBLIC_URL="${PUBLIC_URL:-https://modelseed.org/annotation/projects/aiale-dev}"
STATE_DIR="${STATE_DIR:-$HERE/.local/auto-refresh-release}"
STATE_FILE="${STATE_FILE:-$STATE_DIR/state.json}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/release.lock}"
ROLLBACK_DIR="${ROLLBACK_DIR:-$HERE/static-deploy-backups}"
TEMP_PORT="${TEMP_PORT:-3458}"
CONDA_ENV="${CONDA_ENV:-ai-ale-dev}"
DRY_RUN=0
INCLUDE_DYNAMIC=0
ROLLBACK_READY=0
WEBROOT_TOUCHED=0
ROLLBACK=""

usage() {
  cat <<'USAGE'
Usage: ops/auto-refresh-release.sh [--dry-run] [--once] [--static-only] [--include-dynamic]

The default and --static-only validate, bake, build, deploy, and verify the static
release. --include-dynamic runs the dynamic companion only after the static release
has passed. --once is accepted for scheduler clarity; each invocation runs once.
USAGE
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --once|--static-only) ;;
    --include-dynamic) INCLUDE_DYNAMIC=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

log() { printf '[auto-refresh-release] %s %s\n' "$(date -Is)" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }
source_identity() { stat -c '%Y:%s' "$1"; }
json_field() { python3 - "$1" "$2" <<'PY'
import json, sys
with open(sys.argv[1]) as handle: value = json.load(handle)
for part in sys.argv[2].split('.'):
    value = value.get(part) if isinstance(value, dict) else None
print('' if value is None else value)
PY
}
cleanup() {
  local status=$?
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if ((status != 0 && WEBROOT_TOUCHED == 1 && ROLLBACK_READY == 1)); then
    log "release failed after publication; restoring webroot contents from $ROLLBACK"
    rsync -a --delete --no-perms --omit-dir-times "$ROLLBACK/" "$WEBROOT/" || log "ERROR: rollback copy failed"
    find "$WEBROOT" -mindepth 1 -type d -exec chmod 755 {} + || true
    find "$WEBROOT" -mindepth 1 -type f -exec chmod 644 {} + || true
  fi
  [[ -n "${STAGE_DIR:-}" ]] && rm -rf "$STAGE_DIR"
  exit "$status"
}
trap cleanup EXIT INT TERM

[[ -r "$SOURCE_DB" && -f "$SOURCE_DB" ]] || fail "source is unreadable or missing: $SOURCE_DB"
[[ -d "$STATIC_ROOT" ]] || fail "static root is missing: $STATIC_ROOT"
[[ "$WEBROOT" == /scratch1/fliu/html/modelseed_annotation/projects/aiale-dev ]] || fail "refusing an unapproved webroot: $WEBROOT"

if ((DRY_RUN)); then
  log "dry run: validating source only; no indexed DB, build, state, or webroot will change"
else
  [[ "$(git -C "$STATIC_ROOT" branch --show-current)" == "static" ]] || fail "real static releases must run from the static branch"
  mkdir -p "$STATE_DIR" "$ROLLBACK_DIR"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log "another release is already running"; exit 0; }
fi

mkdir -p "${TMPDIR:-/tmp/opencode}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp/opencode}/aiale-release.XXXXXX")"
STAGED_DB="$STAGE_DIR/lims-source.db"
SOURCE_BEFORE="$(source_identity "$SOURCE_DB")"
log "staging source identity=$SOURCE_BEFORE"
cp --reflink=auto "$SOURCE_DB" "$STAGED_DB"
SOURCE_AFTER="$(source_identity "$SOURCE_DB")"
[[ "$SOURCE_BEFORE" == "$SOURCE_AFTER" ]] || fail "source changed while copied ($SOURCE_BEFORE -> $SOURCE_AFTER)"
python3 "$STATIC_ROOT/ops/validate-snapshot.py" "$STAGED_DB" > "$STAGE_DIR/source-validation.json"
SOURCE_SHA="$(json_field "$STAGE_DIR/source-validation.json" sha256)"
[[ -n "$SOURCE_SHA" ]] || fail "validator did not produce a source hash"
log "validated stable source sha256=$SOURCE_SHA"

if [[ -f "$STATE_FILE" ]] && [[ "$(json_field "$STATE_FILE" accepted.sha256 2>/dev/null || true)" == "$SOURCE_SHA" ]]; then
  log "no-op: source hash already accepted"
  exit 0
fi

if ((DRY_RUN)); then
  log "dry run successful: source is stable and valid; release would publish sha256=$SOURCE_SHA"
  exit 0
fi

DEST_DB="$STATIC_ROOT/data/lims_indexed.db"
log "refreshing indexed static database"
bash "$STATIC_ROOT/ops/refresh-db.sh" "$STAGED_DB" "$DEST_DB"
python3 "$STATIC_ROOT/ops/validate-snapshot.py" "$DEST_DB" > "$STAGE_DIR/indexed-validation.json"
python3 - "$STAGE_DIR/source-validation.json" "$STAGE_DIR/indexed-validation.json" <<'PY'
import json, sys
source, indexed = (json.load(open(item)) for item in sys.argv[1:])
if source['tables'] != indexed['tables']:
    raise SystemExit('indexed table counts differ from the validated staged source')
PY

log "building disposable server bundle for static prebake"
bash -lc "source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate '$CONDA_ENV' && cd '$STATIC_ROOT' && npm run build"
SERVER_LOG="$STAGE_DIR/static-prebake-server.log"
(
  source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh
  conda activate "$CONDA_ENV"
  cd "$STATIC_ROOT"
  SQLITE_PATH="$DEST_DB" exec npm start -- -H 127.0.0.1 -p "$TEMP_PORT"
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
for _ in {1..120}; do
  if curl --fail --silent --show-error "http://127.0.0.1:$TEMP_PORT/api/health" >/dev/null; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -n 50 "$SERVER_LOG" >&2 || true; fail "disposable prebake server exited"; }
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:$TEMP_PORT/api/health" >/dev/null || fail "disposable prebake server was not healthy"

log "prebaking and verifying one static snapshot"
(
  source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh
  conda activate "$CONDA_ENV"
  cd "$STATIC_ROOT"
  # prebake validates the HTTPVFS identity, so prepare it first from this exact DB.
  SRC="$DEST_DB" bash scripts/prepare-httpvfs-db.sh
  BASE="http://127.0.0.1:$TEMP_PORT" SRC="$DEST_DB" node scripts/prebake.mjs
  BASE="http://127.0.0.1:$TEMP_PORT" SRC="$DEST_DB" node scripts/verify-static-parity.mjs
  rm -rf out
  BASE_PATH=/annotation/projects/aiale-dev bash scripts/build-static.sh
)
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
unset SERVER_PID

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK="$ROLLBACK_DIR/static-before-$STAMP"
log "retaining rollback copy at $ROLLBACK"
mkdir -p "$ROLLBACK"
rsync -a --no-perms --omit-dir-times "$WEBROOT/" "$ROLLBACK/"
ROLLBACK_READY=1
log "publishing static bundle to approved webroot contents"
WEBROOT_TOUCHED=1
rsync -a --delete --no-perms --omit-dir-times "$STATIC_ROOT/out/" "$WEBROOT/"
find "$WEBROOT" -mindepth 1 -type d -exec chmod 755 {} +
find "$WEBROOT" -mindepth 1 -type f -exec chmod 644 {} +

log "checking deployed HTTPS root, manifest, and HTTP range support"
curl --fail --silent --show-error "$PUBLIC_URL/" >/dev/null
curl --fail --silent --show-error "$PUBLIC_URL/data/manifest.json" > "$STAGE_DIR/deployed-manifest.json"
RANGE_HEADERS="$(curl --fail --silent --show-error -D - -o /dev/null -H 'Range: bytes=0-99' "$PUBLIC_URL/db/lims.db")"
printf '%s\n' "$RANGE_HEADERS" | grep -qi '^HTTP/.* 206' || fail "deployed HTTPVFS database did not return HTTP 206 to a range request"
DEPLOYED_SHA="$(json_field "$STAGE_DIR/deployed-manifest.json" snapshot.sha256)"
INDEXED_SHA="$(json_field "$STAGE_DIR/indexed-validation.json" sha256)"
[[ "$DEPLOYED_SHA" == "$INDEXED_SHA" ]] || fail "deployed manifest hash does not match indexed snapshot"

if ((INCLUDE_DYNAMIC)); then
  DYNAMIC_SCRIPT="$DYNAMIC_ROOT/ops/auto-refresh-release.sh"
  [[ -x "$DYNAMIC_SCRIPT" ]] || fail "dynamic companion is unavailable: $DYNAMIC_SCRIPT"
  "$DYNAMIC_SCRIPT" --dynamic-only --accepted-snapshot "$STAGE_DIR/source-validation.json"
fi

python3 - "$STATE_FILE" "$STAGE_DIR/source-validation.json" "$STAGE_DIR/indexed-validation.json" "$PUBLIC_URL" "$INCLUDE_DYNAMIC" <<'PY'
import json, os, sys, tempfile
state_path, source_path, indexed_path, url, include_dynamic = sys.argv[1:]
source, indexed = json.load(open(source_path)), json.load(open(indexed_path))
state = {
  'accepted': {
    'sha256': source['sha256'], 'bytes': source['bytes'], 'mtimeEpoch': source['mtimeEpoch'],
    'validatedAt': source['validatedAt'], 'tableCounts': source['tables'],
  },
  'indexed': {'sha256': indexed['sha256'], 'bytes': indexed['bytes'], 'validatedAt': indexed['validatedAt']},
  'static': {'url': url, 'releasedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00', 'Z')},
  'dynamicIncluded': include_dynamic == '1',
}
fd, temp = tempfile.mkstemp(prefix='.state.', dir=os.path.dirname(state_path))
with os.fdopen(fd, 'w') as handle: json.dump(state, handle, indent=2, sort_keys=True); handle.write('\n')
os.replace(temp, state_path)
PY
log "release accepted sha256=$SOURCE_SHA"
