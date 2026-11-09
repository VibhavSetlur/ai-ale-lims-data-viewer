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
python3 ops/validate.py --source "$PWD/data/$([[ "$TARGET" == aiale ]] && echo lims_TFMN1_indexed.db || echo lims_indexed.db)" --release "$PWD/.local/releases/$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["profile"])' "$MANIFEST")" --out "$BUNDLE" --target "$TARGET" --root-path "$EXPECTED_BASE" >/tmp/static-deploy-validate.json
if (( DRY_RUN || ! APPLY )); then
  echo "dry run only: would rsync bundle contents to $DEST"
  echo "use --apply to perform the deployment"
  rsync -rltcn --delete --omit-dir-times --no-perms --no-owner --no-group "$BUNDLE/" "$DEST/" | sed -n '1,80p'
  exit 0
fi
[[ -d "$DEST" ]] || { echo "ERROR: approved webroot does not exist: $DEST" >&2; exit 1; }
BACKUP="${DEST}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$BACKUP"
rsync -rlt --delete --omit-dir-times --no-perms --no-owner --no-group "$DEST/" "$BACKUP/"
rsync -rlt --delete --omit-dir-times --no-perms --no-owner --no-group "$BUNDLE/" "$DEST/"
find "$DEST" -type f -exec chmod 644 {} +
find "$DEST" -mindepth 1 -type d -exec chmod 755 {} +
printf 'deployed %s to %s\nbackup=%s\n' "$BUNDLE" "$DEST" "$BACKUP"
