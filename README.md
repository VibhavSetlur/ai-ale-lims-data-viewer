# AI-ALE LIMS Data Viewer

A read-only web viewer over the AI-ALE (Adaptive Laboratory Evolution) LIMS
database. It presents breseq mutation calls, dgoA\* copy-number amplification
trajectories, robot-measured OD600 growth curves, and VerA/VerB barcode-
composition charts for engineered *Acinetobacter baylyi* ADP1 strains evolved on
the automated robotic ALE platform.

- LIVE (public, publication snapshot): https://modelseed.org/annotation/projects/aiale/
- LIVE (internal, unlisted): https://modelseed.org/annotation/projects/aiale-06-25-2026/

Both sites are built from THIS single codebase. They differ only in which
database snapshot is baked in, and the UI automatically hides views whose data is
absent (see "Data-driven views" below).

## Documentation map

| Doc | Read it for |
|---|---|
| This README | Overview, quick start, feature + API reference |
| [`docs/`](docs/README.md) | Documentation index |
| `docs/ARCHITECTURE.md` | System design, dual run modes, the data-driven dual-deployment model |
| `docs/RESEARCHER_GUIDE.md` | How a biologist uses the viewer to find results and build figures |
| `docs/MANUSCRIPT_INTEGRATION.md` | Ready-to-adapt methods/results/legend language + honesty guardrails |
| `CLAUDE.md` | Operating conventions for AI-assisted work in this repo |

In-app help is built into the viewer itself: the left sidebar has a **Guide**
(answers "how do I..." and walks you to the right view), an **Interactive
tutorial** (on-screen highlighted walkthrough), and a deep searchable **Help**
center. The Help center mirrors `docs/RESEARCHER_GUIDE.md`.

## What this is (and is not)

It is a presentation layer over a snapshot of the LIMS database. It contains no
scientific algorithms: every number shown is either stored in the database or
computed transparently from stored values, and the UI labels which is which. When
a value is absent (a missing growth series, an unsequenced timepoint) the viewer
says so rather than guessing.

## Views

- **Sample Selection** — filter/pick samples; faceted metadata chips (picking one
  factor narrows the others); per-sample growth sparkline; click a sample name for
  a detail popup.
- **Comparative View** — selected samples as columns, mutations and copy-number
  regions as rows; per-cell heatmap (frequency on a fixed 0 to 100% scale, copy
  number on a per-row scale); multi-level column grouping; provided (donor DNA)
  mutations outlined in amber; click a mutation for a genome-context popup.
- **Copy Number** — per-lineage dgoA\* copy-number trajectories across transfers;
  log/linear toggle; hover crosshair; click a lineage to isolate it.
- **Barcode Charts** — VerA/VerB barcode-composition bars per well, in grid /
  focus / compare views, with Rows/Bars/Lines/Heatmap chart types and a
  shared-axis compare. Shown ONLY when the database contains barcode data.
- **Database Tables** — raw paginated, filterable, searchable table browser. In
  static mode this runs SQLite in the browser (sql.js-httpvfs) so it stays fully
  queryable with no server.

Every chart exports as a publication-quality figure (PNG / SVG / HTML / Print-to-PDF,
self-contained with resolved colors, a title, and a snapshot caption), plus CSV for values.

## Data-driven views (one codebase, many audiences)

Rather than fork the codebase per audience, the viewer responds to what is in its
database. `GET /api/mutations` returns capability flags in its `stats` block
(e.g. `hasBarcodes`, `cnRegionCount`, `curveCount`) computed from the live DB, and
the UI gates views on them:

- The TFMN1 publication snapshot DB omits `verAB_barcodes` -> `hasBarcodes` is
  false -> the Barcode Charts tab is hidden on the public site.
- The full internal DB has barcodes -> the tab is shown on the private site.

Same code, different database, different visible surface. See
`docs/ARCHITECTURE.md`.

## Quick start (conda)

This host has no system-wide Node, so the project uses a dedicated conda env
(`ai-ale-dev`) that pins Node + npm.

```bash
conda create -n ai-ale-dev -c conda-forge 'nodejs>=20' -y
conda activate ai-ale-dev
cd /scratch/vsetlur/ai-ale-lims-data-viewer
npm install
cp .env.example .env.local   # set SQLITE_PATH (or MYSQL_URL)
```

Dev server (hot reload):

```bash
conda activate ai-ale-dev
npm run dev                   # http://localhost:3000
```

Production server build:

```bash
conda activate ai-ale-dev
npm run build
npm start                     # add -- -p 3457 to change port
```

## Static build (for modelseed.org)

The same codebase also builds a fully static bundle (no server) for the public
deployment. Which database you point the server at before `prebake` +
`prepare-httpvfs-db.sh` determines what the static instance shows.

```bash
# 1. a server must be running so prebake can snapshot the live API
npm run prebake                                              # API -> public/data/*.json(.gz)
SRC=data/lims_indexed.db bash scripts/prepare-httpvfs-db.sh  # -> public/db/lims.db
BASE_PATH=/annotation/projects/aiale npm run build:static    # -> out/
# then mirror out/ into the target webroot and fix file perms (644 files / 755 dirs)
```

The raw Database Tables browser stays fully queryable in the static build because
it runs real SQLite in the browser via sql.js-httpvfs over HTTP range requests;
the host must serve the `.db` with `Accept-Ranges: bytes`.

## Database performance

The upstream LIMS mirror has no indexes, so cold joins were slow (19-60s). Keep a
local indexed copy and point `SQLITE_PATH` at it:

```bash
ops/refresh-db.sh                                  # full mirror  -> data/lims_indexed.db
ops/refresh-db.sh /path/to/lims_mirror_TFMN1.db data/lims_TFMN1_indexed.db   # trimmed
```

`/api/mutations` drops from ~19s to ~0.8s after indexing. Re-run when upstream
refreshes. Database files live under `data/` and are not committed.

## Environment

| Variable | Default | Description |
|---|---|---|
| `SQLITE_PATH` | `data/lims_mirror.db` | SQLite database path (use the indexed copy) |
| `MYSQL_URL` | - | MySQL connection string; if set, MySQL is used instead of SQLite |
| `STATIC_EXPORT` | - | `1` switches the build to static `output: export` |
| `BASE_PATH` | - | URL base path for a static build (e.g. `/annotation/projects/aiale`) |

## API (server mode)

- `GET /api/health` — DB driver, path, mtime, latency
- `GET /api/mirror-info` — table counts + snapshot timestamp of the active mirror
- `GET /api/mutations[?experiment=TFMN1]` — Mutation Explorer dataset: samples +
  mutations (one row per unique site, with a `values: { [seq_sample]: value }`
  map, a `providedIn` list for donor-DNA mutations, and a rich `detail` block) +
  registries + `warnings[]` + `stats` (capability flags).
- `GET /api/barcode-counts` — VerA/VerB barcode charts.
- `GET /api/tables` — list tables.
- `GET /api/data/[tableName]?page=&pageSize=&sortBy=&sortDirection=&globalSearch=&filterLogic=`
  — paginated, filterable raw table data.
- `GET /api/distinct/[tableName]?column=` — distinct values for a column.
- `GET /api/export/[tableName]` — CSV export.

## License / provenance

Internal Argonne / ModelSEED project. The viewer is a presentation layer over the
LIMS database (no scientific algorithms inside); the repository is cited for
provenance in the robotic-experiment paper.
