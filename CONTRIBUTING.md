# Contributing

This is the development guide for the AI-ALE LIMS Data Viewer. For what the app is
and how to use it, see the [`README`](README.md); for the design, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

The host has no system-wide Node, so the project uses a dedicated conda env that
pins Node + npm.

```bash
conda create -n ai-ale-dev -c conda-forge 'nodejs>=20' -y
conda activate ai-ale-dev
npm install
cp .env.example .env.local        # set SQLITE_PATH to your local indexed DB
npm run dev                        # http://localhost:3000
```

Database files are never committed; point `SQLITE_PATH` at a local copy (see the
README "Database performance" section for building an indexed mirror).

## Verify before every commit

```bash
npm run build      # must compile cleanly and generate all static pages
npm run lint       # must introduce no NEW errors
```

There are a few pre-existing lint errors (vendored `public/db/sqlite.worker.js`,
one `next.config.ts` require, one ref-during-render in `BarcodeCharts.tsx`). Do
not add new ones. The build is the real gate.

## Conventions

- TypeScript + React (Next.js App Router). Match the surrounding style; keep
  changes scoped (no drive-by refactors).
- No em-dashes in code, comments, UI copy, or commit messages. First person,
  direct, concise.
- Honesty rule (hard): never show a value that is not in the database or openly
  computed from it. Mark every derived value with an info affordance. Absent data
  is shown as absent (NG / NS / "not found"), never as zero or an inferred number.
- Do not call a non-LLM feature "AI". The in-app helper is a Guide.
- Keep the docs and the in-app Help/Tutorial in sync with the code when a
  user-visible feature changes.

## Project layout

See `docs/ARCHITECTURE.md` section 9 for the full repository map. In short:
`src/app/api` (server routes), `src/components` (views + help system),
`src/lib` (data source, DB access, figure export), `scripts` (static build +
prebake), `ops` (server lifecycle), `docs` (this documentation set).

## Building and deploying the static sites

The viewer ships as two static deployments built from this one codebase against
two different database snapshots. The full, verified procedure is in
`docs/ARCHITECTURE.md` section 8. Database files, the `out/` bundle, and baked
`public/data` / `public/db` artifacts are all gitignored and rebuilt per deploy.

## Commit style

Scoped, conventional-style messages: `feat(barcode-compare): ...`,
`fix(export): ...`, `docs: ...`. Explain the why in the body when it is not
obvious from the diff.
