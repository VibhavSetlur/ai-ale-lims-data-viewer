# Architecture

AI-ALE LIMS Data Viewer - system design and the data-driven dual-deployment model.

This document is the authoritative description of how the viewer is built, how it is
deployed, and how a single codebase serves multiple audience-scoped instances. It is
written to be citable from the robotic-experiment paper.

## 1. What this is

A web viewer over the AI-ALE (Adaptive Laboratory Evolution) LIMS database. It presents
breseq mutation calls, copy-number amplification trajectories, robot-measured OD growth
curves, and verAB barcode-frequency charts for engineered Acinetobacter strains evolved
in the robotic ALE platform. It is read-only: it never writes to the LIMS.

## 2. One codebase, two run modes

The same Next.js (App Router, TypeScript) codebase runs in two modes from one source tree:

| Mode | Command | What it is | Where it runs |
|---|---|---|---|
| SERVER | `npm run build && npm start` | Full app. API routes query a SQLite mirror at request time. Includes the raw Database-Tables browser and live CSV export. | Internal host (poplar:3457) behind nginx |
| STATIC | `npm run build:static` -> `out/` | No server. Curated views read PRE-BAKED gzipped JSON; the raw table browser runs SQLite IN THE BROWSER via sql.js-httpvfs (HTTP range requests against a static .db). | modelseed.org static webroot |

The static mode exists because the public host (modelseed.org/annotation, owned by fliu)
serves static files only, like Escher. `STATIC_EXPORT=1` switches `next.config.ts` to
`output: export` and stashes `src/app/api` during the build (route handlers cannot be
statically exported); the build always restores `api/` afterward.

## 3. The data-driven feature model (key design decision)

DECISION (with C. Henry and N. Spahr, 2026-06-25): rather than fork the codebase per
audience, ONE codebase responds to whatever is in its database and hides UI affordances
when the underlying data is absent.

Concretely, `GET /api/mutations` returns a `stats` block that includes capability flags
derived from the live database, e.g.:

- `hasBarcodes` - true only when the `verAB_barcodes` table exists AND has rows.
- `cnRegionCount` - number of copy-number regions present.
- `curveCount` - samples carrying a numeric OD growth curve.

The UI gates views on these flags. The Barcode Charts tab renders only when
`stats.hasBarcodes` is true; a guard also redirects away from a restored `barcodes` tab
when barcodes are absent so no blank pane is shown. The same pattern generalizes to any
future data type: add the table, the flag flips, the view appears - no code fork, no
redeploy of different code.

This is what lets the publication schedule drive the site: launch the public site with
TFMN1 only; when the VerAB barcode experiments publish, that data lands in the database and
the existing site automatically exposes the additional features.

## 4. The two live deployments

Both are the SAME built code. They differ ONLY in which database was baked into their
static artifacts at build time.

| Instance | URL | Database baked in | Barcode tab | Audience |
|---|---|---|---|---|
| PUBLIC (publication snapshot) | https://modelseed.org/annotation/projects/aiale/ | TFMN1-only trimmed mirror (no `verAB_barcodes`) | HIDDEN (data absent) | Public, launches with the robotic-experiment paper |
| DEV (internal test) | https://modelseed.org/annotation/projects/aiale-dev/ | Full mirror (all experiments + barcodes) | SHOWN | Internal test deployment before promotion |

The TFMN1 trimmed database is produced upstream by N. Spahr
(`lims_mirror_TFMN1.db`: TFMN1 experiment only, `verAB_barcodes` omitted). The full
mirror is the standard nightly LIMS mirror.

The two webroots live under fliu's space (group `cels`, group-writable; we can write
FILES but do not own the directories):
- `/scratch1/fliu/html/modelseed_annotation/projects/aiale/`
- `/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev/`

## 5. Static data pipeline

`scripts/prebake.mjs`
: Snapshots the LIVE server API responses to `public/data/*.json(.gz)` plus a
  `manifest.json`. Because it snapshots the real API (not a reimplementation), the static
  curated views are guaranteed identical to server mode. One artifact per experiment plus
  a default; the client lazy-loads one at a time to keep browser RAM low. The capability
  flags (e.g. `hasBarcodes`) are part of the snapshot, so the static build is data-driven
  exactly like the server.

`scripts/prepare-httpvfs-db.sh`
: Re-pages the SQLite mirror into `public/db/lims.db` for sql.js-httpvfs, so the raw
  Database-Tables browser works client-side via HTTP range requests (the host must send
  `Accept-Ranges: bytes`; verified on modelseed.org/annotation). Source DB is selected
  with the `SRC` env var (defaults to `data/lims_indexed.db`).

`scripts/build-static.sh`
: Stashes `src/app/api`, runs `next build` with `output: export` + the configured
  `BASE_PATH`, then ALWAYS restores `api/` and clears the static-export `.next` so a
  later `npm start` cannot inherit a trailing-slash build (see Pitfalls).

`src/lib/dataSource.ts`
: `fetchData()` + `IS_STATIC`. Server mode hits live `/api/*`; static mode reads the
  baked files. Curated components route through this single switch.

## 6. Performance: the indexed local mirror

The upstream mirror has zero indexes, so cold joins on the 223k-row `Mutations` table and
141k-row `Robotic_OD` table took 19-60s. We keep a LOCAL indexed copy and point
`SQLITE_PATH` at it:

- `ops/refresh-db.sh [SRC] [DEST]` copies the upstream mirror, builds ~14 indexes on hot
  columns (idempotent, `CREATE INDEX IF NOT EXISTS`), `ANALYZE`s, and atomically swaps it
  into place. Re-run whenever upstream refreshes.
