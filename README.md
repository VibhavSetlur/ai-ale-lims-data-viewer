# AI-ALE LIMS Data Viewer

A read-only web viewer over the AI-ALE (Adaptive Laboratory Evolution) LIMS
database. It presents breseq mutation calls, dgoA\* copy-number amplification
trajectories, robot-measured OD600 growth curves, and VerA/VerB barcode-
composition charts for engineered *Acinetobacter baylyi* ADP1 strains evolved on
the automated robotic ALE platform.

- STATIC (production): https://modelseed.org/annotation/projects/aiale-dev/

The approved static viewer is built from the `static` branch with its full LIMS
mirror snapshot. Static output is prebaked and does not call live APIs.

## Documentation map

| Doc | Read it for |
|---|---|
| This README | Overview, quick start, feature + API reference |
| [`docs/`](docs/README.md) | Documentation index |
| `docs/ARCHITECTURE.md` | System design, dual run modes, the data-driven dual-deployment model |
| `docs/DATA_MODEL.md` | The LIMS tables the views use and how they map; provenance rule |
| `docs/RESEARCHER_GUIDE.md` | How a biologist uses the viewer to find results and build figures |
| `docs/MANUSCRIPT_INTEGRATION.md` | Ready-to-adapt methods/results/legend language + honesty guardrails |
| `CONTRIBUTING.md` | Dev setup, verification, conventions, build/deploy |
| `CITATION.cff` | How to cite this software |
| `CLAUDE.md` | Operating conventions for AI-assisted work in this repo |

In-app help is built into the viewer itself: the left sidebar has a **Guide**
(answers "how do I..." and walks you to the right view), a **Changelog**
(viewer release history plus data snapshot provenance), and a deep searchable
**Help** center. The Help center mirrors `docs/RESEARCHER_GUIDE.md`.

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

Every chart exports through a PNG preview/editor modal with publication-oriented labels, sizing, colors, and caption controls. Major charts render exports from data-backed figure specs rather than screen captures, and CSV remains separate for quantitative values.

## Data-driven views (one codebase, many audiences)

Rather than fork the codebase per audience, the viewer responds to what is in its
database. `GET /api/mutations` returns capability flags in its `stats` block
(e.g. `hasBarcodes`, `cnRegionCount`, `curveCount`) computed from the live DB, and
the UI gates views on them:

- The TFMN1 publication snapshot DB omits `verAB_barcodes` -> `hasBarcodes` is
  false -> the Barcode Charts tab is hidden on the public site.
- The full DB has barcodes -> the tab is shown on the dev site.

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

## Static production build (modelseed.org)

The approved static production source is `static`; `static-dev` is the private static-development source. The static URL remains `https://modelseed.org/annotation/projects/aiale-dev/`. Do not build, promote, or deploy from compatibility-only `dev` or `deploy/aiale-dev`.

From an accepted `static` checkout, with a server running against `data/lims_indexed.db`:

```bash
npm run prebake
SRC=data/lims_indexed.db bash scripts/prepare-httpvfs-db.sh
BASE_PATH=/annotation/projects/aiale-dev scripts/build-static.sh
```

The script accepts only that existing base path and bakes `channel=static` and `branch=static`. It creates `out/`; after explicit authorization, mirror its contents into the approved webroot, then verify the URL root, `data/manifest.json`, and a SQLite byte-range response. Static output is prebaked with no live API calls, retains Plate Design, and omits the AI sidebar/User Workspace. Rebuild `npm run build` before returning to server mode because the static export clears `.next`.

Dynamic development and releases use `dynamic-dev` and `dynamic`; `main` is historic/shared recovery only.

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
| `NEXT_PUBLIC_BASE_PATH` | - | Static URL base path: `/annotation/projects/aiale-dev` |
| `NEXT_PUBLIC_VIEWER_VERSION` | `package.json` version | Static build viewer version override |
| `NEXT_PUBLIC_DEPLOYMENT_CHANNEL` | `static` | Baked static deployment channel |
| `NEXT_PUBLIC_DEPLOYMENT_BRANCH` | `static` | Baked static source branch |
| `NEXT_PUBLIC_GIT_COMMIT` | current git commit | Baked static commit override |

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

Released under the [MIT License](LICENSE). Argonne / ModelSEED project. The viewer
is a presentation layer over the LIMS database (no scientific algorithms inside);
the repository is cited for provenance in the robotic-experiment paper. See
[`CITATION.cff`](CITATION.cff) for how to cite it.
