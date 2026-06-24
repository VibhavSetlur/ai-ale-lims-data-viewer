#!/usr/bin/env bash
# prepare-httpvfs-db.sh — build the client-queryable SQLite for sql.js-httpvfs.
#
# The STATIC build queries the real LIMS DB IN THE BROWSER via sql.js-httpvfs,
# which fetches only the byte ranges it needs over HTTP range requests (verified
# supported on modelseed.org/annotation). This gives deep SQL (filter/sort/search
# on any table, including the 223k-row Mutations) with NO server.
#
# What this does:
#   1. Copies the indexed mirror to public/db/lims.db
#   2. Re-pages it to PAGE_SIZE (bigger pages = fewer HTTP requests per query)
#      and VACUUMs so it is contiguous and index-dense.
#   3. Copies the sql.js-httpvfs worker + wasm next to it.
#   4. Writes public/db/config.json describing the DB for the client.
#
# Run after the indexed DB is refreshed. Output goes in public/db/ which the
# static export copies into out/db/.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${SRC:-data/lims_indexed.db}"
DBDIR="public/db"
PAGE_SIZE="${PAGE_SIZE:-65536}"   # 64KB pages: far fewer range requests for big scans

if [ ! -f "$SRC" ]; then echo "source DB not found: $SRC" >&2; exit 1; fi

mkdir -p "$DBDIR"
echo "re-paging $SRC -> $DBDIR/lims.db at page_size=$PAGE_SIZE ..."
# Use Python sqlite3 (the sqlite3 CLI is not installed on this host).
python3 - "$SRC" "$DBDIR/lims.db" "$PAGE_SIZE" <<'PY'
import sqlite3, sys, os
src, dst, page = sys.argv[1], sys.argv[2], int(sys.argv[3])
if os.path.exists(dst): os.remove(dst)
con = sqlite3.connect(src)
con.execute(f"PRAGMA page_size={page}")
# VACUUM INTO writes a fresh, defragmented copy applying the new page_size.
con.execute("PRAGMA journal_mode=DELETE")
con.execute(f"VACUUM INTO '{dst}'")
con.close()
# confirm
c = sqlite3.connect(dst)
ps = c.execute("PRAGMA page_size").fetchone()[0]
pc = c.execute("PRAGMA page_count").fetchone()[0]
print(f"  built {dst}: page_size={ps} page_count={pc} bytes={ps*pc}")
c.close()
PY

echo "copying sql.js-httpvfs worker + wasm ..."
cp node_modules/sql.js-httpvfs/dist/sqlite.worker.js "$DBDIR/"
cp node_modules/sql.js-httpvfs/dist/sql-wasm.wasm "$DBDIR/"

# config.json: serverMode = the whole DB is one file we range-request.
BYTES=$(stat -c %s "$DBDIR/lims.db")
cat > "$DBDIR/config.json" <<JSON
{
  "serverMode": "full",
  "requestChunkSize": $PAGE_SIZE,
  "databaseLengthBytes": $BYTES,
  "url": "lims.db"
}
JSON

echo "done. public/db/ contents:"
ls -lh "$DBDIR"
echo
echo "NOTE: lims.db is large (~240MB) but the browser only range-fetches the"
echo "pages a query touches, thanks to the indexes. Ensure the host serves it"
echo "with Accept-Ranges: bytes (verified on modelseed.org/annotation)."
