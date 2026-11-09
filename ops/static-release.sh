#!/usr/bin/env bash
# Build one selected static data profile for one independently selected target.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROFILE=""
TARGET=""
ROOT_PATH=""
DRY_RUN=0
CHANNEL="${RELEASE_CHANNEL:-static-dev}"
PORT="${RELEASE_PORT:-0}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:?missing profile}"; shift 2 ;;
    --target) TARGET="${2:?missing target}"; shift 2 ;;
    --root-path) ROOT_PATH="${2:?missing root path}"; shift 2 ;;
    --channel) CHANNEL="${2:?missing channel}"; shift 2 ;;
    --port) PORT="${2:?missing port}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$PROFILE" && -n "$TARGET" ]] || { echo "ERROR: --profile and --target are required" >&2; exit 2; }
case "$PROFILE" in
  trimmed) SOURCE_DB="data/lims_TFMN1_indexed.db" ;;
  full) SOURCE_DB="data/lims_indexed.db" ;;
  *) echo "ERROR: profile must be trimmed or full" >&2; exit 2 ;;
esac
case "$TARGET" in
  aiale) ROOT_PATH="${ROOT_PATH:-/annotation/projects/aiale}" ;;
  aiale-dev) ROOT_PATH="${ROOT_PATH:-/annotation/projects/aiale-dev}" ;;
  kind) ROOT_PATH="${ROOT_PATH:-}" ;;
  *) echo "ERROR: target must be aiale, aiale-dev, or kind" >&2; exit 2 ;;
esac
case "$CHANNEL" in static|static-dev) ;; *) echo "ERROR: channel must be static or static-dev" >&2; exit 2 ;; esac
[[ -f "$SOURCE_DB" ]] || { echo "ERROR: source DB not found: $SOURCE_DB" >&2; exit 1; }
if [[ "$PORT" == "0" ]]; then
  PORT="$(python3 - <<'PY'
import socket
with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    print(s.getsockname()[1])
PY
)"
fi
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "ERROR: release port $PORT is already listening; choose --port or retry" >&2
  exit 2
fi

RELEASE_DIR=".local/releases/$PROFILE"
DATA_DIR="$RELEASE_DIR/data"
DB_DIR="$RELEASE_DIR/db"
OUT_DIR="$RELEASE_DIR/out"
SOURCE_ABS="$(realpath "$SOURCE_DB")"
SOURCE_SHA256="$(sha256sum "$SOURCE_ABS" | awk '{print $1}')"

if (( DRY_RUN )); then
  python3 ops/validate.py --source "$SOURCE_ABS" --profile "$PROFILE"
  printf 'release plan: profile=%s target=%s root_path=%q channel=%s source=%s sha256=%s release_dir=%s\n' "$PROFILE" "$TARGET" "$ROOT_PATH" "$CHANNEL" "$SOURCE_DB" "$SOURCE_SHA256" "$RELEASE_DIR"
  exit 0
fi

mkdir -p "$DATA_DIR" "$DB_DIR"
rm -rf "$DATA_DIR"/* "$DB_DIR"/* "$OUT_DIR"
cp -p "$SOURCE_ABS" "$DATA_DIR/source.db"

# Generated public directories are temporarily linked to this profile. Restore them
# exactly, including absence, when the operation exits.
PUBLIC_DATA="public/data"; PUBLIC_DB="public/db"
OLD_DATA=".local/.public-data.$$"; OLD_DB=".local/.public-db.$$"
restore() {
  set +e
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  wait "${SERVER_PID:-}" 2>/dev/null || true
  rm -rf "$PUBLIC_DATA" "$PUBLIC_DB"
  [[ -e "$OLD_DATA" || -L "$OLD_DATA" ]] && mv "$OLD_DATA" "$PUBLIC_DATA"
  [[ -e "$OLD_DB" || -L "$OLD_DB" ]] && mv "$OLD_DB" "$PUBLIC_DB"
}
trap restore EXIT
mkdir -p .local
[[ -e "$PUBLIC_DATA" || -L "$PUBLIC_DATA" ]] && mv "$PUBLIC_DATA" "$OLD_DATA"
[[ -e "$PUBLIC_DB" || -L "$PUBLIC_DB" ]] && mv "$PUBLIC_DB" "$OLD_DB"
ln -s "$(realpath --relative-to=public "$DATA_DIR")" "$PUBLIC_DATA"
ln -s "$(realpath --relative-to=public "$DB_DIR")" "$PUBLIC_DB"

# Build an isolated indexed HTTPVFS copy and snapshot API responses from the exact DB.
SRC="$SOURCE_ABS" DBDIR="$DB_DIR" bash scripts/prepare-httpvfs-db.sh
SQLITE_PATH="$SOURCE_ABS" bash -lc "npm run build >/dev/null"
SQLITE_PATH="$SOURCE_ABS" PORT="$PORT" HOST=127.0.0.1 npm start -- -p "$PORT" >"$RELEASE_DIR/server.log" 2>&1 &
SERVER_PID=$!
READY=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then READY=1; break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "ERROR: build server exited before becoming ready" >&2
    cat "$RELEASE_DIR/server.log" >&2 || true
    exit 1
  fi
  sleep 1
done
if (( ! READY )); then
  echo "ERROR: build server did not become ready on port $PORT" >&2
  cat "$RELEASE_DIR/server.log" >&2 || true
  exit 1
fi
BASE="http://127.0.0.1:$PORT"
python3 ops/verify-server-source.py --base "$BASE" --source "$SOURCE_ABS"
SRC="$SOURCE_ABS" BASE="$BASE" OUT="$DATA_DIR" DBDIR="$DB_DIR" PROFILE="$PROFILE" TARGET="$TARGET" ROOT_PATH="$ROOT_PATH" node scripts/prebake.mjs
kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; unset SERVER_PID

# Build the selected target with a truthful branch/channel identity.
rm -rf out
STATIC_DEVELOPMENT=1 BASE_PATH="$ROOT_PATH" DEPLOYMENT_CHANNEL="$CHANNEL" DEPLOYMENT_BRANCH="$CHANNEL" DATA_PROFILE="$PROFILE" RELEASE_TARGET="$TARGET" bash scripts/build-static.sh
cp -a out "$OUT_DIR"
python3 ops/validate.py --source "$SOURCE_ABS" --profile "$PROFILE" --release "$RELEASE_DIR" --out out --target "$TARGET" --root-path "$ROOT_PATH"
printf 'static release ready: profile=%s target=%s out=%s\n' "$PROFILE" "$TARGET" "$PWD/out"
