# Static operations reference

This is the authoritative operator and maintainer reference for the static lineage. The root [`README.md`](../README.md) is the handoff summary. Product behavior, researcher guidance, and application architecture are outside this document.

## 1. Authority and boundaries

- `static-dev` is the implementation and verification branch.
- `static` is the accepted static release branch.
- `dynamic-dev` and `dynamic` are separate server lineages and are not changed by static work.
- `main`, `dev`, and compatibility deployment branches are not release sources.
- A release prepares `out/`. Deployment is a separate authorized action.
- No refresh reads a live webroot. No release writes a webroot. No static check registers or deploys to KIND.

Use a clean `static-dev` worktree for changes. Commit and promote only after focused checks, `npx tsc --noEmit`, `npm test`, `npm run build` when applicable, and `git diff --check` pass. Database files, generated JSON, HTTPVFS files, `.local/`, and `out/` are ignored runtime artifacts.

## 2. Source data and provenance

The canonical trimmed source is `/scratch1/fliu/hub_scratch/synbio/lims_mirror_TFMN1.db`. The full source path is intentionally not declared authoritative. Until upstream confirms it, every full refresh must provide `--source PATH`.

| Profile | Indexed destination | Default source behavior |
|---|---|---|
| `trimmed` | `data/lims_TFMN1_indexed.db` | canonical trimmed path, unless `--source` is supplied |
| `full` | `data/lims_indexed.db` | explicit `--source` required |

An indexed destination is a local derived asset. Refresh copies a consistent SQLite snapshot, validates integrity and populated tables, creates supported indexes, and atomically replaces the selected destination. An existing destination is archived under `data/archive/`. The source is never modified. Deployed files are never inputs.

Release provenance includes source SHA-256, bytes, mtime, snapshot timestamp, profile, target, compiled base path, table counts, and artifact hashes. The immutable release input is `.local/releases/<profile>/data/source.db`.

## 3. Complete `ops/` inventory

These are the tracked operator files. `ops/__pycache__/` is generated Python cache, not an operator script.

| File | Classification | Reads | Writes / effect |
|---|---|---|---|
| `data-refresh.sh` | static refresh | explicit source and selected destination | indexed `data/*.db`, `data/archive/`, validation output |
| `static-release.sh` | static release | selected source, build scripts, application | `.local/releases/<profile>/`, `out/`, temporary `public/data` and `public/db` links, ignored build log; bounded loopback server only |
| `validate.py` | static source/release validator | SQLite, manifests, HTTPVFS config, output | JSON result on stdout; no release or deployment |
| `deploy-static.sh` | static deployment | validated bundle, manifest, selected approved target | dry-run plan, or timestamped webroot backup and synchronized approved webroot with `--apply` |
| `verify-server-source.py` | build-time compatibility helper | bounded server health/config/table/mutation responses and selected source | parity JSON on stdout; no production health or deployment action |

`ops/.gitignore` names transient `server.log` and `server.pid`. It does not add another script.

## 4. Refresh commands

```bash
ops/data-refresh.sh --profile trimmed
ops/data-refresh.sh --profile trimmed --source /path/to/mirror.db
ops/data-refresh.sh --profile full --source /path/to/full-mirror.db
ops/validate.py --profile trimmed
ops/validate.py --profile full
```

`data-refresh.sh` accepts `--profile trimmed|full`, optional `--source PATH`, and `--help`. It rejects unknown profiles and options. The trimmed default is the canonical path above. Full has no default source. Refresh archives the old destination before replacement and invokes `validate.py` on the selected profile.

## 5. Targets and release commands

| Target | Compiled base path | Approved URL | Approved webroot |
|---|---|---|---|
| `aiale` | `/annotation/projects/aiale` | `https://modelseed.org/annotation/projects/aiale/` | `/scratch1/fliu/html/modelseed_annotation/projects/aiale/` |
| `aiale-dev` | `/annotation/projects/aiale-dev` | `https://modelseed.org/annotation/projects/aiale-dev/` | `/scratch1/fliu/html/modelseed_annotation/projects/aiale-dev/` |
| `kind` | explicit `--root-path`, or empty | owner-supplied | none |

Profiles and targets are independent. The common pairings are trimmed to `aiale` and full to `aiale-dev`, but all profile/approved-target combinations are supported.

```bash
ops/static-release.sh --profile trimmed --target aiale --dry-run
ops/static-release.sh --profile trimmed --target aiale
ops/static-release.sh --profile full --target aiale-dev
ops/static-release.sh --profile full --target kind --root-path /owner/exact/prefix
```

Options are `--profile trimmed|full`, `--source PATH`, `--target aiale|aiale-dev|kind`, `--root-path PATH`, `--channel static|static-dev`, `--port PORT`, and `--dry-run`. The default channel is `static-dev` unless `RELEASE_CHANNEL` is set. `--dry-run` validates the source and prints the release plan without generating output.

A real release snapshots the source, prepares HTTPVFS, runs a bounded build-time server on loopback, verifies that server against the exact source, prebakes API artifacts, builds the selected base path, and validates output parity. It stops the worker before returning. It does not deploy.

Generated state:

