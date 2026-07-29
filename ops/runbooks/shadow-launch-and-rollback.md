# Viewer 2 shadow launch and rollback

## Prerequisites

1. Record the legacy release, process owner, loopback bindings, nginx upstream, environment-file location, approved SQLite checksum, branch/deploy pointers, and current health responses.
2. Build once from an exact commit and record its artifact digest.
3. Run read-only preflight, parity, migration-compatibility, backup, and rollback checks. Confirm the scientific snapshot path and checksum are approved.
4. Confirm a nonconflicting loopback port. This runbook never starts Viewer 2 on or changes port 3457, nginx, systemd, static paths, or deployed channels.

## Shadow verification

1. Copy only redacted configuration into the shadow environment. Keep the real service environment file outside the repository.
2. Start only after operator authorization on the recorded non-3457 loopback port.
3. Verify `/api/v1/health/live`, `/api/v1/health/ready`, `/api/v1/status`, critical APIs, and browser workflows through the shadow port.
4. If persistence is enabled later, take an independent operational restore point before any traffic switch. Anonymous legacy SQLite reads must remain available if the operational database is absent.
5. Do not switch traffic or stop the legacy service until acceptance is explicitly recorded.

## Rollback prerequisites and action

Trigger rollback for wrong scientific output/capability, repeated 5xx, readiness failure, export corruption, authorization leak, migration incompatibility, or unacceptable latency. Preserve request and correlation IDs.

1. Stop new mutable commands and worker claims.
2. Restore traffic only through the recorded legacy release and known-good SQLite artifact.
3. Preserve operational storage and logs for forward recovery. Never restore scientific data over operational storage.
4. Retain the Viewer 2 release and approved snapshot through the rollback window.
5. Leave static channels and deploy branches unchanged.