- Result: `/api/mutations` (the heavy joined endpoint) drops from ~19s to ~0.8s.

For the dual deploy we maintain two indexed copies:
- `data/lims_indexed.db` - full mirror (dev instance)
- `data/lims_TFMN1_indexed.db` - TFMN1 trimmed mirror (public instance)

## 7. Pitfalls baked into the tooling

STATIC BUILD MUST NOT POISON SERVER MODE. `npm run build:static` produces a `.next`
whose `export-marker.json` has `exportTrailingSlash: true`. If `npm start` then runs on
that `.next`, every `/api/*` route 308-redirects to a trailing slash and 404s, so the
app looks broken. `build-static.sh` removes `.next` on exit, and `ops/serve.sh` rebuilds
a clean server `.next` if it detects `exportTrailingSlash: true`. Symptom to recognize:
root page 200 but all API routes 404 with a 308.

WEBROOT PERMISSIONS. nginx returns 403 on files that are not world-readable. After any
copy into a webroot, set files 644 and dirs 755. Mirror `out/` into the webroot, then
`find <webroot> -mindepth 1 -type f -exec chmod 644` and `-type d -exec chmod 755` (never
chmod the top directory, which fliu owns).

## 8. Re-deploy procedure (both instances)

Each instance is built against ITS database, so the only per-instance differences are the
database, the `SRC` for the httpvfs copy, the `BASE_PATH`, and the destination webroot.

```bash
cd /scratch/vsetlur/ai-ale-lims-data-viewer
conda activate ai-ale-dev

# --- choose ONE instance ---
# PUBLIC (TFMN1 trimmed): DB=data/lims_TFMN1_indexed.db; BP=/annotation/projects/aiale;     DST=/scratch1/fliu/html/modelseed_annotation/projects/aiale
# DEV (full):             DB=data/lims_indexed.db;        BP=/annotation/projects/aiale-dev; DST=/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev

# 1. point a server at this instance's DB so prebake snapshots the right capability flags
SQLITE_PATH="$PWD/$DB" PORT=3457 npm start &   # or ops/serve.sh on poplar
# 2. bake curated-view JSON from THIS db (hasBarcodes etc. are baked here)
BASE=http://localhost:3457 npm run prebake
# 3. build the client-queryable SQLite for the raw Tables browser FROM THIS db
SRC="$DB" bash scripts/prepare-httpvfs-db.sh
# 4. build the static bundle with this instance's base path
rm -rf out && BASE_PATH="$BP" npm run build:static
# 5. publish into the webroot, then fix perms on CONTENTS only
rsync -a --delete --no-perms --omit-dir-times out/ "$DST/"
find "$DST" -mindepth 1 -type d -exec chmod 755 {} \; ; find "$DST" -mindepth 1 -type f -exec chmod 644 {} \;
# 6. verify: root + data/manifest.json return 200, and the .db serves byte ranges (206)
curl -s -o /dev/null -w "root %{http_code}\n" "https://modelseed.org$BP/"
curl -s -D - -o /dev/null -H "Range: bytes=0-99" "https://modelseed.org$BP/db/lims.db" | grep -i 206
```

Expect `hasBarcodes` false for the public/TFMN1 instance and true for the dev/full
instance, from the identical code. Repeat the block for the other instance. Because
`build:static` wipes `.next`, run a fresh `npm run build` before restarting any long-lived
server afterward (see Pitfalls).

## 9. Repository map

```
src/app/api/            Server-mode API route handlers (stashed during static export)
  mutations/route.ts    Mutation Explorer dataset + capability flags (hasBarcodes, ...)
  barcode-counts/route.ts  verAB barcode charts (mock fallback when table absent)
  data/[tableName]/     Raw table browser (server mode)
src/components/
  Dashboard.tsx         App shell: workspace switcher, left sidebar, Changelog,
                        Help / Guide system + navigation events
  MutationExplorer.tsx  Sample Selection, Comparative view, Copy Number, growth curves,
                        the mutation + sample detail popups, and the data-driven tab gating
  BarcodeCharts.tsx     VerA/VerB barcode grid / focus / compare views
  DataTable.tsx         Raw Database-Tables browser (server API or sql.js-httpvfs)
  HelpCenter.tsx        Deep searchable in-app documentation
  GuideAssistant.tsx    "How do I..." helper that navigates the user + external-prompt builder
  ExportFigureMenu.tsx  Shared PNG preview/export control
src/lib/
  db.ts                 SQLite/MySQL access + query building (server mode)
  dataSource.ts         fetchData() server/static switch + IS_STATIC
  sqlClient.ts          sql.js-httpvfs client (static raw-table browser)
  figureSpec.ts         Data-backed SVG-to-PNG figure renderers
  figureExport.ts       Legacy browser-side DOM PNG fallback exporter
scripts/                prebake.mjs, build-static.sh, prepare-httpvfs-db.sh
ops/                    serve.sh, stop.sh, refresh-db.sh (server lifecycle on poplar)
next.config.ts          Dual-mode config (server vs output:export + basePath)
docs/                   ARCHITECTURE.md, RESEARCHER_GUIDE.md, MANUSCRIPT_INTEGRATION.md
```

## 10. Provenance / citation

This viewer is referenced by the robotic-experiment paper. It contains no scientific
algorithms itself; it is a presentation layer over the LIMS database. The code repository
is cited for provenance. Scientific interpretation (e.g. identifying a clonal sweep from a
copy-number trajectory) is performed by the user reading the visualizations.
