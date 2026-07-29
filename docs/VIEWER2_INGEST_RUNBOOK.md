# Viewer 2 candidate ingestion

This is **candidate-only tooling**, not a production importer. It never reads environment variables, discovers URLs, opens a MySQL connection, changes application configuration, or publishes without an explicit local artifact path.

## Live gate

Do not use this tooling against a live MySQL service. The only accepted MySQL target is an explicit disposable local URL with a test-only database name and marker:

```text
mysql://user:password@127.0.0.1/viewer2_test_example?test_only=1
```

Anything else fails before stage, reconcile, materialize, or publish. A future promotion must separately establish credentials, grants, backups, restore proof, negative privilege tests, MySQL parity, and a named operator approval. This command does not satisfy that gate.

## Candidate pipeline

All paths must be supplied by the operator. SQLite is opened read-only.

```bash
viewer2 ingest inspect --sqlite /candidate/source.sqlite --output /candidate/manifest.json
viewer2 ingest stage --manifest /candidate/manifest.json --sqlite /candidate/source.sqlite --candidate 2026-07-29-a --output /candidate/stage --mysql-url 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1'
viewer2 ingest reconcile --candidate 2026-07-29-a --sqlite /candidate/source.sqlite --stage /candidate/stage --report /candidate/report.json --mysql-url 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1'
viewer2 ingest materialize --candidate 2026-07-29-a --stage /candidate/stage --report /candidate/report.json --output /candidate/materialization.json --mysql-url 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1'
viewer2 ingest publish --candidate 2026-07-29-a --audience test --report /candidate/report.json --confirm "$(node -p "require('/candidate/report.json').reportDigest")" --pointer /candidate/test-pointer.json --mysql-url 'mysql://u:p@127.0.0.1/viewer2_test_ingest?test_only=1'
```

`inspect` records schema, indexes, counts, nulls, keys, deleted/freshness signals, capability flags, representative rows, and a source SHA-256. `stage` refuses a changed source checksum, emits reviewed compatibility DDL, deterministic row chunk hashes, and rejection artifacts. `reconcile` emits machine-readable blocking differences. `materialize` is checksum-idempotent. `publish` requires a matching zero-blocking report and exact digest, then atomically replaces only the supplied audience-pointer file.

Artifacts contain source and candidate provenance but no database credentials. Keep candidate artifacts out of committed database directories.
