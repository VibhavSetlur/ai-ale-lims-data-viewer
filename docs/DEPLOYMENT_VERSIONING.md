# Deployment Versioning

Versioning starts at `1.0.0` for publication tracking. The same source code can be
built into three different static deployments, and each deployment records its own
branch pointer, base path, database, and visible capabilities.

## Branch Roles

| Branch | URL | Database | Barcode tab | Purpose |
|---|---|---|---|---|
| `main` | server/local | runtime DB | follows active DB | Integration branch for feature and fix work |
| `deploy/aiale-dev` | `https://modelseed.org/annotation/projects/aiale-dev/` | `data/lims_indexed.db` | shown when `verAB_barcodes` exists | Test deployment before promotion |
| `deploy/aiale-public` | `https://modelseed.org/annotation/projects/aiale/` | `data/lims_TFMN1_indexed.db` | hidden | Public publication snapshot |
| `deploy/aiale-private` | `https://modelseed.org/annotation/projects/aiale-06-25-2026/` | `data/lims_indexed.db` | shown when `verAB_barcodes` exists | Internal full-data snapshot |

`main` is not the deployment record. The `deploy/*` branches are the branch
pointers that say which code revision belongs to each static URL.

## Viewer Display

The viewer header shows a version badge. Opening it shows:

- viewer semantic version, starting at `1.0.0`;
- deployment channel: `dev`, `public`, `private`, or `server`;
- deployment branch;
- build commit;
- server/static mode;
- expected database for that channel;
- barcode capability policy for that channel.

This makes screenshots and live URLs self-describing.

## Build Metadata

Static builds set these environment variables at build time:

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_VIEWER_VERSION` | Viewer semantic version, normally from `package.json` |
| `NEXT_PUBLIC_DEPLOYMENT_CHANNEL` | `dev`, `public`, `private`, or `server` |
| `NEXT_PUBLIC_DEPLOYMENT_BRANCH` | Branch pointer that should match the deployed URL |
| `NEXT_PUBLIC_GIT_COMMIT` | Commit baked into the static bundle |
| `NEXT_PUBLIC_BASE_PATH` | Static URL base path |

`scripts/build-static.sh` infers the channel and branch from `BASE_PATH`:

- `/annotation/projects/aiale-dev` -> `dev`, `deploy/aiale-dev`
- `/annotation/projects/aiale` -> `public`, `deploy/aiale-public`
- `/annotation/projects/aiale-06-25-2026` -> `private`, `deploy/aiale-private`

## Release Flow

1. Land feature and fix work on `main`.
2. Bump `package.json` and `package-lock.json` when the viewer release version changes.
3. Fast-forward `deploy/aiale-dev` to the chosen `main` commit.
4. Bake and deploy the dev URL with the full DB:
   `SRC=data/lims_indexed.db`, `BASE_PATH=/annotation/projects/aiale-dev`.
5. Verify the dev URL over HTTPS, including static JSON and SQLite range requests.
6. Only after acceptance, fast-forward the production deploy branch or branches.
7. Bake each production URL with its own DB and base path.
8. Move a production deploy branch only after that exact URL is rebuilt,
   permission-fixed, and verified.

## Channel Differences

The codebase is shared. Differences are data and deployment metadata:

- Public uses the TFMN1 trimmed database. It omits `verAB_barcodes`, so the
  Barcode Charts tab is hidden by the `hasBarcodes` capability flag.
- Private and dev use the full database. They show Barcode Charts when
  `verAB_barcodes` exists and has rows.
- Server/local mode follows the active runtime database, so capabilities can vary.

## Manuscript and Publication Notes

Use the version badge, deployment branch, commit, URL, and LIMS snapshot date in
figure provenance. Do not put manuscript drafts or private paper text in the
repository unless explicitly requested.
