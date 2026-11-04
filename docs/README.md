# Documentation Authority Map

Start with the project [`README`](../README.md) for product use, setup, and a feature overview. This index classifies the maintained documents below. It does not move files or replace runtime paths.

## User documentation

| Document | Authority |
|---|---|
| [`RESEARCHER_GUIDE.md`](RESEARCHER_GUIDE.md) | How researchers use the viewer, interpret displayed availability, and export figures. The app's Help and Guide surface this content. |

## Reference documentation

| Document | Authority |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, server/static modes, data flow, repository map, and build boundaries. |
| [`DATA_MODEL.md`](DATA_MODEL.md) | LIMS tables, viewer mapping, and value provenance. |

## Operations documentation

| Document | Authority |
|---|---|
| [`DEPLOYMENT_VERSIONING.md`](DEPLOYMENT_VERSIONING.md) | Branch roles, release metadata, and promotion boundaries. |
| [`AUTO_REFRESH_RELEASE.md`](AUTO_REFRESH_RELEASE.md) | Static-first release-controller contract, scheduler example, rollback boundary, and dynamic handoff. |

The executable authority for lifecycle, refresh, and release behavior remains the existing files under [`../ops/`](../ops/), including `serve.sh`, `stop.sh`, `refresh-db.sh`, and `auto-refresh-release.sh`. Logs, PID files, locks, local state, build directories, and generated artifacts are runtime outputs, not source documentation. Do not delete, move, or consolidate these paths without checking their active consumers and obtaining authorization.

## Integration documentation

| Document | Authority |
|---|---|
| [`KIND_INTEGRATION.md`](KIND_INTEGRATION.md) | Static export artifact contract and the boundary from the dynamic local KIND adapter. |

## Decision records

No separate decision-record directory exists in this lineage. Preserve branch history and approved integration records rather than creating parallel copies here.

## Conventions

- Keep documentation synchronized with the committed code and the in-app Help and Guide when a user-visible feature changes.
- Keep secrets, host-private credentials, and point-in-time private notes out of tracked documentation.
- Style: plain English, no em-dashes, examples over prose.
