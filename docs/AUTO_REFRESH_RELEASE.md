# Automatic LIMS Release

`ops/auto-refresh-release.sh` is the static-first release controller for the full
AI-ALE LIMS mirror. It is designed for a noninteractive scheduler and is safe to
run repeatedly.

## Contract

The controller reads only the upstream source:

```text
/scratch1/fliu/hub_scratch/synbio/lims_mirror.backup.db
```

It copies that file into local temporary storage, checks its size and mtime before
and after the copy, computes SHA-256, runs SQLite `integrity_check`, requires a
nonempty user schema and at least one populated table, and records every table row
count. A source that changes during the copy, is unreadable, corrupt, or empty is
rejected before the indexed database or deployment changes.

The accepted hash is stored in `.local/auto-refresh-release/state.json` only after
all selected release stages pass. A later run with that hash is a no-op. The state
contains the source hash, source size and mtime, validation time, table counts,
indexed snapshot identity, static URL, and release time. It is intentionally local
and ignored by Git.

The schema guard is deliberately general rather than a hard-coded list of LIMS
tables. A table rename or upstream schema evolution is preserved as validation
metadata instead of silently publishing an incomplete subset. The static parity
check then proves that the curated API artifacts, HTTPVFS database, and manifest
came from the same indexed snapshot.

## Commands

```bash
# Prove the current source is stable and valid. No state, database, output, or webroot changes.
ops/auto-refresh-release.sh --dry-run --once --static-only

# Static-only release. This is the default behavior.
ops/auto-refresh-release.sh --once --static-only

# Static release followed by the dynamic companion after static success.
ops/auto-refresh-release.sh --once --include-dynamic
```

`--once` is a scheduler-readable no-op because every invocation processes one
candidate source. `--static-only` is also the default. The controller uses `flock`
to prevent overlapping runs.

A real static release must run from the accepted `static` branch, not `static-dev`.
The release build always identifies itself as channel `static`, branch `static`,
and base path `/annotation/projects/aiale-dev`.

## Release sequence

1. Stage and validate the upstream source locally.
2. Refresh `data/lims_indexed.db` through the existing atomic index builder and
   archive the prior indexed database.
3. Validate the indexed database and prove its row counts match the staged source.
4. Build a disposable loopback server on port 3458 using only the refreshed indexed
   database. The production server on port 3457 is not stopped or reused.
5. Prebake curated API responses, prepare the HTTPVFS database, verify static parity,
   and build the static export.
6. Copy the current approved webroot contents into `static-deploy-backups/` before
   mirroring `out/` into `/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev/`.
   The webroot directory itself is never altered. At least the immediately prior
   deployment is retained as a rollback artifact.
7. Verify the published HTTPS root and manifest, then require a `206` response from
   the public HTTPVFS database for a byte-range request.
8. Atomically write accepted state. If `--include-dynamic` was selected, run the
   dynamic companion before writing state.

Any build, parity, deployment, or HTTPS verification failure returns nonzero. The
previous static site remains the rollback source and the accepted state remains
unchanged. Automation does not try to overwrite a failed release with an
unverified fallback.

## Scheduler

Install one scheduler entry after the script has been accepted on the `static`
release worktree. The scheduler should point at that worktree, not `main` or a
compatibility branch:

```cron
17 * * * * cd /path/to/static-release-worktree && /path/to/static-release-worktree/ops/auto-refresh-release.sh --once --static-only >> /path/to/static-release-worktree/.local/auto-refresh-release/cron.log 2>&1 # ai-ale-static-release
```

The historical watcher command referenced a missing script. Replace that stale
watcher with this controller rather than retaining two competing refresh paths.

## Dynamic handoff

When `--include-dynamic` is requested, the static controller calls
`$DYNAMIC_ROOT/ops/auto-refresh-release.sh --dynamic-only --accepted-snapshot FILE`
after static publication and HTTPS verification. The companion must validate the
accepted snapshot evidence, refresh its indexed database, build and restart the
dynamic server, and verify `/api/health` plus its affected API endpoint. If it
fails, static remains published but accepted state is not advanced. That outcome is
visible in the controller exit status and requires repair before a retry.
