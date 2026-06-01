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

## API

- `GET /api/config` — DB config and connection status
- `POST /api/config` — Switch DB type or update credentials
- `GET /api/tables` — List tables
- `GET /api/data/[tableName]?page=1&pageSize=50&sortBy=col&sortDirection=asc&globalSearch=...&filterLogic=AND` — Paginated table data with filters
- `GET /api/mutations` — Mutation Explorer dataset (samples + mutations + parser warnings). Reads `data/mutations.json`, or the path in the `MUTATIONS_PATH` env var.
