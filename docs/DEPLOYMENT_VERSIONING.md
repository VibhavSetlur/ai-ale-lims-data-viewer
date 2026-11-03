# Deployment Versioning

Versioning starts at `1.0.0` for release tracking. Static and dynamic deployments have separate approved branch lineages and truthful build metadata.

## Branch Roles

| Branch | Role | Deployment source | Notes |
| --- | --- | --- | --- |
| `static-dev` | private static development | static development builds | Validate static changes before promotion. |
| `static` | static production and release source | `https://modelseed.org/annotation/projects/aiale-dev/` | The sole static production lineage. |
| `dynamic-dev` | dynamic development source | local/dev server work | Develop and verify dynamic behavior here. |
| `dynamic` | dynamic production and release source | dynamic production releases | Promote accepted dynamic work here. |
| `main` | historic/shared recovery | none | Retained for history and recovery, not a deployment source. |
| `dev`, `deploy/aiale-dev` | compatibility-only | none | Never use as a development, promotion, or deployment source. |

The static URL remains `https://modelseed.org/annotation/projects/aiale-dev/`. Branch names identify approved source lineages; a branch pointer alone does not prove a URL is deployed.

## Viewer Display

The header and Changelog identify viewer version, deployment channel, branch, commit, mode, base path, expected database, barcode policy, and static manifest provenance. Channels are `static`, `dynamic`, and `server`; `static` is displayed as Static and records branch `static`.

## Build Metadata

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_VIEWER_VERSION` | Viewer semantic version, normally from `package.json` |
| `NEXT_PUBLIC_DEPLOYMENT_CHANNEL` | `static`, `dynamic`, or `server` |
| `NEXT_PUBLIC_DEPLOYMENT_BRANCH` | Approved source branch baked into the build |
| `NEXT_PUBLIC_GIT_COMMIT` | Commit baked into the bundle |
| `NEXT_PUBLIC_BASE_PATH` | Static URL base path |

`scripts/build-static.sh` accepts only `/annotation/projects/aiale-dev` and always sets `NEXT_PUBLIC_DEPLOYMENT_CHANNEL=static` and `NEXT_PUBLIC_DEPLOYMENT_BRANCH=static`.

## Promotion Flows and Boundaries

1. Develop static changes on `static-dev`, verify the static export, then promote the accepted commit to `static`.
2. Build the static release from `static` using the full mirror and `BASE_PATH=/annotation/projects/aiale-dev`; verify the exact HTTPS URL, manifest, and SQLite byte-range response before any authorized webroot copy.
3. Develop dynamic changes on `dynamic-dev`, verify server behavior, then promote accepted releases to `dynamic`.
4. Do not source work, promote releases, or deploy from `dev` or `deploy/aiale-dev`. Do not treat `main` as a deployment record.
5. Static exports remain prebaked and make no live API calls. They retain Plate Design and omit the AI sidebar/User Workspace; dynamic behavior remains unchanged.

## Version Alignment

A release identity must match its approved source branch, channel, commit, and data snapshot. Static metadata must say `channel=static` and `branch=static`; dynamic release metadata must identify `dynamic`. Data refreshes do not change the viewer version by themselves.

## Channel Differences

Static uses the full LIMS mirror and exposes Barcode Charts when `verAB_barcodes` is available. Dynamic/server mode follows its configured runtime database. The static export retains curated prebaked data and does not introduce live API calls.

## Manuscript and Publication Notes

Use the version badge or Changelog for viewer version, source branch, commit, URL, and LIMS snapshot date in figure provenance. Do not put manuscript drafts or private paper text in the repository unless explicitly requested.
