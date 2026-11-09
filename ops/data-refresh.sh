#!/usr/bin/env bash
# Refresh one named local static source asset from an explicit SQLite mirror.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROFILE=""; SOURCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:?missing profile}"; shift 2 ;;
    --source) SOURCE="${2:?missing source}"; shift 2 ;;
    -h|--help) echo "Usage: ops/data-refresh.sh --profile trimmed|full --source /path/to/mirror.db"; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$PROFILE" in
  trimmed) DEST="data/lims_TFMN1_indexed.db" ;;
  full) DEST="data/lims_indexed.db" ;;
  *) echo "ERROR: --profile must be trimmed or full" >&2; exit 2 ;;
esac
[[ -n "$SOURCE" && -f "$SOURCE" ]] || { echo "ERROR: --source must name an existing database" >&2; exit 2; }
mkdir -p data/archive
TMP="$DEST.tmp.$$"
trap 'rm -f "$TMP"' EXIT
cp --reflink=auto "$SOURCE" "$TMP"
python3 - "$TMP" <<'PY'
import sqlite3, sys
p = sys.argv[1]
con = sqlite3.connect(p)
try:
    result = con.execute('PRAGMA integrity_check').fetchone()
    if not result or result[0].lower() != 'ok': raise SystemExit(f'integrity_check failed: {result!r}')
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    if not tables or not any(con.execute('SELECT COUNT(*) FROM "' + t.replace('"','""') + '"').fetchone()[0] for t in tables): raise SystemExit('database has no populated user tables')
    plans = [("Mutations", "ix_mut_exp_reg", ["Experiment", "Breseq_registry_ID", "deleted"]), ("Mutations", "ix_mut_seqsample", ["Seq_sample", "deleted"]), ("Robotic_OD", "ix_rod_sample", ["sample_name", "transfer", "deleted"]), ("Copy_numbers", "ix_cn_seq", ["Seqsample", "deleted"]), ("Measurements", "ix_meas_sample", ["Sample_ID", "deleted"]), ("verAB_barcodes", "ix_vab_deleted", ["deleted"])]
    for table, name, cols in plans:
        info = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
        if table in tables and set(cols) <= info:
            con.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({", ".join(chr(34)+c+chr(34) for c in cols)})')
    con.execute('ANALYZE'); con.commit()
finally: con.close()
PY
if [[ -f "$DEST" ]]; then cp --reflink=auto "$DEST" "data/archive/$(basename "$DEST" .db).before-refresh.$(date -u +%Y%m%dT%H%M%SZ).db"; fi
mv -f "$TMP" "$DEST"
trap - EXIT
python3 ops/validate.py --profile "$PROFILE"
printf 'refreshed %s from %s\n' "$DEST" "$SOURCE"
