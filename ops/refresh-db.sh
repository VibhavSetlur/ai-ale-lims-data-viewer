#!/usr/bin/env bash
# refresh-db.sh — build a fast, locally-indexed copy of the read-only LIMS mirror.
#
# WHY: the upstream mirror (SOURCE_DB) is a 251MB SQLite file with ZERO indexes
# and lives on a read-only share, so every query in the viewer was a full table
# scan (Mutations 223k rows, Robotic_OD 141k rows -> 19-60s page loads). We can't
# write indexes to the source, so we keep our own indexed copy here and point the
# app at it via SQLITE_PATH. Re-run this whenever the upstream mirror updates.
#
# Usage: ops/refresh-db.sh [SOURCE_DB] [DEST_DB]
set -euo pipefail

SOURCE_DB="${1:-/scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db}"
DEST_DB="${2:-/scratch/vsetlur/ai-ale-lims-data-viewer/data/lims_indexed.db}"
TMP_DB="${DEST_DB}.tmp.$$"
DEST_DIR="$(dirname "$DEST_DB")"
DEST_BASE="$(basename "$DEST_DB" .db)"
ARCHIVE_DIR="$DEST_DIR/archive"
ARCHIVE_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST_DIR" "$ARCHIVE_DIR"

archive_db() {
  local label="$1"
  local src="$2"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  local dst="$ARCHIVE_DIR/${DEST_BASE}.${label}.${ARCHIVE_STAMP}.db"
  echo "[refresh-db] archiving $label DB: $dst"
  cp -p "$src" "$dst"
}

if [[ ! -f "$SOURCE_DB" ]]; then
  echo "ERROR: source DB not found: $SOURCE_DB" >&2
  exit 1
fi

echo "[refresh-db] source: $SOURCE_DB ($(du -h "$SOURCE_DB" | cut -f1))"
archive_db "before-refresh" "$DEST_DB"
echo "[refresh-db] copying to temp: $TMP_DB"
cp "$SOURCE_DB" "$TMP_DB"

echo "[refresh-db] building indexes (idempotent, IF NOT EXISTS)..."
python3 - "$TMP_DB" <<'PY'
import sqlite3, sys, time
db = sys.argv[1]
con = sqlite3.connect(db)
con.execute("PRAGMA journal_mode=OFF")
con.execute("PRAGMA synchronous=OFF")

def cols(table):
    try:
        return {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
    except sqlite3.OperationalError:
        return set()

def has_table(t):
    return con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (t,)
    ).fetchone() is not None

# (table, index_name, [columns]) — only built if the table and all columns exist.
plan = [
    ("Mutations", "ix_mut_exp_reg",  ["Experiment", "Breseq_registry_ID", "deleted"]),
    ("Mutations", "ix_mut_seqsample", ["Seq_sample", "deleted"]),
    ("Mutations", "ix_mut_reg",      ["Breseq_registry_ID", "deleted"]),
    ("Mutations", "ix_mut_deleted",  ["deleted"]),
    ("Seq_samples", "ix_seqs_seq",   ["Sequencing_sample", "deleted"]),
    ("Seq_samples", "ix_seqs_name",  ["Sample_Name", "deleted"]),
    ("Samples", "ix_samp_name",      ["Name", "deleted"]),
    ("Experiments", "ix_exp_name",   ["Name", "deleted"]),
    ("Breseq_registry", "ix_breg_id", ["ID", "deleted"]),
    ("Robotic_OD", "ix_rod_sample",  ["sample_name", "transfer", "deleted"]),
    ("Robotic_OD", "ix_rod_deleted", ["deleted"]),
    ("Copy_numbers", "ix_cn_seq",    ["Seqsample", "deleted"]),
    ("Measurements", "ix_meas_sample", ["Sample_ID", "deleted"]),
    ("verAB_barcodes", "ix_vab_deleted", ["deleted"]),
]

built, skipped = 0, 0
for table, name, columns in plan:
    if not has_table(table):
        print(f"  skip {name}: no table {table}")
        skipped += 1
        continue
    tcols = cols(table)
    missing = [c for c in columns if c not in tcols]
    if missing:
        print(f"  skip {name}: {table} missing {missing}")
        skipped += 1
        continue
    collist = ", ".join(f'"{c}"' for c in columns)
    t0 = time.time()
    con.execute(f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({collist})')
    print(f"  built {name} on {table}({collist}) in {time.time()-t0:.1f}s")
    built += 1

print("[refresh-db] ANALYZE...")
con.execute("ANALYZE")
con.commit()
con.close()
print(f"[refresh-db] done: {built} indexes built, {skipped} skipped")
PY

echo "[refresh-db] atomic swap into place: $DEST_DB"
mv -f "$TMP_DB" "$DEST_DB"
archive_db "after-refresh" "$DEST_DB"
echo "[refresh-db] OK -> $DEST_DB ($(du -h "$DEST_DB" | cut -f1))"
echo "[refresh-db] point the app at it:  SQLITE_PATH=$DEST_DB"
