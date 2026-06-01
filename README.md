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
| `MUTATIONS_PATH` | `data/mutations.json` | Mutation Explorer dataset. Format auto-detected by extension (`.json`, `.csv`, `.tsv`/`.tab`) |

DB type is auto-detected: if `MYSQL_URL` is set, MySQL is used; otherwise SQLite.

## Mutation Explorer data formats

The Mutation Explorer view reads from `MUTATIONS_PATH`. The current `data/mutations.json` is **placeholder/mock data** modeled after slide 31 of the AI-ALE keynote — replace it with Natascha's spreadsheets when they arrive. Three input formats are supported; the format is picked from the file extension (and content-sniffed if the extension is unknown).

### 1. CSV / TSV (wide spreadsheet)

The format that drops in directly from Excel/Google Sheets save-as. Sample columns run across the top; mutation rows run down. Optional metadata rows above the header annotate each sample column.

```
,,,,experiment,ALE1b,ALE1b,ALE1b,ALE1b
,,,,replicate,A,A,A,A
,,,,donor_dna,fba mutation,fba mutation,fba mutation,fba mutation
,,,,condition,Pyruvate 20 mM,Pyruvate 20 mM,Pyruvate 20 mM,Pyruvate 20 mM
,,,,transfer,0,1,5,10
gene,variant,type,metric,sample →,ACN3210 fba A t=0,ACN3210 fba A t=1,ACN3210 fba A t=5,ACN3210 fba A t=10
fba,P44L,SNP,frequency,,0.00,0.00,0.13,0.87
dgoA,copy number,amplification,copy_number,,0.8,0.8,1.3,1.4
```

Rules:
- The **header row** is the first row whose left-side cells include `gene`. Other descriptor columns may be present in any order: `variant` (or `mutation`/`allele`), `type` (or `mutation_type`), `metric` (or `unit`), `id` (or `mutation_id`).
- All columns to the right of the descriptors are **sample columns**, and their header text becomes both the sample id and display name.
- Rows **above** the header are optional **sample metadata**: any row whose leftmost non-empty cell matches `experiment` / `experiment_type` / `replicate` (or `rep`) / `donor_dna` (or `donor dna`/`donor`) / `condition` / `transfer` / `strain` / `name` / `sample_id` / `selection_note` will populate that field for the aligned sample column.
- Cells in mutation rows may be empty (= "no data for this sample"), a number (`0.87`), or a percent string (`87%` → converted to `0.87`).
- If `metric` is omitted, it's inferred from `type` (anything containing "copy number" or "amplification" → `copy_number`; otherwise `frequency`).
- If `id` (mutation) is omitted, it's auto-generated from `gene.variant.type`.
- A CSV produced by the in-app **CSV export** button is round-trip-readable.

For TSV, use tabs as the delimiter and `.tsv` (or `.tab`) as the extension. Everything else is identical.

### 2. JSON — wide format (current default)

The structure stored in `data/mutations.json`:

```json
{
  "samples": [
    { "id": "S1", "name": "S1", "experiment": "ALE1b", "experiment_type": "robotic ALE",
      "replicate": "A", "transfer": 0, "condition": "Pyruvate 20 mM",
      "strain": "ACN3210", "donor_dna": "No Donor DNA",
      "growth_curve": [{"t":0,"od":0.05},{"t":10,"od":0.21}] }
  ],
  "mutations": [
    { "id": "fba.P44L", "gene": "fba", "variant": "P44L", "type": "SNP",
      "metric": "frequency", "values": { "S1": 0.87 } }
  ]
}
```

`growth_curve` is the only field that's CSV-unfriendly — to ship growth curves you currently need JSON.

### 3. JSON — long format (per-value records)

If your pipeline emits one record per (mutation, sample) value, use:

```json
{
  "samples": [ { "id": "S1", "name": "S1", "experiment": "ALE1b" } ],
  "mutations": [
    { "id": "fba.P44L", "gene": "fba", "variant": "P44L", "type": "SNP", "metric": "frequency",
      "values": [
        { "sample_id": "S1", "value": 0.87 }
      ]
    }
  ]
}
```

The API normalizes both shapes to the wide form before returning.

### Validation feedback

`GET /api/mutations` returns a `warnings[]` array describing any rows it skipped (missing ids, duplicate ids, non-numeric values, etc.). The UI surfaces the first few warnings in an info banner so dataset issues are visible without checking server logs.

## API

- `GET /api/config` — DB config and connection status
- `POST /api/config` — Switch DB type or update credentials
- `GET /api/tables` — List tables
- `GET /api/data/[tableName]?page=1&pageSize=50&sortBy=col&sortDirection=asc&globalSearch=...&filterLogic=AND` — Paginated table data with filters
- `GET /api/mutations` — Mutation Explorer dataset (samples + mutations + parser warnings). Reads `data/mutations.json`, or the path in the `MUTATIONS_PATH` env var.