```text
.local/releases/<profile>/
  data/       source.db, prebaked JSON, manifest
  db/         HTTPVFS database, worker, wasm, config
  out/        retained final bundle for the profile/target
  server.log  ignored bounded build-server log
out/          current selected bundle only
```

`public/data` and `public/db` are temporary links during release and are restored on exit. `out/` contains the current handoff bundle, not an archive of every profile. Do not commit any generated directory.

## 6. Validation and parity

```bash
ops/validate.py --profile full
ops/validate.py --profile trimmed \
  --release .local/releases/trimmed --out out \
  --target aiale --root-path /annotation/projects/aiale
python -B -m unittest discover -s tests/kind_static -v
```

`validate.py` checks source existence, non-empty SQLite, integrity, populated tables, release profile and source hash, manifest target/base path, HTTPVFS source hash and symlink, output index, required artifacts, table counts, mutation experiment identity, and output/release manifest agreement. It fails closed on mismatches.

The minimum handoff artifact checks are `out/index.html`, `out/data/manifest.json`, `out/db/config.json`, the URL root, and an HTTPVFS byte range. Record the source hash, profile, target, base path, commit, snapshot metadata, validation result, and representative `206` response.

Repository checks for documentation-only changes remain proportional, but the standard code gates are:

```bash
npx tsc --noEmit
npm test
npm run build
git diff --check
python -B -m unittest discover -s tests/kind_static -v
```

Static export may remove `.next`; run `npm run build` again before server-mode compatibility verification.

## 7. Deployment, backup, and rollback

Release and deployment are separate. Dry-run first:

```bash
ops/deploy-static.sh --target aiale --profile trimmed --bundle out --dry-run
```

Apply only after explicit deployment authorization:

```bash
ops/deploy-static.sh --target aiale --profile trimmed --bundle out --apply
ops/deploy-static.sh --target aiale-dev --profile full --bundle out --apply
```

`deploy-static.sh` accepts `--target aiale|aiale-dev`, `--profile trimmed|full`, `--bundle PATH` (default `out`), `--dry-run`, and `--apply`. It rejects arbitrary destinations. Without `--apply` it remains dry-run. It validates the bundle manifest and selected source identity, creates a timestamped sibling backup of the existing webroot, and synchronizes the contents of the bundle, not the bundle directory itself.

Record the printed `backup=` path. Rollback restores that backup's contents to the same approved webroot using the host-authorized file operation, then repeats root, manifest, and byte-range checks. Do not refresh from a webroot or use a different target during rollback.

## 8. KIND static handoff

The repository provides provisional local tooling only. It can seal, inspect, and serve a bundle without Node or a checkout. It does not register a catalog package, configure a proxy, grant access, deploy to KIND, or establish external readiness.

The KIND reviewer must supply the authoritative package identity, exact proxy/root prefix, packaging contract, registration steps, access requirements, and data redistribution decision. Build with that exact prefix:

```bash
ops/static-release.sh --profile full --target kind --root-path /owner/exact/prefix
python scripts/seal-kind-static.py --bundle out --root-path /owner/exact/prefix \
  --commit "$(git rev-parse HEAD)" \
  --viewer-version "$(node -p 'require(\"./package.json\").version')" \
  --allow-local-lims
python -m ai_ale_kind_static doctor --bundle out --root-path /owner/exact/prefix
python -m ai_ale_kind_static serve --bundle out --root-path /owner/exact/prefix --port 8765 --no-king
```

`doctor` performs offline sealed-bundle checks. `serve` is loopback-only local serving. Verify root, manifest, and range:

```bash
curl -i http://127.0.0.1:8765/owner/exact/prefix/
curl -i http://127.0.0.1:8765/owner/exact/prefix/data/manifest.json
curl -i -H 'Range: bytes=0-99' http://127.0.0.1:8765/owner/exact/prefix/db/lims.db
```

The range response must be `206 Partial Content` with a valid `Content-Range`. A prefix mismatch is a build failure. If the owner supplies no prefix, use `--root-path ''` consistently. External KIND status remains unresolved until the owner supplies and confirms the missing contract items.

## 9. Server compatibility only

`npm run dev`, `npm start`, `Dockerfile`, and `docker-compose.yml` are retained server-mode compatibility surfaces. They require Node and local database configuration. They are not the static release path, do not serve `out/`, and do not prove static deployment or KIND readiness. The bounded server used by `static-release.sh` exists only to produce and verify build-time artifacts.

## 10. Troubleshooting and handoff checklist

- Missing source: use the exact profile destination or provide `--source`; full requires it.
- Integrity, hash, or parity mismatch: stop and rebuild all generated artifacts from one source snapshot.
- Wrong target or prefix: rebuild with the exact compiled base path. Do not patch HTML.
- Missing manifest: inspect `.local/releases/<profile>/server.log` and rerun release.
- HTTPVFS mismatch: rebuild the selected profile without mixing release directories.
- KIND doctor failure: obtain the exact owner prefix and reseal/rebuild.
- Server API failure after static export: run `npm run build` before `npm start`.
- Before handoff, record branch, commit, profile, source path/hash, target, base path, version, snapshot counts, validation, URL status, manifest response, and a representative byte range.
- Confirm no webroot changed unless `--apply` was explicitly authorized.
- Label external KIND registration, proxy setup, access, packaging, and redistribution as unresolved until the owner confirms them.
