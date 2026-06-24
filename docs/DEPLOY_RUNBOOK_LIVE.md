# AI-ALE static deploy: live runbook (modelseed.org/annotation/projects/aiale)

This is the EXACT, verified procedure that put the viewer live at
https://modelseed.org/annotation/projects/aiale/ on 2026-06-24. Use it to
re-deploy after a LIMS DB refresh.

## Facts confirmed with Filipe (fliu)
- Webroot:  /scratch1/fliu/html/modelseed_annotation/projects/aiale/
- URL:      https://modelseed.org/annotation/projects/aiale/
- "the folder will be the url" - the folder contents ARE served at that URL.
- /annotation is fliu's separate nginx conduit (not the main modelseed.org).
- The folder is owned by fliu, group `cels`, group-writable; vsetlur (in cels)
  can write files into it. The folder itself is fliu's; do not try to chmod it.

## CRITICAL gotcha (caused a 403): file permissions
nginx runs as a different user and must be able to READ every file. Files
created with a restrictive umask land as 600 (-rw-------) and nginx returns
403 Forbidden. EVERY deploy MUST end with:
    find <webroot> -type d -exec chmod 755 {} \;
    find <webroot> -type f -exec chmod 644 {} \;
(The top-level folder chmod will say "Operation not permitted" because fliu owns
it - that's fine, it's already group-accessible. Only the files/subdirs we add
need 644/755.)

## Full re-deploy procedure
Run from /scratch/vsetlur/ai-ale-lims-data-viewer with the conda env active and
the SERVER running (ops/serve.sh) so prebake can snapshot the live API.

```bash
cd /scratch/vsetlur/ai-ale-lims-data-viewer
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev
export PATH="$HOME/.local/bin:$PATH"

# 1. confirm the server is up (prebake reads it)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3457/api/health   # 200

# 2. bake fresh curated-view data artifacts from the current DB
npm run prebake

# 3. build the client-queryable SQLite for the raw Tables browser (sql.js-httpvfs)
bash scripts/prepare-httpvfs-db.sh        # -> public/db/lims.db + worker + wasm + config

# 4. build the static bundle with the production base path
rm -rf out
BASE_PATH=/annotation/projects/aiale npm run build:static     # -> out/  (~241MB incl DB)

# 5. publish into Filipe's webroot (clear old, copy new)
DST=/scratch1/fliu/html/modelseed_annotation/projects/aiale
find "$DST" -mindepth 1 -delete 2>/dev/null || rm -rf "$DST"/* "$DST"/.[!.]*
cp -r out/. "$DST"/

# 6. MANDATORY perms fix (or nginx 403s)
find "$DST" -type d -exec chmod 755 {} \; 2>/dev/null
find "$DST" -type f -exec chmod 644 {} \;

# 7. verify the live URL (root, curated data, AND the DB range request)
curl -s -o /dev/null -w "root: %{http_code}\n" https://modelseed.org/annotation/projects/aiale/
curl -s -o /dev/null -w "data: %{http_code}\n" https://modelseed.org/annotation/projects/aiale/data/manifest.json
curl -s -D - -o /dev/null -H "Range: bytes=0-99" https://modelseed.org/annotation/projects/aiale/db/lims.db | grep -i "206\|content-range"
```
Expect 200 for root + data, and "206 Partial Content" for the DB range request
(this is what makes the deep table querying work). The page should show the
curated views AND a Database Tables browser where you can deep-filter/sort/search
any table, including 223k-row Mutations.

## How the deep table querying works (sql.js-httpvfs)
The raw Database Tables browser runs REAL SQL in the browser against
`db/lims.db` via sql.js-httpvfs, which fetches only the byte ranges (DB pages) a
query touches over HTTP range requests. The DB ships with 14 indexes and 64KB
pages so deep queries touch few pages. REQUIRES the host to serve the .db file
with `Accept-Ranges: bytes` (verified on modelseed.org/annotation: returns 206).
If a future host does NOT support range requests, the table browser breaks (it
would try to download the whole 220MB) - check with the Range curl above.

## Guardrail note
Writing into /scratch1/fliu/... is normally OFF LIMITS. It is allowed HERE only
because Filipe explicitly created this folder, granted perms, and asked us to
place + test the files. Do not write anywhere else in fliu's space. If perms are
ever revoked, switch to handing fliu the `out/` folder for him to copy.

## Stale-chunk note
Next.js content-hashes its JS/CSS, so old chunks from a previous deploy are
harmless but accumulate. Optionally `rm -rf "$DST"/*` before step 4 to keep the
folder clean (we own the files inside, just not the folder). Always re-run the
perms fix afterward.
