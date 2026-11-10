#!/usr/bin/env bash
# Deploy an already-built, validated out/ bundle to one approved ModelSEED webroot.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARGET=""
PROFILE=""
BUNDLE="out"
APPLY=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:?missing target}"; shift 2 ;;
    --profile) PROFILE="${2:?missing profile}"; shift 2 ;;
    --bundle) BUNDLE="${2:?missing bundle}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      echo "Usage: ops/deploy-static.sh --target aiale|aiale-dev [--bundle out] --dry-run"
      echo "       ops/deploy-static.sh --target aiale|aiale-dev [--bundle out] --apply"
      exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TARGET" && -n "$PROFILE" ]] || { echo "ERROR: --target and --profile are required" >&2; exit 2; }
case "$PROFILE" in trimmed|full) ;; *) echo "ERROR: --profile must be trimmed or full" >&2; exit 2 ;; esac
case "$TARGET" in
  aiale) EXPECTED_BASE="/annotation/projects/aiale"; DEST="/scratch1/fliu/html/modelseed_annotation/projects/aiale" ;;
  aiale-dev) EXPECTED_BASE="/annotation/projects/aiale-dev"; DEST="/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev" ;;
  *) echo "ERROR: deployment target must be aiale or aiale-dev" >&2; exit 2 ;;
esac
BUNDLE="$(realpath "$BUNDLE")"
MANIFEST="$BUNDLE/data/manifest.json"
[[ -d "$BUNDLE" && -f "$BUNDLE/index.html" && -f "$MANIFEST" ]] || { echo "ERROR: bundle is incomplete: $BUNDLE" >&2; exit 1; }
python3 - "$MANIFEST" "$TARGET" "$EXPECTED_BASE" <<'PY'
import json, sys
manifest, target, base = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
if manifest.get('target') != target: raise SystemExit(f"bundle target {manifest.get('target')!r} != {target!r}")
if manifest.get('basePath') != base: raise SystemExit(f"bundle basePath {manifest.get('basePath')!r} != {base!r}")
if manifest.get('profile') not in {'trimmed', 'full'}: raise SystemExit('bundle has no valid data profile')
print(f"bundle: profile={manifest['profile']} target={target} basePath={base} sha256={manifest.get('snapshot', {}).get('sha256')}")
PY
BUNDLE_PROFILE="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["profile"])' "$MANIFEST")"
case "$BUNDLE_PROFILE" in
  trimmed) SOURCE_DB="$PWD/data/lims_TFMN1_indexed.db" ;;
  full) SOURCE_DB="$PWD/data/lims_indexed.db" ;;
  *) echo "ERROR: bundle has no valid data profile" >&2; exit 1 ;;
esac
RELEASE_DIR="$PWD/.local/releases/$BUNDLE_PROFILE"
RELEASE_SOURCE="$RELEASE_DIR/data/source.db"
if [[ -f "$RELEASE_SOURCE" ]]; then SOURCE_DB="$RELEASE_SOURCE"; fi
VALIDATION_REPORT="/tmp/opencode/static-deploy-validate-${TARGET}-${BUNDLE_PROFILE}.json"
python3 ops/validate.py --source "$SOURCE_DB" --release "$RELEASE_DIR" --out "$BUNDLE" --target "$TARGET" --root-path "$EXPECTED_BASE" >"$VALIDATION_REPORT"
printf 'validated bundle: profile=%s source=%s report=%s\n' "$BUNDLE_PROFILE" "$SOURCE_DB" "$VALIDATION_REPORT"
if (( DRY_RUN || ! APPLY )); then
  echo "dry run only: would rsync bundle contents to $DEST"
  echo "use --apply to perform the deployment"
  rsync -rltcn --delete --omit-dir-times --no-perms --no-owner --no-group "$BUNDLE/" "$DEST/" | sed -n '1,80p'
  exit 0
fi
[[ -d "$DEST" ]] || { echo "ERROR: approved webroot does not exist: $DEST" >&2; exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${DEST}.backup.${STAMP}"
if ! mkdir "$BACKUP" 2>/dev/null; then
  BACKUP="/scratch/vsetlur/tmp/ai-ale-static-backup-${TARGET}-${STAMP}"
  mkdir "$BACKUP"
  echo "webroot parent is not writable; using local rollback backup: $BACKUP" >&2
fi
rsync -rlt --delete --omit-dir-times --no-perms --no-owner --no-group "$DEST/" "$BACKUP/"
rsync -rlt --delete --omit-dir-times --no-perms --no-owner --no-group "$BUNDLE/" "$DEST/"
find "$DEST" -type f -exec chmod 644 {} +
find "$DEST" -mindepth 1 -type d -exec chmod 755 {} +
printf 'deployed %s to %s\nbackup=%s\n' "$BUNDLE" "$DEST" "$BACKUP"
