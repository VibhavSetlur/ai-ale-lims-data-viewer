# AI-ALE Viewer — Deployment Design (dual-mode: static + server)

Status: DESIGN + IMPLEMENTATION (Vibhav, 2026-06-24)
Owner: Vibhav (vsetlur@anl.gov)
Audience: Filipe Liu (fliu, static hosting), Seaver (ModelSEED deploy), Chris Henry (req)

## What Henry asked for
A public ModelSEED-hosted home for the AI-ALE viewer, reachable at a
modelseed.org URL (like the Escher builder at modelseed.org/escher/...). Filipe
offered a STATIC webroot:

    /scratch1/fliu/html/modelseed_annotation/projects/<name>
        -> https://modelseed.org/annotation/projects/<name>/

Filipe makes the folder + grants perms; deployment there is just dropping static
files (no container, like Escher).

## The core constraint (why this needs design, not just a copy)
The viewer is TODAY a Next.js SERVER app: 9 API routes that query a 240MB SQLite
mirror at REQUEST time via better-sqlite3 (a native Node module). A static webroot
has no Node process and no SQLite, so the app cannot run there unchanged.

We do NOT touch Filipe's filesystem ourselves. We produce a self-contained static
bundle and hand it to Filipe (or he points the webroot at a path we own and he
symlinks). All work happens in OUR repo.

## Decision: build BOTH modes from one codebase
Per Vibhav: build both, optimize for the static export, keep it refreshable when
the single SQLite DB changes, and keep client RAM low + load fast.

| Mode | Where | URL | Features | Who deploys |
|---|---|---|---|---|
| STATIC (public) | Filipe's webroot | modelseed.org/annotation/projects/aiale | Mutation Explorer, Copy Number, Barcode Charts (curated, read-only) | Vibhav builds, Filipe places files |
| SERVER (internal/power) | poplar:3457 + nginx | (existing) | ALL of the above PLUS raw Database-Tables browser + live CSV export | Vibhav runs, Dan/Seaver proxy |

One codebase, one component tree. A build-time flag picks the data source.

## RAM + speed strategy (the hard requirement)
The 240MB DB never goes to the browser. We PRE-BAKE only what the curated views
need, as small gzipped JSON, loaded lazily:

- Default (all experiments) mutations payload: 8.4 MB raw -> **1.25 MB gzipped**.
- Per-experiment payloads: ~1.8-2.8 MB raw -> **~300 KB gzipped each**.
- Barcode-counts payload: small.

Plan:
1. Pre-bake ONE artifact per experiment (TFMN1/TFMN2/TFMN3/TFMN4/strain_stocks)
   plus the default "all" view, gzipped, under `public/data/`.
2. The client loads the DEFAULT artifact on first paint (1.25 MB gz), then loads a
   per-experiment artifact ONLY when the user picks that experiment, and DROPS the
   previous one. The browser holds at most one experiment's data at a time, so
   peak RAM is ~the size of one decoded payload (tens of MB max, typically less),
   not the whole dataset and never the 240MB DB.
3. Artifacts are content-hashed in a manifest so the browser caches aggressively
   and only re-downloads what changed on a refresh.

This is strictly LESS work for the browser than today's server mode (same JSON,
just served as a file instead of computed per request), so static is the FASTER
path for the user, not slower.

## Refresh story (future DB changes — the "single sqlite file we just display")
When the LIMS mirror is refreshed (new DB snapshot), regenerating the static
bundle is one command:

    npm run prebake        # DB (SQLITE_PATH) -> public/data/*.json.gz + manifest
    npm run build:static   # Next static export -> out/
    # then hand `out/` to Filipe / copy into the webroot path we're granted

No code changes, no rebuild logic to remember. The prebake script reads the SAME
SQLite file the server mode reads, through the SAME query code, so the static and
server views are guaranteed identical. A future "new version" DB just means
re-running prebake against the new file.

## What static mode DROPS (and why that's fine)
- Raw "Database Tables" browser (arbitrary pagination/filter/sort over all 28
  tables): needs live SQL, can't pre-bake every query. Hidden in static mode;
  remains available in the internal server deploy for power users.
- On-demand CSV export of arbitrary filtered table slices: server-only. The
  curated views still offer their own CSV (copy-number export etc.) because that
  data is already in the baked artifact.
The public audience (Henry's collaborators) wants the curated Explorer, not the
raw table dump, so the public static build loses nothing they need.

## Routing / base path
Static export is served from a SUBPATH (`/annotation/projects/aiale/`), so the
build sets `basePath` / `assetPrefix` to that prefix and all asset + data URLs are
relative to it. Configurable via env so the same code can target a different name
if Filipe picks one.

## Hand-offs (we never touch others' space)
- FILIPE: pick the project name (proposed: `aiale`), create
  `/scratch1/fliu/html/modelseed_annotation/projects/aiale`, grant Vibhav write
  perms OR take the built `out/` bundle from Vibhav and drop it in. One-time;
  refreshes are just replacing files.
- SEAVER: only involved if we instead fold this into ModelSEED-UI (alternative,
  not the primary plan). For the static path, Seaver isn't needed.
- DAN/BORIS: only for the SERVER mode nginx proxy (already documented in
  DEPLOY.md); not needed for the static path.

## Open question for Filipe
Does the static webroot serve pre-gzipped `.json.gz` with correct
`Content-Encoding: gzip` (like Escher's assets), or should we ship plain `.json`
and rely on on-the-fly gzip? If pre-gzip isn't auto-served, we ship plain JSON
(slightly larger over the wire, identical in the browser). Need to know to pick
the artifact format.
