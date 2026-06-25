# AI-ALE LIMS Data Viewer

A read-only web viewer over the AI-ALE (Adaptive Laboratory Evolution) LIMS database.
It presents breseq mutation calls, copy-number amplification trajectories, robot-measured
OD growth curves, and verAB barcode-frequency charts for engineered strains evolved on the
robotic ALE platform.

- LIVE (public, publication snapshot): https://modelseed.org/annotation/projects/aiale/
- LIVE (internal, unlisted): https://modelseed.org/annotation/projects/aiale-06-25-2026/

Both are built from THIS single codebase. They differ only in which database is baked in,
and the UI hides views whose data is absent (see "Data-driven views" below).

## Documentation map

| Doc | Read it for |
|---|---|
| This README | Overview, quick start, feature + API reference |
| `docs/ARCHITECTURE.md` | System design, dual run modes, the data-driven dual-deployment model, pitfalls |
| `docs/DEPLOY_RUNBOOK_LIVE.md` | Exact, verified live re-deploy procedure (both instances) |
| `docs/DEPLOYMENT_DESIGN.md` | Static-export build internals and rationale |
| `docs/archive/` | Point-in-time meeting notes / audits (provenance only, not current) |
| `CLAUDE.md` | Standing orders + operating conventions for this repo |

## Views

- Sample Selection - filter/pick samples; faceted metadata chips (picking one factor
  narrows the others); per-sample growth-curve sparkline; click a sample name for a
  detail popup.
- Comparative View - selected samples as columns, mutations as rows; per-cell heatmap
  (frequency on a fixed 0 to 100% scale, copy number on a per-row scale); user-configurable
  multi-level column grouping; mutation selection + "compare mutations" filter; click a
  mutation for a genome-browser-style detail popup.
- Copy Number - per-lineage copy-number trajectories across transfers; log toggle;
  hover/click a lineage in the legend to highlight/isolate it.
- Barcode Charts - verAB barcode-frequency stacked bars per well, grid / focus / compare
  views. Shown ONLY when the database contains barcode data.
- Database Tables - raw paginated, filterable, searchable table browser. In static mode
  this runs SQLite in the browser (sql.js-httpvfs) so it stays fully queryable with no server.

## Data-driven views (one codebase, many audiences)

Rather than fork the codebase per audience, the viewer responds to what is in its database.
`GET /api/mutations` returns capability flags in its `stats` block (e.g. `hasBarcodes`,
`cnRegionCount`, `curveCount`) computed from the live DB. The UI gates views on them:

- The TFMN1 publication snapshot DB omits `verAB_barcodes` -> `hasBarcodes` is false ->
  the Barcode Charts tab is hidden on the public site.
- The full internal DB has barcodes -> the tab is shown on the private site.

Same code, different database, different visible surface. See `docs/ARCHITECTURE.md` section 3.

## Quick start (conda)

This host has no system-wide Node, so the project uses a dedicated conda env
(`ai-ale-dev`) that pins Node + npm.

One-time setup:

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

On the deploy host (poplar) the server runs under tmux via `ops/serve.sh` on port 3457;
stop with `ops/stop.sh`.

## Static build (for modelseed.org)

```bash
# 1. server must be running so prebake can snapshot the live API
npm run prebake                                   # API -> public/data/*.json(.gz)
SRC=data/lims_indexed.db bash scripts/prepare-httpvfs-db.sh   # -> public/db/lims.db
BASE_PATH=/annotation/projects/aiale npm run build:static     # -> out/
# then mirror out/ into the granted webroot (see docs/DEPLOY_RUNBOOK_LIVE.md)
```

Which database you point the server at before `prebake` + `prepare-httpvfs-db.sh`
determines what the static instance shows. Full re-deploy of BOTH instances:
`docs/DEPLOY_RUNBOOK_LIVE.md`.

## Database performance

The upstream LIMS mirror has no indexes, so cold joins were slow (19-60s). Keep a local
indexed copy and point `SQLITE_PATH` at it:

```bash
ops/refresh-db.sh                                  # full mirror  -> data/lims_indexed.db
ops/refresh-db.sh /path/to/lims_mirror_TFMN1.db data/lims_TFMN1_indexed.db   # trimmed
```

`/api/mutations` drops from ~19s to ~0.8s after indexing. Re-run whenever upstream
refreshes.

## Environment

| Variable | Default | Description |
|---|---|---|
| `SQLITE_PATH` | `data/lims_mirror.db` | SQLite database path (use the indexed copy) |
| `MYSQL_URL` | - | MySQL connection string; if set, MySQL is used instead of SQLite |
| `STATIC_EXPORT` | - | `1` switches the build to static `output: export` |
| `BASE_PATH` | - | URL base path for a static build (e.g. `/annotation/projects/aiale`) |

## API (server mode)

- `GET /api/health` - DB driver, path, mtime, latency
- `GET /api/mirror-info` - table counts + snapshot timestamp of the active mirror
- `GET /api/mutations[?experiment=TFMN1]` - Mutation Explorer dataset: samples + mutations
  (one row per unique site, with a `values: { [seq_sample]: value }` map and a rich
  `detail` block per mutation) + registries + `warnings[]` + `stats` (capability flags).
- `GET /api/barcode-counts` - verAB barcode charts (returns shaped mock data when
  `verAB_barcodes` is absent, so server-mode dev still renders something; the live tab is
  gated on the real `hasBarcodes` flag).
- `GET /api/tables` - list tables
- `GET /api/data/[tableName]?page=&pageSize=&sortBy=&sortDirection=&globalSearch=&filterLogic=`
  - paginated, filterable raw table data
- `GET /api/distinct/[tableName]?column=` - distinct values for a column (filter dropdowns)
- `GET /api/export/[tableName]` - CSV export

## License / provenance

Internal Argonne / ModelSEED project. The viewer is a presentation layer over the LIMS
database (no scientific algorithms inside); the repository is cited for provenance in the
robotic-experiment paper. See `docs/ARCHITECTURE.md` section 9.
