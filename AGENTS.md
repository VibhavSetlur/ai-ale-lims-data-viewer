# Project Guide

This is the tracked operating guide for the AI-ALE LIMS Data Viewer. Read the root [`README.md`](README.md) for product use and [`docs/README.md`](docs/README.md) for the authoritative documentation map. Keep local `CLAUDE.md` intact: it is separate local guidance, not the tracked project authority.

## Delivery lineages

| Branch | Role |
|---|---|
| `dynamic-dev` | Dynamic development and verification |
| `dynamic` | Dynamic production and release source |
| `static-dev` | Private static development |
| `static` | Static production/release source for `https://modelseed.org/annotation/projects/aiale-dev/` |
| `main` | Historic/shared recovery, not a deployment source |

`dev` and `deploy/aiale-dev` are compatibility-only. Do not develop, promote, or deploy from them. A static release is prebaked from accepted `static` work and uses `/annotation/projects/aiale-dev`; do not touch a webroot or refs without explicit authorization.

## Static and KIND boundary

This lineage is the static export boundary. The export is built from accepted `static` work with `scripts/prebake.mjs`, `scripts/prepare-httpvfs-db.sh`, and `scripts/build-static.sh`; it serves prebaked curated artifacts and browser SQLite without live APIs. Before an authorized release, verify the URL root, `data/manifest.json`, required artifacts, and a SQLite byte-range response. See [`docs/KIND_INTEGRATION.md`](docs/KIND_INTEGRATION.md).

The local dynamic KIND adapter, its `kind/` package, and `/api/kind-ready` are server-only. Do not add them as a static runtime dependency or treat static artifact checks as a KIND registration or readiness result.

## Safe operations and checks

- Treat database files, generated `public/data` and `public/db` artifacts, `out/`, logs, locks, and local state as runtime outputs. Do not commit, delete, relocate, or reuse them without runtime evidence and authorization.
- Use the existing lifecycle scripts under `ops/`; do not consolidate them based on filename similarity. The release controller and normal server scripts have separate documented boundaries.
- Before a code change, run the focused check plus `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check` when applicable. For static work, inspect the manifest identity and exercise the exact static artifact flow. Building, deployment, and webroot changes require separate authorization.
- Do not install dependencies, change environments, start or stop services, deploy, alter schedulers, or push without explicit authorization.

## Canonical documentation

`docs/README.md` classifies the user, reference, operations, integration, and decision-record documentation. It is the canonical index; update it and the affected authoritative document together when changing a documented contract.
