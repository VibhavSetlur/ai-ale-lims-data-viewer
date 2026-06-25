# AI-ALE static deploy: live runbook (BOTH instances)

The EXACT, verified procedure to (re)deploy the two live static instances after a
LIMS DB refresh. Both are built from the same codebase; they differ ONLY in which
database is baked in.

## The two instances

| Instance | URL | Webroot | Database baked in | Barcode tab |
|---|---|---|---|---|
| PUBLIC (publication snapshot) | https://modelseed.org/annotation/projects/aiale/ | /scratch1/fliu/html/modelseed_annotation/projects/aiale/ | TFMN1 trimmed (`data/lims_TFMN1_indexed.db`) | hidden (no barcode data) |
| PRIVATE (internal, unlisted) | https://modelseed.org/annotation/projects/aiale-06-25-2026/ | /scratch1/fliu/html/modelseed_annotation/projects/aiale-06-25-2026/ | full (`data/lims_indexed.db`) | shown |

The Barcode tab visibility is automatic: the viewer reads `stats.hasBarcodes` from the
baked data, which is true only when the database has a non-empty `verAB_barcodes` table.
The TFMN1 trimmed DB omits that table, so the public instance hides the tab. See
`ARCHITECTURE.md` section 3.

## Facts confirmed with Filipe (fliu)
- /annotation is fliu's separate nginx conduit. "The folder is the url" - folder contents
  are served at that URL.
- Both webroots are owned by fliu, group `cels`, group-writable; vsetlur (in `cels`) can
  write FILES into them but does NOT own the directories (cannot chmod the top dir).

## CRITICAL gotchas
1. PERMISSIONS (causes 403): nginx must READ every file. Files created with a restrictive
   umask land as 600 and nginx returns 403. EVERY deploy MUST end with files 644 / dirs 755
   on the webroot CONTENTS (not the top dir, which fliu owns).
2. STATIC BUILD POISONS SERVER MODE: `build:static` leaves a `.next` with
   `exportTrailingSlash: true`; running `npm start` on it 404s all API routes. The tooling
   auto-cleans this (`build-static.sh` clears `.next`, `serve.sh` rebuilds clean), but if
   you ever see "root 200 but every /api 404 with a 308", that is the cause.

## Prerequisite: indexed DB copies

Keep two indexed local copies (built once, refreshed when upstream changes):

```bash
cd /scratch/vsetlur/ai-ale-lims-data-viewer
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev

# full mirror -> data/lims_indexed.db
ops/refresh-db.sh /scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db data/lims_indexed.db

# TFMN1 trimmed mirror -> data/lims_TFMN1_indexed.db  (N. Spahr produces the trimmed source)
ops/refresh-db.sh /scratch1/fliu/hub_scratch/synbio/lims_mirror_TFMN1.db data/lims_TFMN1_indexed.db
```

## Re-deploy procedure (run for EACH instance)

The only differences per instance are: which DB the server runs on before baking, the
`SRC` for the httpvfs DB, the `BASE_PATH`, and the destination webroot. Set these four
and the rest is identical.

```bash
cd /scratch/vsetlur/ai-ale-lims-data-viewer
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev
export PATH="$HOME/.local/bin:$PATH"

# ---- choose ONE instance ----
# PUBLIC (TFMN1 trimmed):
DB=data/lims_TFMN1_indexed.db; BP=/annotation/projects/aiale;            DST=/scratch1/fliu/html/modelseed_annotation/projects/aiale
# PRIVATE (full):
# DB=data/lims_indexed.db;     BP=/annotation/projects/aiale-06-25-2026; DST=/scratch1/fliu/html/modelseed_annotation/projects/aiale-06-25-2026

# 1. point the server at this instance's DB and (re)start it
./ops/stop.sh 2>/dev/null; sleep 1
SQLITE_PATH="$PWD/$DB" ./ops/serve.sh; sleep 6
curl -s http://localhost:3457/api/health     # confirm "path" is the DB you intend

# 2. bake curated-view data from THIS db (capability flags like hasBarcodes are baked here)
npm run prebake

# 3. build the client-queryable SQLite for the raw Tables browser, FROM THIS db
SRC="$DB" bash scripts/prepare-httpvfs-db.sh   # -> public/db/lims.db + worker + wasm + config

# 4. build the static bundle with this instance's base path
rm -rf out
BASE_PATH="$BP" npm run build:static           # -> out/

# 5. publish: mirror out/ into the webroot. rsync --delete keeps it clean; --no-perms
#    avoids trying to chmod fliu's top dir (which we do not own).
rsync -a --delete --no-perms --omit-dir-times out/ "$DST/"

# 6. MANDATORY perms fix on CONTENTS only (or nginx 403s)
find "$DST" -mindepth 1 -type d -exec chmod 755 {} \; 2>/dev/null
find "$DST" -mindepth 1 -type f -exec chmod 644 {} \;

# 7. verify
curl -s -o /dev/null -w "root: %{http_code}\n" "https://modelseed.org$BP/"
curl -s -o /dev/null -w "data: %{http_code}\n" "https://modelseed.org$BP/data/manifest.json"
curl -s -D - -o /dev/null -H "Range: bytes=0-99" "https://modelseed.org$BP/db/lims.db" | grep -i 206
python3 -c "import json,urllib.request as u; print('hasBarcodes:', json.load(u.urlopen('https://modelseed.org$BP/data/mutations__experiment_TFMN1.json'))['stats'].get('hasBarcodes'))"
```

Expect: root + data = 200, DB range = "206 Partial Content", and `hasBarcodes` matching
the instance (False for public/TFMN1, True for private/full). Then repeat the block for the
OTHER instance.

## How the deep table querying works (sql.js-httpvfs)
The raw Database Tables browser runs REAL SQL in the browser against `db/lims.db` via
sql.js-httpvfs, which fetches only the byte ranges (DB pages) a query touches over HTTP
range requests. REQUIRES the host to serve the .db with `Accept-Ranges: bytes` (verified
on modelseed.org/annotation: returns 206). If a future host lacks range support, the table
browser breaks - check with the Range curl above.

## Guardrail
Writing into /scratch1/fliu/... is normally OFF LIMITS. It is allowed for these two
folders ONLY because Filipe created them, granted perms, and asked us to place the files.
Do not write anywhere else in fliu's space. If perms are revoked, hand fliu the `out/`
folder to copy.
