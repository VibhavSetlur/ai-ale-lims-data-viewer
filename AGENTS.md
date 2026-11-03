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

## Dynamic and KIND boundary

This lineage serves dynamic behavior. The local KIND adapter is server-mode only: `python3 -m kind` validates or launches a loopback local adapter and is not a registration, package publication, catalog action, or static deployment. Its readiness endpoint is `/api/kind-ready`, distinct from `/api/health`. See [`docs/KIND_INTEGRATION.md`](docs/KIND_INTEGRATION.md).

Static exports use prebaked artifacts and browser SQLite. They do not depend on the KIND adapter or live APIs. See the static lineage guide and its `docs/KIND_INTEGRATION.md` before changing that boundary.

## Safe operations and checks

- Treat database files, generated `public/data` and `public/db` artifacts, `out/`, logs, locks, and local state as runtime outputs. Do not commit, delete, relocate, or reuse them without runtime evidence and authorization.
- Use the existing lifecycle scripts under `ops/`; do not consolidate them based on filename similarity. `ops/serve.sh` and `ops/stop.sh` manage the normal server, while the live-slice and Argo proxy scripts have separate documented boundaries.
- Before a code change, run the focused check plus `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check` when applicable. For dynamic server work, rebuild before restart and verify `/api/health` and the affected endpoint.
- Do not install dependencies, change environments, start or stop services, deploy, alter schedulers, or push without explicit authorization.

## Canonical documentation

`docs/README.md` classifies the user, reference, operations, integration, and decision-record documentation. It is the canonical index; update it and the affected authoritative document together when changing a documented contract.
