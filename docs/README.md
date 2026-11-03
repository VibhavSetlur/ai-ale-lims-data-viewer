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
| [`DEPLOYMENT_VERSIONING.md`](DEPLOYMENT_VERSIONING.md) | Branch roles, release metadata, and promotion boundaries for this lineage. |
| [`OPS_LIVE_RUNBOOK.md`](OPS_LIVE_RUNBOOK.md) | The separate 3458 live/MySQL/ORCID slice and its operational checks. |
| [`OPS_ARGO_PROXY.md`](OPS_ARGO_PROXY.md) | Argo proxy lifecycle and verification. |
| [`OPS_ASSISTANT.md`](OPS_ASSISTANT.md) | Operator-facing assistant procedures where applicable. |

The executable authority for lifecycle and refresh behavior remains the existing files under [`../ops/`](../ops/), including `serve.sh`, `stop.sh`, `refresh-db.sh`, the live-slice scripts, and `argo-viewer-proxy/`. Logs, PID files, locks, mtime markers, build directories, and generated artifacts are runtime outputs, not source documentation. Do not delete, move, or consolidate these paths without checking their active consumers and obtaining authorization.

## Integration documentation

| Document | Authority |
|---|---|
| [`KIND_INTEGRATION.md`](KIND_INTEGRATION.md) | The local dynamic KIND adapter contract, its server-only boundary, and external approval requirements. |

## Decision records

| Document | Authority |
|---|---|
| [`../plans/kind-integration.md`](../plans/kind-integration.md) | KIND reconciliation and decision provenance. It is not an operations runbook and remains preserved as a decision record. |

## Conventions

- Keep documentation synchronized with the committed code and the in-app Help and Guide when a user-visible feature changes.
- Keep secrets, host-private credentials, and point-in-time private notes out of tracked documentation.
- Style: plain English, no em-dashes, examples over prose.
