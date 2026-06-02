# AI-ALE LIMS Data Viewer

Web viewer for LIMS data. Uses SQLite by default, or MySQL if `MYSQL_URL` is set.

## Quick Start (conda)

The dev box doesn't ship a system-wide Node, so the project uses a dedicated conda env (`ai-ale-dev`) that pins Node + npm. The same env works for both casual testing (`npm run dev`) and serving a production build (`npm run build && npm start`).

**One-time setup** — create the env (only needed once per machine):

```bash
conda create -n ai-ale-dev -c conda-forge 'nodejs>=20' -y
conda activate ai-ale-dev
cd /scratch/vsetlur/ai-ale-lims-data-viewer
npm install
cp .env.example .env.local   # set SQLITE_PATH or MYSQL_URL
```

If the env already exists on this machine, skip `conda create` and start from `conda activate ai-ale-dev`.

**Run the dev server** — hot-reloads on file changes:

```bash
conda activate ai-ale-dev
cd /scratch/vsetlur/ai-ale-lims-data-viewer
npm run dev                  # http://localhost:3000
```

**Run the production build** — same code path users will hit when deployed:

```bash
conda activate ai-ale-dev
cd /scratch/vsetlur/ai-ale-lims-data-viewer
npm run build
npm start                    # http://localhost:3000  (use -- -p 3457 to change port)
```

**Pick a free port** if `3000` is taken (e.g. `npm run dev -- -p 3457` or `npm start -- -p 3457`).

To leave the env: `conda deactivate`.

## Docker

```bash
cp .env.example .env.local
cp /path/to/your.db data/
docker compose up --build -d   # http://localhost:3000
```

## Environment

| Variable | Default | Description |
|---|---|---|
| `SQLITE_PATH` | `data/lims_mirror.db` | SQLite database path |
| `MYSQL_URL` | — | MySQL connection string (`mysql://user:pass@host:3306/db`) |

DB type is auto-detected: if `MYSQL_URL` is set, MySQL is used; otherwise SQLite.

## Mutation Explorer

The Mutation Explorer view is populated directly from the configured LIMS database — no separate file is read. Specifically, `GET /api/mutations` joins:

- `Mutations` (breseq variant calls — one row per call per seq sample) for `gene_name`, `aa_*`, `position`, `frequency`, `type` / `mutation_category` / `snp_type`.
- `Seq_samples` for the canonical sequencing sample id, parent `Sample_Name`, and population/colony tag.
- `Samples` for `Strain_name`, `Condition`, `Transforming_DNA`, and notes.
- `Experiments` for the experiment `Type` (e.g. `robotic ALE`).

Mutation calls are collapsed to one row per unique site (keyed on `type`/`gene_name`/`position`/`ref_seq`/`new_seq`/AA change), with a `values: { [seq_sample]: frequency }` map. Variant labels prefer the AA change (e.g. `F33I`); otherwise they fall back to the nucleotide change at position. Transfer numbers and population/colony are parsed out of the seq-sample suffix (`…T1.P` → transfer 1, population).

The DB ships with ~155k mutation rows across 6 experiments (467 seq samples → ~2.2k unique mutation sites); payloads stay in the low-MB range.

### Optional query params

- `?experiment=TFMN1` — restrict both the sample list and the mutation rows to a single experiment, for faster loads.

### Validation feedback

`GET /api/mutations` returns a `warnings[]` array (e.g. when an experiment filter yields no samples). The UI surfaces the first few warnings in an info banner so dataset issues are visible without checking server logs.

## API

- `GET /api/config` — DB config and connection status
- `POST /api/config` — Switch DB type or update credentials
- `GET /api/tables` — List tables
- `GET /api/data/[tableName]?page=1&pageSize=50&sortBy=col&sortDirection=asc&globalSearch=...&filterLogic=AND` — Paginated table data with filters
- `GET /api/mutations` — Mutation Explorer dataset (samples + mutations + warnings + source metadata) derived from the LIMS `Mutations` table.
